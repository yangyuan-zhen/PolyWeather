# 外部服务依赖总览

> 由 SERVICES_ZH.md + OPS_ADMIN_ZH.md + MONITORING_ZH.md 合并（2026-08-16）


最后更新：`2026-08-01`

项目调用外部天气、鉴权、支付和实时事件服务。原则是：核心链路必须有明确健康检查；可选数据源不可拖垮已可用城市；实时事件层可从 Redis Stream 降级到 SQLite event log。

## 核心（必须有，挂了服务不可用）

| 服务 | 用途 | 状态 |
| --- | --- | --- |
| Open-Meteo | 51 城天气预报、多模型小时曲线、DEB hourly consensus 输入 | ✅ |
| AviationWeather (NOAA) | METAR / TAF 航空观测 | ✅ |
| MADIS (NOAA) | 美国机场 5 分钟高频观测 | ✅ |
| Supabase | 用户认证、订阅状态、会员恢复 | ✅ |
| Telegram Bot API | 机器人私聊查询、支付私聊通知 | ✅ |
| Redis | `city_observation_patch.v1` Stream、SSE replay、多 worker fanout | ✅ |
| SQLite | 运行态数据库、支付审计、实时事件 fallback | ✅ |

## 国家气象源（特定城市必须）

| 服务 | 城市 | 状态 |
| --- | --- | --- |
| JMA AMeDAS | Tokyo | ✅ |
| MGM (土耳其) | Ankara, Istanbul | ✅ |
| FMI (芬兰) | Helsinki | ✅ |
| KNMI (荷兰) | Amsterdam | ✅（需 key） |
| CoWIN 6087 (香港) | Hong Kong 1 分钟参考站 | ✅ |
| HKO (香港) | Hong Kong / Shenzhen / Lau Fau Shan 10 分钟官方气象层 | ✅ |
| Singapore MSS | Singapore | ✅ |
| IMS Lod (以色列) | Tel Aviv | ✅ |
| AEROWEB / AROME HD | Paris | ✅ |
| NCM (沙特) | Jeddah 机场观测 | ✅ |
| SynopticData (NOAA 结算) | 结算观测（11 城） | ✅（需 key） |
| IMGW (波兰) | Warsaw 结算（可选） | ⚠️ 未配 key |

## 可选 / 已禁用

| 服务 | 用途 | 状态 |
| --- | --- | --- |
| OpenWeatherMap | 天气 fallback | ⚠️ 未配 key |
| VisualCrossing | 历史天气 | ⚠️ 未配 key |
| Meteoblue | 天气预报 | ❌ 已移除 |
| Russia pogodaiklimat | Moscow 历史源 | ❌ 已移除 |
| Groq | AI commentary | ❌ 已移除 |
| Wunderground | 站点观测 | ❌ 已移除 |
| CWA (台湾) | Taipei 站点观测 | ❌ 已移除（零匹配） |
| AMSC AWOS (中国) | 中国跑道端点气温 | ❌ 已移除 |
| NMC/CMA (中国) | 国内城市 fallback | ❌ 已移除 |

## AI / 支付 / 前端

| 服务 | 用途 | 状态 |
| --- | --- | --- |
| MiMo (xiaomimimo) | 城市分析 AI 评论 | ✅ 当前使用 |
| DeepSeek | AI fallback | 备用 |
| Polygon RPC | checkout 合约支付、Polygon USDC / USDC.e 自动确认 | ✅ |
| Ethereum RPC | Ethereum 主网 USDC 直转确认 | ✅（启用多链支付时必须） |
| WalletConnect | 前端钱包连接 | ⚠️ 未配 key 时钱包入口降级 |

## 运维口径

- 生产实时事件推荐：`POLYWEATHER_EVENT_STORE=redis` + `POLYWEATHER_REDIS_URL=redis://polyweather_redis:6379/0`。
- 本地或单进程兜底：`POLYWEATHER_EVENT_STORE=sqlite`。
- Redis 只负责短窗口 replay 与多 worker fanout，不是长期天气历史库。
- DEB hourly consensus 依赖 Open-Meteo 多模型小时曲线；若上游限流，图表应保留已有 snapshot 和实测 patch，不把缺失模型误报为实测缺失。
- 支付多链确认依赖 `POLYWEATHER_PAYMENT_RPC_URLS_BY_CHAIN_JSON`；如果启用 Ethereum 主网 USDC，必须配置 `chain_id=1` 的 RPC，否则用户提交 Ethereum tx hash 后无法自动确认。


---

# Ops 运营后台说明

最后更新：`2026-08-01`

## 1. 入口

前端入口：

- `https://polyweather.top/ops`

## 2. 权限

`/ops` 的写接口由后端白名单控制：

```env
POLYWEATHER_OPS_ADMIN_EMAILS=yhrsc30@gmail.com
```

可配置多个邮箱，逗号分隔。

说明：

- 前端页面入口与后端写接口都读取 `POLYWEATHER_OPS_ADMIN_EMAILS`，前端容器与后端容器应配置相同白名单。
- `/metrics` 同样需要 ops 鉴权。

## 3. 当前能力

### 只读能力

