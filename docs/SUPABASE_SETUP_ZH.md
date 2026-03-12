# Supabase + Google 登录接入说明（P0）

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

并建立 `auth.users -> profiles` 同步触发器。

## 4. 环境变量

### 4.1 前端（Vercel / frontend/.env.local）

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
POLYWEATHER_AUTH_ENABLED=true
POLYWEATHER_API_BASE_URL=http://<backend-host>:8000
POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN=
```

### 4.2 后端 / Bot（.env）

```env
POLYWEATHER_AUTH_ENABLED=true
POLYWEATHER_AUTH_REQUIRE_SUBSCRIPTION=false
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_HTTP_TIMEOUT_SEC=8
SUPABASE_AUTH_CACHE_TTL_SEC=30
SUPABASE_SUB_CACHE_TTL_SEC=60
```

可选（Bot 也走 Supabase 订阅）：

```env
POLYWEATHER_BOT_REQUIRE_ENTITLEMENT=true
POLYWEATHER_BOT_USE_SUPABASE_ENTITLEMENT=true
```

## 5. entitlement 策略

- `POLYWEATHER_AUTH_ENABLED=true`：要求请求携带有效 Supabase 用户会话。
- `POLYWEATHER_AUTH_REQUIRE_SUBSCRIPTION=true`：额外要求 `subscriptions` 表里存在有效 `active` 记录。

## 6. 验证

1. 访问 `/auth/login`，测试 Google 一键登录。
2. 登录后访问首页，确认页面可用。
3. 调用 `/api/cities`，确认返回 200。
4. 退出登录后再次访问，确认被重定向到登录页。

