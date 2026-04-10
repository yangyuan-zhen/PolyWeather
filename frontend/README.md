# PolyWeather 前端

PolyWeather Pro 的生产前端工程。

线上地址：
- [https://polyweather-pro.vercel.app/](https://polyweather-pro.vercel.app/)

## 技术栈

- Next.js App Router
- React + Tailwind
- Leaflet + Chart.js
- Supabase Auth
- WalletConnect + 浏览器 EVM 钱包

## 运行模型

1. 浏览器 -> Next 应用（`frontend`）
2. Next Route Handlers（`/api/*`）-> FastAPI 后端
3. FastAPI -> 分析服务 / 支付服务

## 当前前端能力

- 主站 Dashboard 支持地图、城市详情、今日日内分析、历史准确率对账和账户中心
- `/docs` 已提供公开双语产品文档中心，解释日内结构信号、TAF、结算来源和历史对账
- 今日日内分析支持：
  - `锚点状态`
  - `当前节奏`
  - `当前命中胜率`
  - `模型区间与分歧`
  - `今日日内结构信号`
  - 非香港机场城市的 `TAF` 时段提示与走势图联动
- 历史对账支持：
  - `DEB / 最佳单模型 / 实测最高温` 对比
  - 峰值前 12 小时 `DEB` 参考（近似）
- `/ops` 已支持桌面表格 + 手机端卡片化视图
- 点击城市图标后会显示地图顶部同步提醒与详情面板内同步徽标，避免用户误判为卡住
- 城市详情会自动识别“单模型 / 单日”的稀疏缓存并主动刷新，避免误把残缺 detail 当作完整结果
- `/ops` 现已展示 prewarm worker 运行态、缓存桶状态与 summary cache hit/miss

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
NEXT_PUBLIC_PAYMENT_ALLOWED_HOSTS=polyweather-pro.vercel.app
POLYWEATHER_OPS_ADMIN_EMAILS=yhrsc30@gmail.com

# 社群入口
NEXT_PUBLIC_TELEGRAM_GROUP_URL=https://t.me/<your_group>
NEXT_PUBLIC_TELEGRAM_BOT_URL=https://t.me/WeatherQuant_bot

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
- `GET /api/history/[name]`

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

- [https://polyweather-pro.vercel.app/ops](https://polyweather-pro.vercel.app/ops)

页面当前支持：

- 系统状态
- SQLite / rollout / 支付运行态
- prewarm worker 运行态
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
5. 支付区会明确显示当前账号、付款钱包和收款合约，避免账号/钱包/地址混淆

这意味着：

- 旧标签页风险已明显降低
- 但支付地址变更后，仍建议在 Vercel 上 redeploy 当前 production，并清理明显过期 deployment

## 缓存行为

- `cities` / `summary` / `history`：`ETag + Cache-Control`
- `summary?force_refresh=true`：`no-store`
- 支付相关路由：`no-store`
- 当 detail 缓存只返回单模型或单日 forecast 时，前端会自动强刷完整 detail

## Vercel 节流建议

- 生产环境建议关闭 `Web Analytics` 和 `Speed Insights`
- 建议把自建 `app analytics / web vitals / eager city summaries` 默认保持关闭
- 如果你部署在 Vercel，可在 Firewall 中加一条 `WordPress / php scanner` 拦截规则，避免无效扫描白白触发 middleware

## AGPL 与商用边界说明

此前端代码随仓库一起采用 `AGPL-3.0-only`。
生产私有运营流程、商业策略调优、敏感生产参数、品牌与托管服务能力不在代码许可证授权范围内。

详见根目录策略文档：`docs/OPEN_CORE_POLICY.md`

最后更新：`2026-04-10`
