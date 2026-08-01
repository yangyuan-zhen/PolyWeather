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
- 周榜：`/api/ops/leaderboard/weekly`
- 用户反馈：`/api/ops/feedback`
- 会员：`/api/ops/memberships`（含 `/memberships/growth`、`/memberships/overview`）
- 支付：`/api/ops/payments`、`/api/ops/payments/incidents`、`/api/ops/refunds`、`/api/ops/billing-risk`
- 审计日志：`/api/ops/audit-log`
- 漏斗转化：`/api/ops/analytics/funnel`
- 结算真值历史：`/api/ops/truth-history`
- 观测源健康：`/api/ops/source-health`
- 观测采集器状态：`/api/ops/observation-collector-status`
- 训练准确性：`/api/ops/training/accuracy`
- Telegram 会员审计：`/api/ops/telegram/members-audit`
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

- [MONITORING_ZH.md](./MONITORING_ZH.md)
