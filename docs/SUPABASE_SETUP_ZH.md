# Supabase + 登录 + 支付接入说明（v1.5.0）

最后更新：`2026-03-14`

## 1. 目标

- 前端支持 Google 一键登录 + 邮箱注册/登录。
- 后端支持 Supabase JWT 鉴权。
- 支持 Polygon 合约支付（USDC / USDC.e）并自动确认开通订阅。

## 2. Supabase 控制台配置

1. `Auth -> Providers` 打开 `Google` 与 `Email`。
2. Google Cloud OAuth 回调配置：
   - `https://<project-ref>.supabase.co/auth/v1/callback`
3. `Auth -> URL Configuration` 添加：
   - 站点 URL（生产域名）
   - 回调 URL（例如 `https://polyweather-pro.vercel.app/auth/callback`）

## 3. 数据库脚本

在 Supabase SQL Editor 执行：

- `scripts/supabase/schema.sql`

会创建支付与订阅相关表：

- `subscriptions`
- `payments`
- `entitlement_events`
- `user_wallets`
- `wallet_link_challenges`
- `payment_intents`
- `payment_transactions`

## 4. 环境变量

### 4.1 前端（Vercel / frontend/.env.local）

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
POLYWEATHER_AUTH_ENABLED=true
POLYWEATHER_AUTH_REQUIRED=false
POLYWEATHER_API_BASE_URL=http://<backend-host>:8000
POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN=

# WalletConnect（支持手机钱包扫码）
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_WALLETCONNECT_POLYGON_RPC_URL=https://polygon-bor-rpc.publicnode.com

# Overlay 跳转
NEXT_PUBLIC_TELEGRAM_GROUP_URL=https://t.me/<your_group>
```

### 4.2 后端 / Bot（.env）

```env
POLYWEATHER_AUTH_ENABLED=true
POLYWEATHER_AUTH_REQUIRED=false
POLYWEATHER_AUTH_REQUIRE_SUBSCRIPTION=false

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_HTTP_TIMEOUT_SEC=8

POLYWEATHER_PAYMENT_ENABLED=true
POLYWEATHER_PAYMENT_CHAIN_ID=137
POLYWEATHER_PAYMENT_RPC_URL=https://polygon-bor-rpc.publicnode.com
POLYWEATHER_PAYMENT_RECEIVER_CONTRACT=0x<receiver_contract>
POLYWEATHER_PAYMENT_CONFIRMATIONS=2
POLYWEATHER_PAYMENT_INTENT_TTL_SEC=1800
POLYWEATHER_PAYMENT_WALLET_CHALLENGE_TTL_SEC=600
POLYWEATHER_PAYMENT_POLL_INTERVAL_SEC=4
POLYWEATHER_PAYMENT_MAX_WAIT_SEC=50

# 支持双币种（示例）
POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON=[{"code":"usdc_e","symbol":"USDC.e","name":"USDC.e (PoS)","address":"0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174","decimals":6,"receiver_contract":"0x<receiver>","is_default":true},{"code":"usdc","symbol":"USDC","name":"Native USDC","address":"0x3c499c542cef5e3811e1192ce70d8cc03d5c3359","decimals":6,"receiver_contract":"0x<receiver>"}]

# 套餐（当前只保留月付）
POLYWEATHER_PAYMENT_PLAN_CATALOG_JSON={"pro_monthly":{"plan_id":101,"amount_usdc":"5","duration_days":30}}
POLYWEATHER_PAYMENT_ALLOWED_PLAN_CODES=pro_monthly

# 积分抵扣
POLYWEATHER_PAYMENT_POINTS_ENABLED=true
POLYWEATHER_PAYMENT_POINTS_PER_USDC=500
POLYWEATHER_PAYMENT_POINTS_MAX_DISCOUNT_USDC=3

# 支付自动补单
POLYWEATHER_PAYMENT_EVENT_LOOP_ENABLED=true
POLYWEATHER_PAYMENT_CONFIRM_LOOP_ENABLED=true
```

## 5. 钱包异动频道拆分（推荐）

如果要把“钱包异动监控”发到独立频道：

```env
POLYMARKET_WALLET_ACTIVITY_CHAT_ID=-1003821482461
```

说明：

- 设置了 `POLYMARKET_WALLET_ACTIVITY_CHAT_ID(S)` 后，钱包异动推送优先发该频道。
- 未设置时，回退到全局 `TELEGRAM_CHAT_IDS/TELEGRAM_CHAT_ID`。

## 6. 验证步骤

1. 登录后请求 `/api/auth/me`，确认 `authenticated=true`。
2. 请求 `/api/payments/config`，确认 `enabled=true`、`configured=true`。
3. 钱包绑定：
   - `POST /api/payments/wallets/challenge`
   - `POST /api/payments/wallets/verify`
4. 支付流程：
   - `POST /api/payments/intents`
   - 发链上交易
   - `POST /api/payments/intents/{id}/submit`
   - `POST /api/payments/intents/{id}/confirm`
5. 若前端显示 pending，轮询：
   - `GET /api/payments/intents/{id}`
6. 确认订阅：`/api/auth/me` 返回 `subscription_active=true`。
