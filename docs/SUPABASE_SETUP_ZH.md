# Supabase + Google 登录 + 合约支付接入说明（P1）

## 1. 目标

- 前端支持 `Google 一键登录`（优先）与 `邮箱注册/登录`（并列）。
- 后端 API 支持 Supabase JWT 鉴权。
- entitlement 检查可选：仅登录放行，或要求有效订阅。

## 2. Supabase 控制台配置

1. Auth -> Providers -> 打开 `Google`。
2. Auth -> Providers -> `Email` 保持开启。
3. 在 Google Cloud Console 配置 OAuth 回调地址：
   - `https://<your-project-ref>.supabase.co/auth/v1/callback`
4. 在 Auth -> URL Configuration 添加站点 URL（你的前端域名）。

## 3. 执行数据库脚本

在 Supabase SQL Editor 运行：

- `scripts/supabase/schema.sql`

该脚本会创建：

- `profiles`
- `subscriptions`
- `payments`
- `entitlement_events`
- `user_wallets`
- `wallet_link_challenges`
- `payment_intents`
- `payment_transactions`

并建立 `auth.users -> profiles` 同步触发器。

## 4. 环境变量

### 4.1 前端（Vercel / frontend/.env.local）

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
POLYWEATHER_AUTH_ENABLED=true
# true: 强制登录；false: 游客可用（可选登录）
POLYWEATHER_AUTH_REQUIRED=false
POLYWEATHER_API_BASE_URL=http://<backend-host>:8000
POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN=
```

### 4.2 后端 / Bot（.env）

```env
POLYWEATHER_AUTH_ENABLED=true
# true: 后端 API 强制鉴权；false: 游客可访问，若带会话则自动识别用户
POLYWEATHER_AUTH_REQUIRED=false
POLYWEATHER_AUTH_REQUIRE_SUBSCRIPTION=false
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_HTTP_TIMEOUT_SEC=8
SUPABASE_AUTH_CACHE_TTL_SEC=30
SUPABASE_SUB_CACHE_TTL_SEC=60

# P1 合约支付（MetaMask + Polygon USDC）
POLYWEATHER_PAYMENT_ENABLED=true
POLYWEATHER_PAYMENT_CHAIN_ID=137
POLYWEATHER_PAYMENT_RPC_URL=https://polygon-rpc.com
POLYWEATHER_PAYMENT_RECEIVER_CONTRACT=0x<your_payment_contract>
POLYWEATHER_PAYMENT_TOKEN_ADDRESS=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
POLYWEATHER_PAYMENT_TOKEN_DECIMALS=6
POLYWEATHER_PAYMENT_CONFIRMATIONS=2
POLYWEATHER_PAYMENT_INTENT_TTL_SEC=1800
POLYWEATHER_PAYMENT_WALLET_CHALLENGE_TTL_SEC=600
POLYWEATHER_PAYMENT_HTTP_TIMEOUT_SEC=10
POLYWEATHER_PAYMENT_POLL_INTERVAL_SEC=4
POLYWEATHER_PAYMENT_MAX_WAIT_SEC=50
POLYWEATHER_PAYMENT_TELEGRAM_NOTIFY_ENABLED=true
# 支付积分抵扣（500 积分 = 1 USDC，最高抵扣 3 USDC）
POLYWEATHER_PAYMENT_POINTS_ENABLED=true
POLYWEATHER_PAYMENT_POINTS_PER_USDC=500
POLYWEATHER_PAYMENT_POINTS_MAX_DISCOUNT_USDC=3
# JSON 示例:
# {"pro_monthly":{"plan_id":101,"amount_usdc":"5","duration_days":30}}
POLYWEATHER_PAYMENT_PLAN_CATALOG_JSON=
```

可选（Bot 也走 Supabase 订阅）：

```env
POLYWEATHER_BOT_REQUIRE_ENTITLEMENT=true
POLYWEATHER_BOT_USE_SUPABASE_ENTITLEMENT=true
```

## 5. entitlement 策略

- `POLYWEATHER_AUTH_ENABLED=true`：启用 Supabase 登录能力（Google/邮箱）。
- `POLYWEATHER_AUTH_REQUIRED=true`：网站与后端 API 强制登录。
- `POLYWEATHER_AUTH_REQUIRED=false`：游客可访问全部功能，用户可主动登录。
- `POLYWEATHER_AUTH_REQUIRE_SUBSCRIPTION=true`：在强制鉴权模式下，额外要求 `subscriptions` 表里存在有效 `active` 记录。

## 6. 验证

1. 访问 `/auth/login`，测试 Google 一键登录。
2. `POLYWEATHER_AUTH_REQUIRED=false` 时，未登录访问首页与 `/api/cities` 应返回 200。
3. 登录后访问 `/api/auth/me`，应返回 `authenticated=true` 与 `user_id`。
4. `POLYWEATHER_AUTH_REQUIRED=true` 时，未登录访问受保护接口应返回 401 或跳转登录页。

## 7. P1 支付链路验证

1. 登录后访问 `GET /api/payments/config`，应看到 `enabled=true`、`configured=true`。
2. 账户页点击“连接并绑定 MetaMask”，完成签名后 `GET /api/payments/wallets` 可看到地址。
3. 点击“创建订单并支付”：
   - `POST /api/payments/intents`
   - MetaMask 发交易到 `POLYWEATHER_PAYMENT_RECEIVER_CONTRACT`
   - `POST /api/payments/intents/{intent_id}/submit`
   - `POST /api/payments/intents/{intent_id}/confirm`
4. 确认后应自动写入：
   - `payments`（`status=confirmed`）
   - `subscriptions`（新增 `active` 记录）
   - `entitlement_events`（`subscription_granted`）

合约事件要求：

- 合约需在 `pay(orderId, planId, amount, token)` 成功后发出  
  `OrderPaid(bytes32 orderId, address payer, uint256 planId, address token, uint256 amount)`  
  （字段顺序和类型需一致）。
