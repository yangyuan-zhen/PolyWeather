# ADR-001 采集超时：全局 8s + 分源细分，保持现状

- 现状：`WeatherDataCollector.timeout` 默认 8s（`POLYWEATHER_HTTP_TIMEOUT_SEC` 可调）；
  open_meteo 5s / metar 4s / metar_latest 2.5s / cluster 3.5s / MADIS 15s。
  断言见 `weather_sources.py:142-172,508-512,769`。
- 风险量化：`run_due_once` 对到期城市串行采集，单 tick 最坏耗时 ≈ 各到期源超时之和；
  每次 fetch 均有 httpx 超时上限，故单城故障最多拖慢本轮、不会卡死（异常按
  timeout/auth_error/error 分类记 status，见 `_failure_status_from_exception`）。
- 决策：不改并发模型（改动面大、回归风险高）。`failure injection` 已覆盖
  timeout 分类与单城隔离。
- 下一步：若 tick p99 持续超 30s，考虑按 source 分 worker 池；先在 status
  `last_latency_ms` 上观察。
