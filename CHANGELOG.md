# Changelog

## Unreleased

- 新增 `/ops` 轻量运营后台，支持系统状态、会员列表、用户查询、周榜、手动补分
- `/ops` 新增支付异常单，支持按原因筛选并手动标记“已处理”
- 会员列表支持按 `user_id` 去重，并回补 Supabase Auth 邮箱/注册时间
- 新增按邮箱补跑订阅恢复脚本 `scripts/reconcile_subscription_by_email.py`
- 支付确认失败（如 `receiver_mismatch`）现在会明确落 `failed`，并写入 SQLite 审计事件
- 账户页支付前强制重新拉取 `/api/payments/config`，并对 `tx_payload.to` 做最新地址校验
- 城市详情页新增 `官方参考 / Official Sources` 区块，覆盖主要城市的官方机构/机场/METAR 链接
- 前端钱包选择补齐 EIP-6963 发现、稳定去重和绑定后账户状态即时刷新

## 1.5.0 - 2026-03-21

- 运行态状态与缓存支持 SQLite 渐进迁移，新增 `POLYWEATHER_STATE_STORAGE_MODE=file|dual|sqlite`
- 新增 `/healthz`、`/api/system/status`、`/metrics`
- 新增支付运行态接口 `/api/payments/runtime`
- 支付侧新增 SQLite 审计事件、事件重放脚本与多 RPC 容灾支持
- 新增支付静态审计脚本与 V2 合约升级草案
- 统一周积分显示口径，`/top` 中“我的状态”改为累计发言/本周排名/本周积分
- 文档同步更新为 2026-03-20 当前状态

## 1.4.0 - 2026-03-14

- 统一收费阶段产品口径，发布 PolyWeather Pro `v1.4.0`
- 前端交付覆盖账户、支付、权限展示与缓存策略
- 支付链路支持 intent -> submit -> confirm 与自动补单
- 文档统一切换到单一版本源管理