- 系统健康：`/api/ops/health-check`、`/api/ops/logs`
- 系统状态 / 缓存桶 / summary 缓存命中（`/api/system/status`、`/api/system/cache-status`）
- 在线用户与用户列表：`/api/ops/online-users`、`/api/ops/users`
- 用户反馈：`/api/ops/feedback`
- 会员：`/api/ops/memberships`（含 `/memberships/growth`、`/memberships/overview`）
- 支付：`/api/ops/payments`、`/api/ops/payments/incidents`、`/api/ops/refunds`、`/api/ops/billing-risk`
- 审计日志：`/api/ops/audit-log`
- 漏斗转化：`/api/ops/analytics/funnel`
- 结算真值历史：`/api/ops/truth-history`
- 观测源健康：`/api/ops/source-health`
- 观测采集器状态：`/api/ops/observation-collector-status`
- 训练准确性：`/api/ops/training/accuracy`
- 市场机会：`/api/ops/market-opportunities`
- 运行配置：`/api/ops/config`、`/api/ops/sensitive-config`

### 写能力

- 手动补分：`POST /api/ops/users/grant-points`
- 积分转账：`POST /api/ops/users/transfer-points`
- 反馈状态更新：`POST /api/ops/feedback/{feedback_id}/status`
- 反馈积分奖励：`POST /api/ops/feedback/{feedback_id}/reward`
- 标记支付异常单“已处理”：`POST /api/ops/payments/incidents/{event_id}/resolve`
- 退款处理：`POST /api/ops/refunds`、`PATCH /api/ops/refunds/{case_id}`
- 订阅授予 / 延期：`POST /api/ops/subscriptions/grant`、`POST /api/ops/subscriptions/extend`
- 运行配置更新：`PUT /api/ops/config`、`PUT /api/ops/sensitive-config`

## 4. 当前会员

会员列表来自：

1. `subscriptions` 中的有效订阅
2. 本地 `users` / `supabase_bindings`
3. 若本地缺邮箱或注册时间，再回补 Supabase Auth 用户信息

去重规则：

- 同一个 `user_id` 只保留最晚到期那条

## 5. 支付异常单

当前异常单来源：

- `payment_audit_events`
- 仅筛 `payment_intent_failed`

当前支持的典型失败原因：

- `receiver_mismatch`
- `sender_mismatch`
- `event_mismatch`
- `tx_reverted`

默认只显示未处理项。

## 6. 典型处理流程

### 6.1 钱已到账但没开订阅

先看 `/ops` 的支付异常单：

- 如果是 `receiver_mismatch`
  - 优先判定为支付打到了旧收款地址
  - 不是缓存问题

然后执行：

1. 查 `payment_intents`
2. 查 `payment_transactions`
3. 查 `subscriptions`
4. 跑恢复脚本：

```bash
python scripts/reconcile_subscription_by_email.py --email <user_email>
```

如果仍然失败，再人工补订阅（`/api/ops/subscriptions/grant`）。

### 6.2 已人工处理

在 `/ops` 里直接点：

- `标记已处理`

这不会删除审计事件，只会给原事件写：

- `resolved_at`
- `resolved_by`

## 7. 系统状态与缓存桶口径

`/ops` 里的系统状态卡展示：

- `thread_alive` / `heartbeat_age_sec`
- 最近一轮：
  - `cycle_count`
  - `success_count / failure_count`
  - `last_started_at / last_finished_at`
  - `last_summary_ok / last_detail_ok / last_market_ok`

缓存桶按 5 种 kind 组织（`/api/system/cache-status`，见 `web/services/system_api.py` + `src/database/db_manager.py`）：

- `summary` → `city_summary_cache`
- `panel` → `city_panel_cache`
- `nearby` → `city_nearby_cache`
- `market` → `city_market_cache`
- `full` → `city_full_cache`

每 kind 返回 `exists / fresh / updated_at / age_sec / ttl_sec`；TTL 默认由 `SCAN_ROWS_REFRESH_SEC`（120s）与 `OBSERVATION_REFRESH_SEC`（60s）钳制，可用 `POLYWEATHER_CITY_*_CACHE_TTL_SEC` 覆盖（见 `web/services/city_runtime.py`）。

- `summary` 层缓存命中率：
  - `total_requests`
  - `cache_hits / cache_misses`
  - `hit_rate / miss_rate`

Open-Meteo 缓存为独立存储（`open_meteo_cache_store`，source_kind：`forecast` / `ensemble` / `multi_model`）。

## 8. 备注

### 8.1 当前用途边界

`/ops` 是运营后台最小版，不是完整 Admin 平台。当前目标是：

- 让会员、积分、支付事故、反馈、系统状态可查
- 让常见人工操作不必再直接写 SQL

### 8.2 观测与健康

- 观测源健康（`/api/ops/source-health`）：按城市列出 settlement / airport_metar / airport_primary / official_network / nearby_official / expected_source 各源状态，优先级 `stale > missing > delayed > unknown > expected_wait > fresh`。
- 观测采集器状态（`/api/ops/observation-collector-status`）：各来源最近轮次快照。
- 训练准确性（`/api/ops/training/accuracy`）：DEB / μ 回测摘要（样本上限 400）。

外部监控与巡检说明见：

- 监控与巡检说明：见本文档第三部分「监控与巡检说明」。


---

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
