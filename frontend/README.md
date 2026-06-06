# PolyWeather 前端

PolyWeather Pro 的生产前端工程。

线上地址：
- [https://polyweather.top/](https://polyweather.top/)

## 技术栈

- Next.js App Router
- React + Tailwind
- 自研温度图表 + Recharts 运营图表
- Supabase Auth
- WalletConnect + 浏览器 EVM 钱包

## 运行模型

1. 浏览器 -> Next 应用（`frontend`）
2. Next Route Handlers（`/api/*`）-> FastAPI 后端
3. FastAPI -> 分析服务 / 支付服务

## 当前前端能力

- 主站为实时天气决策台，包含 `天气决策 / 训练数据 / 使用指南` 三个主入口
- `/docs` 提供公开双语产品文档中心，当前保留简介、图表阅读、实时数据频率、结算站点和浏览器插件说明
- 天气决策台支持 1x1 到 3x3 图表槽位，可按区域、搜索和城市选择进行多城市巡检
- 终端图表默认展示全天，可切换高温窗口；所有横轴与 tooltip 时间按城市当地时间渲染
- 可见终端图表通过 SSE patch 增量刷新，后台切回前台时主动补齐最新 detail，不用 loading 遮罩覆盖已有曲线
- AMSC/AMOS 跑道城市默认展示结算跑道曲线并高亮，辅助跑道弱化展示；单跑道机场不重复展示聚合线
- 香港默认展示 CoWIN 6087 参考站 1 分钟曲线，并保留 HKO 10 分钟官方气象层
- legacy 高斯概率在图表上展示为概率温度带和 `mu` 参考线，不作为时间序列曲线
- 使用指南内置图表阅读顺序、图层含义、常用操作和默认可见性规则
- `/ops` 已支持桌面表格 + 手机端卡片化视图
- 城市 detail 自动识别稀疏缓存并主动刷新，避免误把残缺 detail 当作完整结果
- 市场价格层使用完整 `all_buckets` 匹配温度桶，市场信号作为交易判断层，不替代实测结算源
- legacy 高斯概率在图表上展示为概率温度带和 `mu` 参考线，不作为时间序列曲线
- 账户中心支付区支持后端下发的多链网络选择；Polygon 继续走 checkout 合约，Ethereum 主网 USDC 走手动直转确认
- 缓存桶状态与 summary cache hit/miss

## 本地开发

```bash
cd frontend
cp .env.example .env.local
npm ci
npm run dev
```

## Vercel 最小部署配置

只跑看板和基础鉴权时，先填这 4 项：

```env
POLYWEATHER_API_BASE_URL=https://<your-fastapi-host>
NEXT_PUBLIC_SUPABASE_URL=https://<your-supabase-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
POLYWEATHER_AUTH_ENABLED=true
```

建议显式补：

```env
POLYWEATHER_AUTH_REQUIRED=true
```

如果你只是开放游客浏览，可改成：

```env
POLYWEATHER_AUTH_ENABLED=false
POLYWEATHER_AUTH_REQUIRED=false
```

## 可选环境变量

仅在对应功能启用时填写：

```env
# 看板分享令牌
POLYWEATHER_DASHBOARD_ACCESS_TOKEN=

# 前端 API 转发到后端时使用的共享令牌
POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN=

# 钱包支付
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_WALLETCONNECT_POLYGON_RPC_URL=https://polygon-bor-rpc.publicnode.com
NEXT_PUBLIC_PAYMENT_ALLOWED_HOSTS=polyweather.top,www.polyweather.top
POLYWEATHER_OPS_ADMIN_EMAILS=yhrsc30@gmail.com

# 社群入口
NEXT_PUBLIC_TELEGRAM_GROUP_URL=https://t.me/<your_group>
NEXT_PUBLIC_TELEGRAM_BOT_URL=https://t.me/polyyuanbot

# 推荐默认关闭的前端观测 / 预热开关
NEXT_PUBLIC_POLYWEATHER_APP_ANALYTICS=false
NEXT_PUBLIC_POLYWEATHER_WEB_VITALS=false
NEXT_PUBLIC_POLYWEATHER_EAGER_CITY_SUMMARIES=false
```

更完整的 Vercel 配置说明见：
- [docs/FRONTEND_DEPLOYMENT_ZH.md](/E:/web/PolyWeather/docs/FRONTEND_DEPLOYMENT_ZH.md)

## 路由处理器

天气：

- `GET /api/cities`
- `GET /api/city/[name]`
- `GET /api/city/[name]/summary`
- `GET /api/city/[name]/detail`

鉴权：

- `GET /api/auth/me`

支付：

- `GET /api/payments/config`
- `GET /api/payments/wallets`
- `POST /api/payments/wallets/challenge`
- `POST /api/payments/wallets/verify`
- `POST /api/payments/intents`
- `GET /api/payments/intents/[intentId]`
- `POST /api/payments/intents/[intentId]/submit`
- `POST /api/payments/intents/[intentId]/confirm`

Ops：

- `GET /ops`
- `GET /api/ops/users`
- `GET /api/ops/leaderboard/weekly`
- `GET /api/ops/memberships`
- `GET /api/ops/payments/incidents`
- `POST /api/ops/users/grant-points`
- `POST /api/ops/payments/incidents/[eventId]/resolve`

## Ops 管理后台

当前前端已内置轻量管理页：

- [https://polyweather.top/ops](https://polyweather.top/ops)

页面当前支持：

- 系统状态
- SQLite / rollout / 支付运行态
- 缓存桶状态与 summary cache hit/miss
- 用户查询
- 当前会员
- 本周积分榜
- 手动补分
- 支付异常单筛选与标记已处理
- 手机端卡片化视图

注意：

- `/ops` 现在是前后端双层管理员限制
- Vercel 前端和后端都应配置相同的 `POLYWEATHER_OPS_ADMIN_EMAILS`
- 前端登录邮箱本身不会自动获得管理员权限

## 支付安全补充

为降低“旧页面/旧配置导致打到旧收款地址”的风险，支付区现在会：

1. 点击支付前重新请求 `/api/payments/config`
2. 若 `receiver_contract` 已更新，先切到最新地址
3. 若后端返回的 `tx_payload.to` 与最新地址不一致，直接阻断支付
4. 仅允许在 `NEXT_PUBLIC_PAYMENT_ALLOWED_HOSTS` 白名单域名上创建 payment intent
5. 支付区会明确显示当前账号、付款钱包、支付网络和收款合约/钱包，避免账号/钱包/地址/链混淆
6. 多链支付时，前端会把用户选择的 `chain_id` 和 `token_address` 发给后端，由后端按 intent 的链确认交易

这意味着：

- 旧标签页风险已明显降低
- 但支付地址变更后，仍建议在 Vercel 上 redeploy 当前 production，并清理明显过期 deployment

## 缓存行为

- `cities` / `summary` / `history`：`ETag + Cache-Control`
- `summary?force_refresh=true`：`no-store`
- 支付相关路由：`no-store`
- 当 detail 缓存只返回单模型或单日 forecast 时，前端会自动强刷完整 detail，并在补齐前显示同步提示 / 占位卡
- detail 正在切换城市、日期或分辨率时，图表保留已有曲线并显示同步提示，避免把旧数据当作当前状态
- 终端图表订阅 `/api/events?cities=...&since_revision=...&replay_limit=按可见城市数动态限制`，接收 `city_observation_patch.v1`；无 patch 超过 2 分钟时，可见图表才触发 60 秒兜底刷新
- 前端只消费 HTTP snapshot + SSE patch，不直接感知 Redis；Redis Stream / SQLite event log 都由后端统一封装

## Vercel 节流建议

- 生产环境建议关闭 `Web Analytics` 和 `Speed Insights`
- 建议把自建 `app analytics / web vitals / eager city summaries` 默认保持关闭
- 如果你部署在 Vercel，可在 Firewall 中加一条 `WordPress / php scanner` 拦截规则，避免无效扫描白白触发 middleware

## AGPL 与商用边界说明

此前端代码随仓库一起采用 `AGPL-3.0-only`。
生产私有运营流程、商业策略调优、敏感生产参数、品牌与托管服务能力不在代码许可证授权范围内。

详见根目录策略文档：`docs/OPEN_CORE_POLICY.md`

最后更新：`2026-05-29`
