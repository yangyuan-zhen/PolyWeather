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

## 本地开发

```bash
cd frontend
cp .env.example .env.local
npm install
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

# 社群入口
NEXT_PUBLIC_TELEGRAM_GROUP_URL=https://t.me/<your_group>
NEXT_PUBLIC_TELEGRAM_BOT_URL=https://t.me/WeatherQuant_bot
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

## 缓存行为

- `cities` / `summary` / `history`：`ETag + Cache-Control`
- `summary?force_refresh=true`：`no-store`
- 支付相关路由：`no-store`

## 开源边界说明

此前端仓库包含通用产品界面和标准支付体验。
商业策略调优、私有运营流程和敏感生产参数不在公开文档范围内。

详见根目录策略文档：`docs/OPEN_CORE_POLICY.md`

最后更新：`2026-03-20`