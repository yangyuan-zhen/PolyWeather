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
