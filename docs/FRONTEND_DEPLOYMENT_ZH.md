# 前端部署配置（Vercel）

本文只覆盖 `frontend` 目录对应的 Next.js 前端部署。

## 一、部署目标

推荐方案：

1. GitHub Actions 负责 `CI`
2. Vercel 负责前端 `CD`
3. FastAPI 后端单独部署在 VPS / Docker 主机

前端本身不直接访问天气源，而是通过 Next Route Handlers 转发到后端：

1. 浏览器 -> Vercel 上的 Next.js 前端
2. Next `/api/*` -> `POLYWEATHER_API_BASE_URL`
3. FastAPI 后端 -> 分析 / 支付 / 鉴权服务

## 二、Vercel 项目设置

在 Vercel 导入 GitHub 仓库后，使用下面的设置：

- Framework Preset: `Next.js`
- Root Directory: `frontend`
- Build Command: `npm run build`
- Install Command: `npm ci`

如果仓库已经连接过 Vercel，通常只需要确认 `Root Directory` 仍然是 `frontend`。

## 三、最小必填环境变量

只部署天气看板和基础登录时，先填下面 4 项：

```env
POLYWEATHER_API_BASE_URL=https://<your-fastapi-host>
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
POLYWEATHER_AUTH_ENABLED=true
```

建议显式补：

```env
POLYWEATHER_AUTH_REQUIRED=true
```

说明：

- `POLYWEATHER_API_BASE_URL`：前端所有 `/api/*` Route Handler 转发时依赖它，没填会直接返回 500。
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`：Supabase 客户端依赖它们。
- `POLYWEATHER_AUTH_ENABLED`：关闭时，前端不会启用登录能力。
- `POLYWEATHER_AUTH_REQUIRED`：控制 middleware 是否强制登录。

## 四、按功能启用的可选环境变量

### 1. 分享式看板

```env
POLYWEATHER_DASHBOARD_ACCESS_TOKEN=
```

设置后，可通过 `/?access_token=<token>` 打开带令牌的看板入口。

### 2. 前后端 entitlement 校验

```env
POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN=
```

仅当后端开启 entitlement / 订阅校验时需要。

### 3. 钱包支付

```env
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_WALLETCONNECT_POLYGON_RPC_URL=https://polygon-bor-rpc.publicnode.com
```

如果不启用钱包支付，可以留空。

### 4. `/ops` 管理员页面守卫

```env
POLYWEATHER_OPS_ADMIN_EMAILS=yhrsc30@gmail.com
```

说明：

- `/ops` 现在不是只有后端接口限制，前端页面入口也会读取管理员邮箱白名单。
- 因此前端部署到 Vercel 时，也应配置 `POLYWEATHER_OPS_ADMIN_EMAILS`。

### 5. Telegram 入口

```env
NEXT_PUBLIC_TELEGRAM_GROUP_URL=https://t.me/<your_group>
NEXT_PUBLIC_TELEGRAM_BOT_URL=https://t.me/WeatherQuant_bot
```

只影响按钮跳转，不影响核心页面加载。

### 6. 前端观测与预热开关（推荐默认关闭）

```env
NEXT_PUBLIC_POLYWEATHER_APP_ANALYTICS=false
NEXT_PUBLIC_POLYWEATHER_WEB_VITALS=false
NEXT_PUBLIC_POLYWEATHER_EAGER_CITY_SUMMARIES=false
```

说明：

- `NEXT_PUBLIC_POLYWEATHER_APP_ANALYTICS=false`：关闭前端自建埋点。
- `NEXT_PUBLIC_POLYWEATHER_WEB_VITALS=false`：关闭前端 Web Vitals 上报。
- `NEXT_PUBLIC_POLYWEATHER_EAGER_CITY_SUMMARIES=false`：关闭首页全量城市 summary 预热，避免白白消耗 Vercel function / edge 成本。

## 五、支付配置与旧部署治理

支付区现在有一层额外防护：

1. 用户点击支付前，前端会重新请求 `/api/payments/config`
2. 若发现 `receiver_contract` 与页面旧状态不一致，会自动切换到最新地址
3. 若后端返回的 `tx_payload.to` 与最新 `receiver_contract` 不一致，会直接阻断支付

这层防护的目的，是降低以下事故概率：

- 用户使用长期未刷新的旧标签页
- 命中旧 deployment URL
- 页面本地状态残留旧收款地址

如果你变更过支付收款地址，建议同步执行：

1. 在 Vercel 对当前 production 做一次 redeploy
2. 删除明显过期、可能还带旧支付配置的旧 deployment
3. 在 `Settings -> Security -> Deployment Retention Policy` 中收紧旧部署保留周期

## 六、推荐的三套配置口径

### 1. 公开游客模式

```env
POLYWEATHER_API_BASE_URL=https://api.example.com
POLYWEATHER_AUTH_ENABLED=false
POLYWEATHER_AUTH_REQUIRED=false
```

适合公开演示站。

### 2. 正常登录模式

```env
POLYWEATHER_API_BASE_URL=https://api.example.com
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
POLYWEATHER_AUTH_ENABLED=true
POLYWEATHER_AUTH_REQUIRED=true
```

适合正式前端站点。

### 3. 登录 + entitlement 联动

```env
POLYWEATHER_API_BASE_URL=https://api.example.com
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
POLYWEATHER_AUTH_ENABLED=true
POLYWEATHER_AUTH_REQUIRED=true
POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN=<shared-token>
```

适合前后端都启用了会员/订阅保护的生产环境。

## 七、不要放进 Vercel 的变量

这些属于后端私密配置，不应该放到前端项目：

- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN` 以外的后端 secret
- 支付签名私钥 / 交易私钥 / 任何 bot 凭据

