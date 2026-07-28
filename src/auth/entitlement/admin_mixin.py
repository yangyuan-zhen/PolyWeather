from __future__ import annotations

import time
from typing import Dict, List

import requests
from loguru import logger


class AdminMixin:
    def _admin_user_endpoint(self, user_id: str) -> str:
        return f"{self.supabase_url}/auth/v1/admin/users/{user_id}"

    def _admin_get_user(self, user_id: str) -> Dict[str, object]:
        user_key = str(user_id or "").strip()
        if not user_key:
            raise ValueError("user_id required")
        response = requests.get(
            self._admin_user_endpoint(user_key),
            headers=self._request_headers_for_service_role(),
            timeout=self.timeout_sec,
        )
        if response.status_code != 200:
            detail = response.text[:350] if response.text else response.reason
            raise RuntimeError(
                f"supabase admin user query failed: {response.status_code} {detail}"
            )
        raw = response.json() if response.content else {}
        if isinstance(raw, dict) and isinstance(raw.get("user"), dict):
            return dict(raw["user"])
        return dict(raw) if isinstance(raw, dict) else {}

    def _admin_update_user_metadata(
        self,
        user_id: str,
        metadata: Dict[str, object],
    ) -> Dict[str, object]:
        user_key = str(user_id or "").strip()
        if not user_key:
            raise ValueError("user_id required")
        response = requests.put(
            self._admin_user_endpoint(user_key),
            headers={**self._request_headers_for_service_role(), "Content-Type": "application/json"},
            json={"user_metadata": metadata or {}},
            timeout=self.timeout_sec,
        )
        if response.status_code != 200:
            detail = response.text[:350] if response.text else response.reason
            raise RuntimeError(
                f"supabase admin metadata update failed: {response.status_code} {detail}"
            )
        raw = response.json() if response.content else {}
        if isinstance(raw, dict) and isinstance(raw.get("user"), dict):
            return dict(raw["user"])
        return dict(raw) if isinstance(raw, dict) else {}

    def get_auth_users(self, user_ids: List[str]) -> Dict[str, Dict[str, object]]:
        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing")
            return {}

        keys = []
        for item in user_ids or []:
            key = str(item or "").strip().lower()
            if key and key not in keys:
                keys.append(key)
        if not keys:
            return {}

        out: Dict[str, Dict[str, object]] = {}
        now_ts = time.time()
        missing_keys: List[str] = []
        with self._auth_users_cache_lock:
            for key in keys:
                cached = self._auth_users_cache.get(key)
                if cached and now_ts - float(cached.get("ts") or 0) < self.sub_cache_ttl_sec:
                    user = cached.get("user")
                    if isinstance(user, dict):
                        out[key] = dict(user)
                        continue
                missing_keys.append(key)
        keys = missing_keys
        if not keys:
            return out

        profile_users = self._get_profile_users(keys)
        if profile_users:
            self._remember_auth_users(profile_users)
            out.update(profile_users)
        keys = [key for key in keys if key not in out]
        if not keys:
            return out

        for user_id in keys:
            try:
                response = requests.get(
                    self._admin_user_endpoint(user_id),
                    headers=self._request_headers_for_service_role(),
                    timeout=self.timeout_sec,
                )
                if response.status_code != 200:
                    logger.warning(
                        "supabase admin user query failed user_id={} status={}",
                        user_id,
                        response.status_code,
                    )
                    continue
                raw = response.json() if response.content else {}
                payload = raw.get("user") if isinstance(raw, dict) and isinstance(raw.get("user"), dict) else raw
                if not isinstance(payload, dict):
                    continue
                out[user_id] = {
                    "email": str(payload.get("email") or "").strip(),
                    "created_at": payload.get("created_at"),
                }
                self._remember_auth_users({user_id: out[user_id]})
            except Exception as exc:
                logger.warning(f"supabase admin user query error user_id={user_id}: {exc}")
        return out

    def _remember_auth_users(self, users: Dict[str, Dict[str, object]]) -> None:
        if not users:
            return
        now_ts = time.time()
        with self._auth_users_cache_lock:
            for raw_key, user in users.items():
                key = str(raw_key or "").strip().lower()
                if key and isinstance(user, dict):
                    self._auth_users_cache[key] = {
                        "user": dict(user),
                        "ts": now_ts,
                    }
            if len(self._auth_users_cache) > 4096:
                oldest_keys = sorted(
                    self._auth_users_cache,
                    key=lambda key: float(
                        self._auth_users_cache[key].get("ts") or 0.0
                    ),
                )
                for key in oldest_keys[: len(self._auth_users_cache) - 4096]:
                    self._auth_users_cache.pop(key, None)

    def _get_profile_users(self, user_ids: List[str]) -> Dict[str, Dict[str, object]]:
        if not user_ids or not self.service_role_key:
            return {}
        try:
            response = requests.get(
                self._profiles_endpoint(),
                headers=self._request_headers_for_service_role(),
                params={
                    "select": "id,email,created_at",
                    "id": f"in.({','.join(user_ids)})",
                    "limit": str(max(1, min(len(user_ids), 1000))),
                },
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                logger.warning(
                    "supabase profile users batch query failed users={} status={}",
                    len(user_ids),
                    response.status_code,
                )
                return {}
            data = response.json() if response.content else []
            rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
            out: Dict[str, Dict[str, object]] = {}
            for row in rows:
                user_id = str(row.get("id") or "").strip().lower()
                if not user_id:
                    continue
                out[user_id] = {
                    "email": str(row.get("email") or "").strip(),
                    "created_at": row.get("created_at"),
                }
            return out
        except Exception as exc:
            logger.warning(f"supabase profile users batch query error users={len(user_ids)}: {exc}")
            return {}
