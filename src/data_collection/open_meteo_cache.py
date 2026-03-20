from __future__ import annotations

import json
import os
import time

from loguru import logger


class OpenMeteoCacheMixin:
    def _load_open_meteo_disk_cache(self) -> None:
        """启动时从磁盘加载 Open-Meteo 三类缓存，避免重启后冷启动打爆 API"""
        try:
            path = self._disk_cache_path
            if not os.path.exists(path):
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(
                        {
                            "forecast": {},
                            "ensemble": {},
                            "multi_model": {},
                            "saved_at": time.time(),
                        },
                        f,
                    )
                self._disk_cache_last_mtime = os.path.getmtime(path)
                return
            current_mtime = os.path.getmtime(path)
            if current_mtime <= self._disk_cache_last_mtime:
                return
            with open(path, "r", encoding="utf-8") as f:
                saved = json.load(f)
            now = time.time()
            max_age = max(600, self._disk_cache_max_age_sec)
            loaded = 0
            with self._open_meteo_cache_lock:
                for key, entry in saved.get("forecast", {}).items():
                    if now - float(entry.get("t", 0)) < max_age:
                        old = self._open_meteo_cache.get(key)
                        if old is None or float(entry.get("t", 0)) >= float(old.get("t", 0)):
                            self._open_meteo_cache[key] = entry
                            loaded += 1
            with self._ensemble_cache_lock:
                for key, entry in saved.get("ensemble", {}).items():
                    if now - float(entry.get("t", 0)) < max_age:
                        old = self._ensemble_cache.get(key)
                        if old is None or float(entry.get("t", 0)) >= float(old.get("t", 0)):
                            self._ensemble_cache[key] = entry
                            loaded += 1
            with self._multi_model_cache_lock:
                for key, entry in saved.get("multi_model", {}).items():
                    if now - float(entry.get("t", 0)) < max_age:
                        old = self._multi_model_cache.get(key)
                        if old is None or float(entry.get("t", 0)) >= float(old.get("t", 0)):
                            self._multi_model_cache[key] = entry
                            loaded += 1
            self._disk_cache_last_mtime = current_mtime
            if loaded:
                logger.info(f"✅ 从磁盘加载 Open-Meteo 缓存 {loaded} 条 ({self._disk_cache_path})")
        except Exception as exc:
            logger.warning(f"磁盘缓存加载失败（首次启动不影响运行）: {exc}")

    def _maybe_reload_open_meteo_disk_cache(self) -> None:
        """跨进程共享缓存：当缓存文件有更新时增量重载到当前进程内存"""
        try:
            path = self._disk_cache_path
            if not os.path.exists(path):
                return
            current_mtime = os.path.getmtime(path)
            if current_mtime <= self._disk_cache_last_mtime:
                return
            self._load_open_meteo_disk_cache()
        except Exception:
            pass

    def _flush_open_meteo_disk_cache(self) -> None:
        """将三类 Open-Meteo 内存缓存持久化到磁盘"""
        try:
            os.makedirs(os.path.dirname(self._disk_cache_path), exist_ok=True)
            with self._open_meteo_cache_lock:
                forecast_snapshot = dict(self._open_meteo_cache)
            with self._ensemble_cache_lock:
                ensemble_snapshot = dict(self._ensemble_cache)
            with self._multi_model_cache_lock:
                multi_model_snapshot = dict(self._multi_model_cache)
            payload = {
                "forecast": forecast_snapshot,
                "ensemble": ensemble_snapshot,
                "multi_model": multi_model_snapshot,
                "saved_at": time.time(),
            }
            with self._disk_cache_lock:
                tmp_path = self._disk_cache_path + ".tmp"
                with open(tmp_path, "w", encoding="utf-8") as f:
                    json.dump(payload, f)
                os.replace(tmp_path, self._disk_cache_path)
            self._disk_cache_last_mtime = os.path.getmtime(self._disk_cache_path)
        except Exception as exc:
            logger.warning(f"磁盘缓存写入失败: {exc}")

    def _wait_open_meteo_slot(self, endpoint: str) -> None:
        """Simple per-process rate gate for Open-Meteo endpoints."""
        min_interval = self._open_meteo_min_interval_sec
        if min_interval <= 0:
            return
        with self._open_meteo_call_lock:
            now_ts = time.time()
            wait_for = min_interval - (now_ts - self._open_meteo_last_call_ts)
            if wait_for > 0:
                logger.debug(
                    f"Open-Meteo {endpoint} 限流保护：sleep {wait_for:.2f}s (min_interval={min_interval:.2f}s)"
                )
                time.sleep(wait_for)
                now_ts = time.time()
            self._open_meteo_last_call_ts = now_ts
