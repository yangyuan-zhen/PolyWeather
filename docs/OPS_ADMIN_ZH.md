# Ops 运营后台说明

最后更新：`2026-04-10`

## 1. 入口

前端入口：

- `https://polyweather-pro.vercel.app/ops`

## 2. 权限

`/ops` 的写接口由后端白名单控制：

```env
POLYWEATHER_OPS_ADMIN_EMAILS=yhrsc30@gmail.com
```

可配置多个邮箱，逗号分隔。

## 3. 当前能力

### 只读能力

- 系统健康
- SQLite / rollout / metrics 摘要
- 支付运行态
- prewarm worker 运行态
- 缓存桶状态与 summary cache hit/miss
- 当前会员
- 周榜
- 支付异常单
- 漏斗转化面板

### 写能力

- 手动补分
- 标记支付异常单“已处理”

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

如果仍然失败，再人工补订阅。

### 6.2 已人工处理

在 `/ops` 里直接点：

- `标记已处理`

这不会删除审计事件，只会给原事件写：

- `resolved_at`
- `resolved_by`

## 7. 备注

### 7.1 当前 prewarm / 缓存观测项

`/ops` 里的系统状态卡目前已额外展示：

- `prewarm` 是否启用
- `thread_alive` / `heartbeat_age_sec`
- 最近一轮：
  - `cycle_count`
  - `success_count / failure_count`
  - `last_started_at / last_finished_at`
  - `last_summary_ok / last_detail_ok / last_market_ok`
- 缓存桶数量：
  - `api_cache`
  - `metar`
  - `taf`
  - `nmc`
  - `settlement`
  - `open_meteo forecast / ensemble / multi-model`
- `summary` 层缓存命中率：
  - `total_requests`
  - `cache_hits / cache_misses`
  - `hit_rate / miss_rate`

### 7.2 当前用途边界

`/ops` 是运营后台最小版，不是完整 Admin 平台。当前目标是：

- 让会员、积分、支付事故、系统状态可查
- 让常见人工操作不必再直接写 SQL

外部监控与告警栈说明见：

- [MONITORING_ZH.md](./MONITORING_ZH.md)
