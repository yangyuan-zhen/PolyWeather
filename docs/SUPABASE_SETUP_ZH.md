# Supabase + 登录 + 支付接入说明（v1.8.1）

最后更新：`2026-05-29`

## 1. 目标

- 前端支持 Google 一键登录 + 邮箱注册/登录。
- 后端支持 Supabase JWT 鉴权。
- 支持 Polygon 合约支付（USDC / USDC.e）和 Ethereum 主网 USDC 直转支付，并自动确认开通订阅。

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
- 既有生产项目遇到 Disk IO Budget 告警时，再执行 `scripts/supabase/io_budget_indexes.sql`

会创建支付与订阅相关表：

- `subscriptions`
- `payments`
- `entitlement_events`
- `user_wallets`
- `wallet_link_challenges`
- `payment_intents`
- `payment_transactions`

### 3.1 Disk IO 告警处理

如果 Supabase 提示项目正在耗尽 Disk IO Budget，先在 SQL Editor 执行：

1. `scripts/supabase/io_budget_indexes.sql`
2. `scripts/supabase/disk_io_diagnostics.sql`

第一个脚本会把热查询索引收敛为更低写放大的部分索引，移除已被唯一约束覆盖或无热路径使用的冗余索引，并对相关表执行 `ANALYZE`。第二个脚本用于查看表扫描、dead tuples、索引命中和 `pg_stat_statements` 中的高读块 SQL。生产执行后，继续观察 Supabase daily/hourly Disk IO 图表，确认请求延迟和 IO wait 是否下降。

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
# 默认链仍是 Polygon，因为当前 checkout 合约部署在 Polygon。
POLYWEATHER_PAYMENT_CHAIN_ID=137
POLYWEATHER_PAYMENT_RPC_URL=https://polygon-bor-rpc.publicnode.com
POLYWEATHER_PAYMENT_RPC_URLS_BY_CHAIN_JSON={"137":["https://polygon-bor-rpc.publicnode.com"],"1":["https://ethereum-rpc.example"]}
POLYWEATHER_PAYMENT_RECEIVER_CONTRACT=0x<receiver_contract>
POLYWEATHER_PAYMENT_DIRECT_RECEIVER_ADDRESS=0x<treasury_or_receiver_wallet>
POLYWEATHER_PAYMENT_CONFIRMATIONS=2
POLYWEATHER_PAYMENT_INTENT_TTL_SEC=1800
POLYWEATHER_PAYMENT_WALLET_CHALLENGE_TTL_SEC=600
POLYWEATHER_PAYMENT_POLL_INTERVAL_SEC=4
POLYWEATHER_PAYMENT_MAX_WAIT_SEC=50

# 支持多链多币种（示例）
# Ethereum 主网 USDC 当前建议只开 direct transfer，不走 Polygon checkout 合约。
POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON=[{"code":"usdc_polygon","symbol":"USDC","name":"USDC on Polygon","chain_id":137,"chain_code":"polygon","chain_name":"Polygon","address":"0x3c499c542cef5e3811e1192ce70d8cc03d5c3359","decimals":6,"receiver_contract":"0x<receiver_contract>","direct_receiver_address":"0x<treasury_or_receiver_wallet>","is_default":true},{"code":"usdc_e_polygon","symbol":"USDC.e","name":"USDC.e on Polygon","chain_id":137,"chain_code":"polygon","chain_name":"Polygon","address":"0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174","decimals":6,"receiver_contract":"0x<receiver_contract>","direct_receiver_address":"0x<treasury_or_receiver_wallet>"},{"code":"usdc_ethereum","symbol":"USDC","name":"USDC on Ethereum","chain_id":1,"chain_code":"ethereum","chain_name":"Ethereum Mainnet","address":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48","decimals":6,"direct_receiver_address":"0x<treasury_or_receiver_wallet>","supports_contract_checkout":false,"supports_direct_transfer":true,"confirmations":2,"explorer_tx_url":"https://etherscan.io/tx/{tx_hash}"}]

# 套餐（当前只保留月付）
POLYWEATHER_PAYMENT_PLAN_CATALOG_JSON={"pro_monthly":{"plan_id":101,"amount_usdc":"10","duration_days":30}}
POLYWEATHER_PAYMENT_ALLOWED_PLAN_CODES=pro_monthly

# 积分抵扣
POLYWEATHER_PAYMENT_POINTS_ENABLED=true
POLYWEATHER_PAYMENT_POINTS_PER_USDC=500
POLYWEATHER_PAYMENT_POINTS_MAX_DISCOUNT_USDC=3

# 支付自动补单
POLYWEATHER_PAYMENT_EVENT_LOOP_ENABLED=true
POLYWEATHER_PAYMENT_CONFIRM_LOOP_ENABLED=true
POLYWEATHER_PAYMENT_CONFIRM_LOOP_INTERVAL_SEC=20
POLYWEATHER_PAYMENT_CONFIRM_LOOP_IDLE_INTERVAL_SEC=300
POLYWEATHER_PAYMENT_CONFIRM_LOOP_IDLE_AFTER_EMPTY_CYCLES=3
```

## 5. 验证步骤

1. 登录后请求 `/api/auth/me`，确认 `authenticated=true`。
2. 请求 `/api/payments/config`，确认 `enabled=true`、`configured=true`。
3. 钱包绑定：
   - `POST /api/payments/wallets/challenge`
   - `POST /api/payments/wallets/verify`
4. 支付流程：
   - `POST /api/payments/intents`；多链时前端会带 `chain_id` 和 `token_address`
   - 发链上交易
   - `POST /api/payments/intents/{id}/submit`
   - `POST /api/payments/intents/{id}/confirm`
5. 若前端显示 pending，轮询：
   - `GET /api/payments/intents/{id}`
6. 确认订阅：`/api/auth/me` 返回 `subscription_active=true`。

## 6. 多链支付口径

- Polygon 是默认链，仍支持钱包合约支付和手动直转确认。
- Ethereum 主网 USDC 是正式支付链路，但当前建议只走手动直转：用户选择 Ethereum 后，前端展示收款钱包、金额、代币合约和 Etherscan 链接，用户提交 tx hash 后后端按 `intent.chain_id=1` 查询 Ethereum RPC。
- 不要只依赖前端文案阻止错链付款；后端必须把每笔 intent 的 `chain_id`、`token_address`、`receiver_address` 落库，并在确认时按该链校验 `Transfer` 事件。