特别注意：

- `NEXT_PUBLIC_*` 会暴露给浏览器
- 只有明确允许前端公开使用的值，才应加 `NEXT_PUBLIC_`

## 八、上线前检查

Vercel 部署前至少确认：

1. `POLYWEATHER_API_BASE_URL` 指向可访问的后端生产地址
2. `frontend/.env.example` 和 Vercel Project Settings 中的实际值一致
3. GitHub Actions 中 `frontend-quality` 已通过
4. 如果启用鉴权，Supabase redirect URL 已包含前端域名
5. `GET /api/payments/config` 返回的是当前最新地址，而不是旧收款合约
6. 如果启用了 `/ops`，确认 `POLYWEATHER_OPS_ADMIN_EMAILS` 已在 Vercel 与后端同时配置

## 九、常见问题

### 1. 页面打开后 API 全部 500

先检查：

```env
POLYWEATHER_API_BASE_URL
```

这是最常见原因。

### 2. Vercel 构建通过，但登录失败

先检查：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Supabase 项目里的站点 URL / redirect URL

### 3. 钱包入口显示未配置

先检查：

```env
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
```

这是钱包连接的必需项。

## 十、Vercel 成本与节流建议

### 1. 建议先关闭的项目级能力

- `Web Analytics`
- `Speed Insights`

它们对排查前端体验有价值，但在 Hobby / 低预算阶段会额外消耗数据点和边缘资源。

### 2. 建议加的 Firewall 自定义规则

如果你的 Next.js 项目根本不提供 WordPress / PHP 路径，建议在 Vercel Firewall 里先 `Log` 再 `Deny` 这条规则：

```regex
(^/(wp-admin|wp-includes|wp-content|wp-login|wordpress|xmlrpc\.php))|\.php($|\?)
```

目的：

- 在边缘层提前拦截 WordPress / PHP 扫描流量
- 避免无效请求继续触发 middleware 与 route handler

### 3. 建议的上线前检查

除了功能本身，额外确认：

1. `Web Analytics` 和 `Speed Insights` 是否真的关闭
2. `NEXT_PUBLIC_POLYWEATHER_APP_ANALYTICS` / `NEXT_PUBLIC_POLYWEATHER_WEB_VITALS` / `NEXT_PUBLIC_POLYWEATHER_EAGER_CITY_SUMMARIES` 是否保持关闭
3. Firewall 自定义规则是否已从 `Log` 切到 `Deny`
