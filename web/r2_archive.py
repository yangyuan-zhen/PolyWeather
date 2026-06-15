"""Cloudflare R2 archive helpers for cold PolyWeather event snapshots."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Optional
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen


R2_REGION = "auto"
R2_SERVICE = "s3"


@dataclass(frozen=True)
class R2ArchiveConfig:
    account_id: str
    bucket: str
    access_key_id: str
    secret_access_key: str
    endpoint_url: str = ""
    region: str = R2_REGION

    @classmethod
    def from_env(cls, env: Optional[dict[str, str]] = None) -> Optional["R2ArchiveConfig"]:
        source = env if env is not None else os.environ
        account_id = str(source.get("POLYWEATHER_R2_ACCOUNT_ID") or "").strip()
        bucket = str(source.get("POLYWEATHER_R2_BUCKET") or "").strip()
        access_key_id = str(source.get("POLYWEATHER_R2_ACCESS_KEY_ID") or "").strip()
        secret_access_key = str(source.get("POLYWEATHER_R2_SECRET_ACCESS_KEY") or "").strip()
        if not all([account_id, bucket, access_key_id, secret_access_key]):
            return None
        return cls(
            account_id=account_id,
            bucket=bucket,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            endpoint_url=str(source.get("POLYWEATHER_R2_ENDPOINT_URL") or "").strip(),
            region=str(source.get("POLYWEATHER_R2_REGION") or R2_REGION).strip() or R2_REGION,
        )

    @property
    def base_url(self) -> str:
        if self.endpoint_url:
            return self.endpoint_url.rstrip("/")
        return f"https://{self.bucket}.{self.account_id}.r2.cloudflarestorage.com"


Transport = Callable[[Request, float], Any]


def _default_transport(request: Request, timeout: float) -> Any:
    return urlopen(request, timeout=timeout)


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sign(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def _signature_key(secret: str, date_stamp: str, region: str) -> bytes:
    k_date = _sign(("AWS4" + secret).encode("utf-8"), date_stamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, R2_SERVICE)
    return _sign(k_service, "aws4_request")


class R2ObjectStore:
    def __init__(
        self,
        config: R2ArchiveConfig,
        *,
        transport: Transport = _default_transport,
        timeout_sec: float = 30.0,
    ) -> None:
        self.config = config
        self.transport = transport
        self.timeout_sec = max(1.0, float(timeout_sec))

    def put_object(self, key: str, body: bytes, *, content_type: str = "application/octet-stream") -> dict[str, Any]:
        object_key = quote(str(key).lstrip("/"), safe="/")
        url = f"{self.config.base_url}/{object_key}"
        parsed = urlparse(url)
        host = parsed.netloc
        payload_hash = _sha256_hex(body)
        now = datetime.now(timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")
        canonical_uri = parsed.path or "/"
        canonical_headers = (
            f"content-type:{content_type}\n"
            f"host:{host}\n"
            f"x-amz-content-sha256:{payload_hash}\n"
            f"x-amz-date:{amz_date}\n"
        )
        signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date"
        canonical_request = "\n".join(
            [
                "PUT",
                canonical_uri,
                "",
                canonical_headers,
                signed_headers,
                payload_hash,
            ]
        )
        credential_scope = f"{date_stamp}/{self.config.region}/{R2_SERVICE}/aws4_request"
        string_to_sign = "\n".join(
            [
                "AWS4-HMAC-SHA256",
                amz_date,
                credential_scope,
                _sha256_hex(canonical_request.encode("utf-8")),
            ]
        )
        signature = hmac.new(
            _signature_key(self.config.secret_access_key, date_stamp, self.config.region),
            string_to_sign.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        authorization = (
            "AWS4-HMAC-SHA256 "
            f"Credential={self.config.access_key_id}/{credential_scope}, "
            f"SignedHeaders={signed_headers}, "
            f"Signature={signature}"
        )
        request = Request(url, data=body, method="PUT")
        request.add_header("Content-Type", content_type)
        request.add_header("Host", host)
        request.add_header("X-Amz-Content-Sha256", payload_hash)
        request.add_header("X-Amz-Date", amz_date)
        request.add_header("Authorization", authorization)

        with self.transport(request, self.timeout_sec) as response:
            response.read()
            status = int(getattr(response, "status", 200) or 200)
        return {"ok": 200 <= status < 300, "status": status, "key": key}


def build_realtime_archive_key(source: str, archive_date: str, stream_name: str = "city_observation_patch") -> str:
    parts = str(archive_date).split("-")
    if len(parts) != 3:
        raise ValueError("archive_date must be YYYY-MM-DD")
    year, month, day = parts
    safe_source = quote(str(source or "unknown").strip().lower() or "unknown", safe="")
    safe_stream = quote(str(stream_name or "events").strip().lower() or "events", safe="")
    return f"sse-events/{year}/{month}/{day}/{safe_stream}.{safe_source}.jsonl"


def events_to_jsonl(events: Iterable[dict[str, Any]]) -> bytes:
    lines = [
        json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        for event in events
    ]
    if not lines:
        return b""
    return ("\n".join(lines) + "\n").encode("utf-8")
