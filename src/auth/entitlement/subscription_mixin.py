from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import requests
from loguru import logger


class SubscriptionMixin:
    def _query_latest_active_subscription(
        self,
        user_id: str,
    ) -> Optional[Dict[str, object]]:
        row, _ok = self._query_latest_active_subscription_result(user_id)
        return row

    def _query_latest_active_subscription_result(
        self,
        user_id: str,
        bypass_cache: bool = False,
    ) -> Tuple[Optional[Dict[str, object]], bool]:
        if not user_id:
            return None, True
        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing")
            return None, False

        now_ts = time.time()
        if not bypass_cache:
            with self._sub_cache_lock:
                cached = self._sub_cache.get(user_id)
                if cached and now_ts - float(cached.get("ts") or 0) < self.sub_cache_ttl_sec:
                    rows = cached.get("rows")
                    if isinstance(rows, list):
                        return (
                            self._pick_latest_current_subscription(
                                [row for row in rows if isinstance(row, dict)]
                            ),
                            True,
                        )
                    if "row" in cached:
                        row = cached.get("row")
                        return row if isinstance(row, dict) else None, True
            with self._active_subscription_bool_cache_lock:
                cached_bool = self._active_subscription_bool_cache.get(user_id)
                if (
                    cached_bool
                    and now_ts - float(cached_bool.get("ts") or 0) < self.sub_cache_ttl_sec
                    and cached_bool.get("active") is False
                ):
                    return None, True

        try:
            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            params = {
                "select": "plan_code,source,starts_at,expires_at",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "starts_at": f"lte.{now_iso}",
                "expires_at": f"gt.{now_iso}",
                "order": "expires_at.desc",
                "limit": "1",
            }
            response = requests.get(
                self._subscription_endpoint(),
                headers=self._request_headers_for_service_role(),
                params=params,
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                logger.warning(
                    "supabase subscription query failed user_id={} status={}",
                    user_id,
                    response.status_code,
                )
                return None, False
            else:
                data = response.json() if response.content else []
                rows = [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []
                row = rows[0] if rows else None

            with self._sub_cache_lock:
                self._sub_cache[user_id] = {
                    "active": bool(row),
                    "row": row,
                    "ts": now_ts,
                }
            return row, True
        except Exception as exc:
            logger.warning(f"supabase subscription query error user_id={user_id}: {exc}")
            return None, False

    def _subscription_access_window_from_current(
        self,
        row: Optional[Dict[str, object]],
    ) -> Dict[str, object]:
        if not isinstance(row, dict):
            return {}
        expires_at = row.get("expires_at")
        starts_at = row.get("starts_at")
        return {
            "current": row,
            "current_expires_at": expires_at,
            "current_starts_at": starts_at,
            "total_expires_at": expires_at,
            "queued_days": 0,
            "queued_count": 0,
            "rows": [row],
        }

    def _cached_subscription_access_window(
        self,
        user_id: str,
    ) -> Tuple[Dict[str, object], bool]:
        now_ts = time.time()
        with self._sub_cache_lock:
            cached = self._sub_cache.get(user_id)
            if not cached or now_ts - float(cached.get("ts") or 0) >= self.sub_cache_ttl_sec:
                return {}, False
            rows = cached.get("rows")
            if isinstance(rows, list):
                return (
                    self._subscription_window_from_rows(
                        [row for row in rows if isinstance(row, dict)]
                    ),
                    True,
                )
            if "row" in cached:
                row = cached.get("row")
                return (
                    self._subscription_access_window_from_current(
                        row if isinstance(row, dict) else None
                    ),
                    True,
                )
        return {}, False

    def get_subscription_access_window(
        self,
        user_id: str,
        respect_requirement: bool = True,
        bypass_cache: bool = False,
        unknown_on_error: bool = False,
    ) -> Dict[str, object]:
        if respect_requirement and not self.require_subscription:
            return {}
        user_key = str(user_id or "").strip()
        if not user_key:
            return {}
        if not bypass_cache:
            cached_window, found = self._cached_subscription_access_window(user_key)
            if found:
                return cached_window

        row, query_ok = self._query_latest_active_subscription_result(
            user_key,
            bypass_cache=True,
        )
        if not query_ok and unknown_on_error:
            return {
                "unknown": True,
                "current": None,
                "current_expires_at": None,
                "current_starts_at": None,
                "total_expires_at": None,
                "queued_days": 0,
                "queued_count": 0,
                "rows": None,
            }
        return self._subscription_access_window_from_current(row)

    def _query_active_subscription_rows_result(
        self,
        user_id: str,
        bypass_cache: bool = False,
    ) -> Tuple[List[Dict[str, object]], bool]:
        if not user_id:
            return [], True
        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing")
            return [], False

        now_ts = time.time()
        if not bypass_cache:
            with self._sub_cache_lock:
                cached = self._sub_cache.get(user_id)
                if cached and now_ts - float(cached.get("ts") or 0) < self.sub_cache_ttl_sec:
                    rows = cached.get("rows")
                    if isinstance(rows, list):
                        return [row for row in rows if isinstance(row, dict)], True

        try:
            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            params = {
                "select": "plan_code,source,starts_at,expires_at",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "expires_at": f"gt.{now_iso}",
                "order": "expires_at.desc",
                "limit": "100",
            }
            response = requests.get(
                self._subscription_endpoint(),
                headers=self._request_headers_for_service_role(),
                params=params,
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                logger.warning(
                    "supabase active subscription rows query failed user_id={} status={}",
                    user_id,
                    response.status_code,
                )
                return [], False
            else:
                data = response.json() if response.content else []
                rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []

            current_row = self._pick_latest_current_subscription(rows, now=now)
            with self._sub_cache_lock:
                self._sub_cache[user_id] = {
                    "active": bool(current_row),
                    "row": current_row,
                    "rows": rows,
                    "ts": now_ts,
                }
            return rows, True
        except Exception as exc:
            logger.warning(f"supabase active subscription rows query error user_id={user_id}: {exc}")
            return [], False

    def _query_active_subscription_rows(
        self,
        user_id: str,
        bypass_cache: bool = False,
    ) -> List[Dict[str, object]]:
        rows, _ok = self._query_active_subscription_rows_result(
            user_id,
            bypass_cache=bypass_cache,
        )
        return rows

    def _query_latest_subscription_any_status(
        self,
        user_id: str,
    ) -> Optional[Dict[str, object]]:
        if not user_id or not self.service_role_key:
            return None
        now_ts = time.time()
        with self._latest_subscription_cache_lock:
            cached = self._latest_subscription_cache.get(user_id)
            if cached and now_ts - float(cached.get("ts") or 0) < self.sub_cache_ttl_sec:
                row = cached.get("row")
                return row if isinstance(row, dict) else None
        try:
            params = {
                "select": "plan_code,starts_at,expires_at",
                "user_id": f"eq.{user_id}",
                "order": "created_at.desc",
                "limit": "1",
            }
            response = requests.get(
                self._subscription_endpoint(),
                headers=self._request_headers_for_service_role(),
                params=params,
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                logger.warning(
                    "supabase subscription history query failed user_id={} status={}",
                    user_id,
                    response.status_code,
                )
                return None
            data = response.json() if response.content else []
            row = data[0] if isinstance(data, list) and data else None
            result = row if isinstance(row, dict) else None
            with self._latest_subscription_cache_lock:
                self._latest_subscription_cache[user_id] = {
                    "row": result,
                    "ts": now_ts,
                }
            return result
        except Exception as exc:
            logger.warning(f"supabase subscription history query error user_id={user_id}: {exc}")
            return None

    @staticmethod
    def _parse_iso_datetime(raw: Optional[str]) -> Optional[datetime]:
        text = str(raw or "").strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except Exception:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    def _is_subscription_started(
        self,
        row: Optional[Dict[str, object]],
        *,
        now: Optional[datetime] = None,
    ) -> bool:
        if not isinstance(row, dict):
            return False
        starts_at = self._parse_iso_datetime(str(row.get("starts_at") or ""))
        if starts_at is None:
            return True
        current = now or datetime.now(timezone.utc)
        return starts_at <= current

    def _pick_latest_current_subscription(
        self,
        rows: object,
        *,
        now: Optional[datetime] = None,
    ) -> Optional[Dict[str, object]]:
        if not isinstance(rows, list):
            return None
        current = now or datetime.now(timezone.utc)
        for row in rows:
            if isinstance(row, dict) and self._is_subscription_started(row, now=current):
                return row
        return None

    def _query_active_subscription(self, user_id: str) -> bool:
        if not user_id:
            return False
        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing")
            return False

        now_ts = time.time()
        with self._sub_cache_lock:
            cached_detail = self._sub_cache.get(user_id)
            if cached_detail and now_ts - float(cached_detail.get("ts") or 0) < self.sub_cache_ttl_sec:
                rows = cached_detail.get("rows")
                if isinstance(rows, list):
                    return self._pick_latest_current_subscription(
                        [row for row in rows if isinstance(row, dict)]
                    ) is not None
                if "row" in cached_detail:
                    return isinstance(cached_detail.get("row"), dict)

        with self._active_subscription_bool_cache_lock:
            cached = self._active_subscription_bool_cache.get(user_id)
            if cached and now_ts - float(cached.get("ts") or 0) < self.sub_cache_ttl_sec:
                return bool(cached.get("active"))

        try:
            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            params = {
                "select": "expires_at",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "starts_at": f"lte.{now_iso}",
                "expires_at": f"gt.{now_iso}",
                "order": "expires_at.desc",
                "limit": "1",
            }
            response = requests.get(
                self._subscription_endpoint(),
                headers=self._request_headers_for_service_role(),
                params=params,
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                logger.warning(
                    "supabase active subscription bool query failed user_id={} status={}",
                    user_id,
                    response.status_code,
                )
                active = False
            else:
                data = response.json() if response.content else []
                rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
                active = bool(rows)

            with self._active_subscription_bool_cache_lock:
                self._active_subscription_bool_cache[user_id] = {
                    "active": bool(active),
                    "ts": now_ts,
                }
            return bool(active)
        except Exception as exc:
            logger.warning(f"supabase active subscription bool query error user_id={user_id}: {exc}")
            return False

    def get_latest_active_subscription(
        self,
        user_id: str,
        respect_requirement: bool = True,
    ) -> Optional[Dict[str, object]]:
        if respect_requirement and not self.require_subscription:
            return None
        return self._query_latest_active_subscription(user_id)

    def get_latest_subscription_any_status(
        self,
        user_id: str,
    ) -> Optional[Dict[str, object]]:
        return self._query_latest_subscription_any_status(user_id)

    def get_subscription_window(
        self,
        user_id: str,
        respect_requirement: bool = True,
        bypass_cache: bool = False,
        unknown_on_error: bool = False,
    ) -> Dict[str, object]:
        if respect_requirement and not self.require_subscription:
            return {}
        rows, query_ok = self._query_active_subscription_rows_result(
            user_id,
            bypass_cache=bypass_cache,
        )
        if not query_ok and unknown_on_error:
            return {
                "unknown": True,
                "current": None,
                "current_expires_at": None,
                "current_starts_at": None,
                "total_expires_at": None,
                "queued_days": 0,
                "queued_count": 0,
                "rows": None,
            }
        return self._subscription_window_from_rows(rows)

    def _subscription_window_from_rows(
        self,
        rows: List[Dict[str, object]],
    ) -> Dict[str, object]:
        if not rows:
            return {}
        now = datetime.now(timezone.utc)
        current = self._pick_latest_current_subscription(rows, now=now)
        total_expiry: Optional[datetime] = None
        current_expiry: Optional[datetime] = None
        if isinstance(current, dict):
            current_expiry = self._parse_iso_datetime(str(current.get("expires_at") or ""))

        queued_count = 0
        for row in rows:
            exp = self._parse_iso_datetime(str(row.get("expires_at") or ""))
            if exp is not None and (total_expiry is None or exp > total_expiry):
                total_expiry = exp
            if current_expiry is not None:
                starts = self._parse_iso_datetime(str(row.get("starts_at") or ""))
                if starts is not None and starts >= current_expiry and row is not current:
                    queued_count += 1

        queued_days = 0
        if total_expiry is not None and current_expiry is not None and total_expiry > current_expiry:
            queued_days = max(
                0,
                int(round((total_expiry - current_expiry).total_seconds() / 86_400)),
            )

        return {
            "current": current,
            "current_expires_at": current.get("expires_at") if isinstance(current, dict) else None,
            "current_starts_at": current.get("starts_at") if isinstance(current, dict) else None,
            "total_expires_at": total_expiry.isoformat() if total_expiry else None,
            "queued_days": queued_days,
            "queued_count": queued_count,
            "rows": rows,
        }

    def list_subscription_windows(
        self,
        user_ids: List[str],
        bypass_cache: bool = False,
    ) -> Dict[str, Dict[str, object]]:
        keys: List[str] = []
        for item in user_ids or []:
            key = str(item or "").strip().lower()
            if key and key not in keys:
                keys.append(key)
        if not keys:
            return {}

        out: Dict[str, Dict[str, object]] = {}
        if not bypass_cache:
            missing: List[str] = []
            now_ts = time.time()
            with self._sub_cache_lock:
                for key in keys:
                    cached = self._sub_cache.get(key)
                    if cached and now_ts - float(cached.get("ts") or 0) < self.sub_cache_ttl_sec:
                        rows = cached.get("rows")
                        if isinstance(rows, list):
                            out[key] = self._subscription_window_from_rows(
                                [row for row in rows if isinstance(row, dict)]
                            )
                            continue
                    missing.append(key)
            keys = missing
            if not keys:
                return out

        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing")
            return out

        try:
            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            params = {
                "select": "user_id,plan_code,source,starts_at,expires_at",
                "user_id": f"in.({','.join(keys)})",
                "status": "eq.active",
                "expires_at": f"gt.{now_iso}",
                "order": "user_id.asc,expires_at.desc",
                "limit": str(max(1, min(len(keys) * 20, 1000))),
            }
            response = requests.get(
                self._subscription_endpoint(),
                headers=self._request_headers_for_service_role(),
                params=params,
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                logger.warning(
                    "supabase subscription window batch query failed users={} status={}",
                    len(keys),
                    response.status_code,
                )
                return out

            data = response.json() if response.content else []
            rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
            grouped: Dict[str, List[Dict[str, object]]] = {key: [] for key in keys}
            for row in rows:
                key = str(row.get("user_id") or "").strip().lower()
                if key in grouped:
                    grouped[key].append(row)

            now_ts = time.time()
            with self._sub_cache_lock:
                for key, user_rows in grouped.items():
                    current_row = self._pick_latest_current_subscription(user_rows, now=now)
                    self._sub_cache[key] = {
                        "active": bool(current_row),
                        "row": current_row,
                        "rows": user_rows,
                        "ts": now_ts,
                    }
                    out[key] = self._subscription_window_from_rows(user_rows)
            return out
        except Exception as exc:
            logger.warning(f"supabase subscription window batch query error users={len(keys)}: {exc}")
            return out

    def list_active_subscription_windows(self, limit: int = 200) -> Dict[str, object]:
        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing")
            return {"subscriptions": [], "windows": {}}
        safe_limit = max(1, min(int(limit or 200), 1000))
        try:
            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            params = {
                "select": "user_id,plan_code,source,starts_at,expires_at",
                "status": "eq.active",
                "expires_at": f"gt.{now_iso}",
                "order": "user_id.asc,expires_at.desc",
                "limit": str(max(1, min(safe_limit * 20, 5000))),
            }
            response = requests.get(
                self._subscription_endpoint(),
                headers=self._request_headers_for_service_role(),
                params=params,
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                logger.warning(
                    "supabase active subscription window query failed status={}",
                    response.status_code,
                )
                return {"subscriptions": [], "windows": {}}
            data = response.json() if response.content else []
            rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
            grouped: Dict[str, List[Dict[str, object]]] = {}
            for row in rows:
                key = str(row.get("user_id") or "").strip().lower()
                if key:
                    grouped.setdefault(key, []).append(row)

            windows: Dict[str, Dict[str, object]] = {}
            current_rows: List[Dict[str, object]] = []
            now_ts = time.time()
            with self._sub_cache_lock:
                for key, user_rows in grouped.items():
                    current_row = self._pick_latest_current_subscription(user_rows, now=now)
                    self._sub_cache[key] = {
                        "active": bool(current_row),
                        "row": current_row,
                        "rows": user_rows,
                        "ts": now_ts,
                    }
                    windows[key] = self._subscription_window_from_rows(user_rows)
                    if isinstance(current_row, dict):
                        current_rows.append(current_row)
            current_rows.sort(key=lambda row: str(row.get("expires_at") or ""))
            current_rows = current_rows[:safe_limit]
            with self._active_subscriptions_cache_lock:
                self._active_subscriptions_cache[str(safe_limit)] = {
                    "rows": current_rows,
                    "ts": now_ts,
                }
            return {"subscriptions": current_rows, "windows": windows}
        except Exception as exc:
            logger.warning(f"supabase active subscription window query error: {exc}")
            return {"subscriptions": [], "windows": {}}

    def has_active_subscription(
        self,
        user_id: str,
        respect_requirement: bool = True,
    ) -> bool:
        if respect_requirement and not self.require_subscription:
            return True
        return self._query_active_subscription(user_id)

    def list_active_subscriptions(self, limit: int = 200) -> List[Dict[str, object]]:
        if not self.service_role_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY is missing")
            return []
        safe_limit = max(1, min(int(limit or 200), 1000))
        cache_key = str(safe_limit)
        now_ts = time.time()
        with self._active_subscriptions_cache_lock:
            cached = self._active_subscriptions_cache.get(cache_key)
            if isinstance(cached, dict) and now_ts - float(cached.get("ts") or 0) < self.sub_cache_ttl_sec:
                rows = cached.get("rows")
                if isinstance(rows, list):
                    return [row for row in rows if isinstance(row, dict)]
        try:
            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            params = {
                "select": "user_id,plan_code,starts_at,expires_at",
                "status": "eq.active",
                "expires_at": f"gt.{now_iso}",
                "order": "expires_at.asc",
                "limit": str(safe_limit),
            }
            response = requests.get(
                self._subscription_endpoint(),
                headers=self._request_headers_for_service_role(),
                params=params,
                timeout=self.timeout_sec,
            )
            if response.status_code != 200:
                logger.warning(
                    "supabase active subscriptions query failed status={}",
                    response.status_code,
                )
                return []
            data = response.json() if response.content else []
            if not isinstance(data, list):
                return []
            rows = [
                row
                for row in data
                if isinstance(row, dict) and self._is_subscription_started(row, now=now)
            ]
            with self._active_subscriptions_cache_lock:
                self._active_subscriptions_cache[cache_key] = {
                    "rows": rows,
                    "ts": now_ts,
                }
            return rows
        except Exception as exc:
            logger.warning(f"supabase active subscriptions query error: {exc}")
            return []
