# Changelog

## Unreleased

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
