# 监控与巡检说明（中文）

最后更新：`2026-08-01`

## 1. 目标

PolyWeather 的监控收敛为**轻量链路**：不依赖外部监控栈（Prometheus / Alertmanager / Grafana / Alert Relay 已在 1.9.0 移除，`monitoring/` 目录与 `--profile monitoring` 不再存在），改由：

- FastAPI 内置只读端点（`/healthz`、`/api/system/status`、`/api/system/cache-status`、`/metrics` 等）提供可观测性；
- `/ops` 运营后台提供更贴业务的运行态视图（源健康、观测采集器、训练准确性）；
- 巡检脚本 `scripts/check_ops_health.py` 做无依赖健康检查，可挂 crontab / systemd timer。

## 2. 轻量链路组件

| 组件 | 用途 |
| :-- | :-- |
| `/healthz` | 存活探针，返回 `{"status":"ok"}` |
| `/api/system/status` | 系统状态摘要（DB、特性开关、事件存储） |
| `/api/system/cache-status` | 按城市列出各缓存 kind 的存在性、新鲜度、TTL |
| `/api/system/priority-warm`（POST） | 按时区选择主/次城市批次，触发 `panel` 缓存刷新入队 |
| `/metrics` | Prometheus 文本格式指标（ops 鉴权保护） |
| `/api/dashboard/init` | 前端初始化载荷 |
| `scripts/check_ops_health.py` | 无依赖巡检：healthz + system status + metrics |

端点实现在 `web/routers/system.py`，巡检脚本在 `scripts/check_ops_health.py`。

## 3. 启动与默认端口

轻量链路随 `web` 服务一起启动，无独立容器、无额外端口：

```bash
docker compose up -d
```

```bash
curl http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/system/status
curl http://127.0.0.1:8000/api/system/cache-status
curl http://127.0.0.1:8000/metrics
```

## 4. 环境变量

`.env.example` 中与监控相关的仅剩：

```env
POLYWEATHER_MONITORING_ALERT_CHAT_IDS=
```

说明：

- 该变量目前**仅作为 `.env.example` 占位保留，代码中已无消费者**；早期 Alert Relay 推送逻辑已随监控栈移除。
- 监控相关的 `POLYWEATHER_PROMETHEUS_PORT`、`POLYWEATHER_ALERTMANAGER_PORT`、`POLYWEATHER_ALERT_RELAY_PORT`、`POLYWEATHER_GRAFANA_*` 均已删除。
- `/metrics` 需要 ops 鉴权（与 `/ops` 一致），不再有 Prometheus 独立抓取配置。

## 5. 缓存状态与 TTL（`/api/system/cache-status`）

缓存按 5 种 kind 组织（`web/services/system_api.py` + `src/database/db_manager.py`）：

| kind | 缓存表 | TTL 默认来源 |
| :-- | :-- | :-- |
| `summary` | `city_summary_cache` | `min(SCAN_ROWS_REFRESH_SEC=120, env)` |
| `panel` | `city_panel_cache` | `min(SCAN_ROWS_REFRESH_SEC=120, env)` |
| `nearby` | `city_nearby_cache` | `min(SCAN_ROWS_REFRESH_SEC=120, env)` |
| `market` | `city_market_cache` | `min(SCAN_ROWS_REFRESH_SEC=120, env)` |
| `full` | `city_full_cache` | `min(OBSERVATION_REFRESH_SEC=60, env)` |

- 刷新间隔常量定义在 `src/utils/refresh_policy.py`（`OBSERVATION_REFRESH_SEC=60`、`SCAN_ROWS_REFRESH_SEC=120`）。
- 每 kind 可通过 `POLYWEATHER_CITY_*_CACHE_TTL_SEC` 覆盖（如 `POLYWEATHER_CITY_SUMMARY_CACHE_TTL_SEC`），实现见 `web/services/city_runtime.py`。
- 接口返回每个城市每 kind 的 `exists / fresh / updated_at / age_sec / ttl_sec`。
- Open-Meteo 缓存为独立存储（`open_meteo_cache_store`，source_kind：`forecast` / `ensemble` / `multi_model`，见 `src/database/runtime_state.py`），TTL 由 `OPEN_METEO_*_CACHE_TTL_SEC` 控制。

## 6. 巡检脚本

```bash
python scripts/check_ops_health.py --base-url http://127.0.0.1:8000
```

脚本检查：

- `/healthz` 返回 `status=ok`
- `/api/system/status` 返回 `status=ok` 且 `db.ok=true`
- `/metrics` 暴露 `polyweather_http_requests_total` 或 `polyweather_source_requests_total`

任何一项失败都会非零退出，适合挂到 crontab 或 systemd timer。

## 7. 内置运行态观测（`/ops`）

除了上面的轻量端点，`/ops` 运营后台提供更贴业务的只读运行态（实现集中在 `web/services/ops/health.py`）：

- `/api/ops/health-check`：系统健康检查（`web/routers/ops.py`）
- `/api/ops/source-health`：按城市列出观测源健康（settlement / airport_metar / airport_primary / official_network / nearby_official / expected_source），状态优先级 `stale > missing > delayed > unknown > expected_wait > fresh`
- `/api/ops/observation-collector-status`：独立观测采集器各来源最近轮次快照
- `/api/ops/training/accuracy`：DEB / μ 训练准确性回测摘要（样本上限 `_DEB_VERSION_BACKTEST_SAMPLE_LIMIT=400`）
- `/api/ops/truth-history`：结算真值历史
- 系统状态卡：`thread_alive` / `heartbeat_age_sec`、最近一轮 `cycle_count` / `success_count` / `failure_count`、`last_summary_ok / last_detail_ok / last_market_ok`

## 8. 实时事件层观察点

实时事件层建议额外观察：

- `/api/system/status` 中的 event store 类型（Redis / SQLite）
- Redis Stream latest revision 与连接状态
- SQLite fallback 是否被启用（`degraded_from=redis`）
- `/api/events` SSE active connection count 与 `resync_required` 出现频率

## 9. 备注

### 已覆盖

- 存活/系统/缓存/指标端点
- 无依赖巡检脚本
- `/ops` 源健康、采集器状态、训练准确性、真值历史
- 实时事件 replay 状态

### 尚未覆盖

- 节点级 CPU / 内存 / 磁盘（由 VPS 侧工具负责）
- 数据库体积趋势
- 更细粒度支付指标
- 按城市/来源拆分的业务 SLA
- 按城市拆分的前端补齐耗时与 stale-detail 告警
- Redis Stream 长度、内存与 replay gap 告警

### 历史说明

1.9.0 之前存在 Prometheus / Alertmanager / Alert Relay / Grafana 四组件外部监控栈（`docker compose --profile monitoring` 启动、`monitoring/prometheus/*.yml` 规则与 Grafana 面板），1.9.0 已随监控收敛移除；需要时可在 VPS 侧自建抓取 `/metrics`，后端无需改动。
