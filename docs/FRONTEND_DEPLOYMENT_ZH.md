# 前端部署配置（Docker / VPS）

最后更新：`2026-06-14`

本文只覆盖 `frontend` 目录对应的 Next.js 前端部署。前端当前不再使用 Vercel，统一与后端一起以 Docker Compose 形式部署在同一台 VPS 上，前面挂 Cloudflare + Nginx。

## 一、部署目标

当前方案：

1. GitHub Actions 负责 `CI`（`python-quality` + `frontend-quality`）
2. `build-and-push` job 把前端构建为 Docker 镜像 `ghcr.io/yangyuan-zhen/polyweather-frontend`
3. `deploy` job 通过 SSH 把 `deploy.sh` 推到 VPS，由 VPS 拉取新镜像并滚动更新

前端本身不直接访问天气源，而是通过 Next Route Handlers 转发到后端：

1. 浏览器 → Cloudflare → Nginx → 前端容器（Next.js standalone）
2. Next `/api/*` → `POLYWEATHER_API_BASE_URL`（容器内默认 `http://polyweather_web:8000`）
3. FastAPI 后端 → 分析 / 支付 / 鉴权服务

实时图表同样走 Next Route Handler：

1. 浏览器 `EventSource` → `/api/events?cities=...&since_revision=...`
2. Next 转发到 FastAPI `/api/events`
3. FastAPI 从 Redis Stream / SQLite event log replay 后进入 live SSE

## 二、镜像与构建

前端镜像定义在 `frontend/Dockerfile`，三阶段构建：

- `deps`：`npm ci` 安装依赖
- `builder`：通过 `ARG` 注入 `NEXT_PUBLIC_*` 变量后执行 `npm run build`，产出 standalone 产物
- `runner`：只拷贝 `.next/standalone`、`.next/static`、`public`，以 `node server.js` 启动

`NEXT_PUBLIC_*` 变量是在 **构建期** 注入的（见 `frontend/Dockerfile` 的 `ARG` 块），CI 在 `.github/workflows/ci.yml` 的 `build-and-push` job 里从 GitHub Secrets 读取并作为 `--build-arg` 传入。修改这类变量必须重新构建镜像，仅改运行时环境无效。

## 三、Compose 服务

前端在 `docker-compose.yml` 中对应 `polyweather_frontend` 服务：

- 镜像：`ghcr.io/yangyuan-zhen/polyweather-frontend:${IMAGE_TAG:-latest}`
- 容器内监听 `:3000`，映射到宿主 `127.0.0.1:3001`
- 健康检查：`wget -qO- http://$(hostname):3000`
- 运行时环境变量（非 `NEXT_PUBLIC_*` 的那部分）通过 compose `environment` 注入，例如：
  - `POLYWEATHER_API_BASE_URL=http://polyweather_web:8000`（容器内走后端服务名）
  - `POLYWEATHER_AUTH_ENABLED` / `POLYWEATHER_AUTH_REQUIRED`
  - `POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN`
  - `POLYWEATHER_OPS_ADMIN_EMAILS`

`POLYWEATHER_API_BASE_URL` **禁止** 指向前端站点自身（`polyweather.top`），否则会形成回环。`deploy.sh` 里的 `validate_frontend_api_base_url` 会在部署前拦截。容器内应使用 `http://polyweather_web:8000`。

## 四、部署流程（`deploy.sh`）

生产部署由 GitHub Actions 在 `main` push 时触发，关键步骤：

1. SSH 登录 VPS，用 GHCR PAT 登录镜像仓库
2. `git fetch origin main && git reset --hard origin/main` 同步仓库（含 `docker-compose.yml`）
3. 同步 `data/city_thread_ids.json` 到运行态目录
4. `docker compose pull` 拉取新镜像（带重试）
5. 按顺序滚动更新：`redis` → `web` + `bot` → `collector` → `warmer` → `frontend`
6. 每步后做本地健康检查；前端额外等待 `/terminal` 和 `/api/scan/terminal` 就绪
7. 公网 smoke check：`https://api.polyweather.top/healthz`、`https://polyweather.top/api/cities`、`https://www.polyweather.top/`
8. 任意一步失败自动回滚到上一个镜像 tag（记录在 `/var/lib/polyweather/.current_tag`）

部署失败时优先看 `deploy.sh` 输出里哪一步打了 `❌`，并检查 `docker compose logs polyweather_frontend`。

## 五、最小必填配置

只部署天气看板和基础登录时，至少需要：

构建期（CI Secrets，对应 `frontend/Dockerfile` 的 `ARG`）：

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SITE_URL=https://polyweather.top
```

运行期（`.env` 或 compose `environment`）：

```env
POLYWEATHER_API_BASE_URL=http://polyweather_web:8000
POLYWEATHER_AUTH_ENABLED=true
POLYWEATHER_AUTH_REQUIRED=true
POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN=<与后端共享>
```

说明：

- `POLYWEATHER_API_BASE_URL`：前端所有 `/api/*` Route Handler 转发时依赖它，没填或填错会直接返回 500。
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`：Supabase 客户端依赖它们，构建期注入。
- `POLYWEATHER_AUTH_ENABLED` / `POLYWEATHER_AUTH_REQUIRED`：控制 middleware 是否强制登录。

## 六、按功能启用的可选环境变量

### 1. 分享式看板

```env
POLYWEATHER_DASHBOARD_ACCESS_TOKEN=
```

设置后，可通过 `/?access_token=<token>` 打开带令牌的看板入口。

### 2. 钱包支付（构建期）

```
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_WALLETCONNECT_POLYGON_RPC_URL=https://polygon-bor-rpc.publicnode.com
NEXT_PUBLIC_PAYMENT_ALLOWED_HOSTS=polyweather.top,www.polyweather.top
```

如果不启用钱包支付，可以留空。

### 3. `/ops` 管理员页面守卫

```env
POLYWEATHER_OPS_ADMIN_EMAILS=yhrsc30@gmail.com
```

`/ops` 页面入口会读取管理员邮箱白名单，前端和后端容器都应配置相同的值。

### 4. Telegram 入口（构建期）

```
NEXT_PUBLIC_TELEGRAM_GROUP_URL=https://t.me/<your_group>
NEXT_PUBLIC_TELEGRAM_BOT_URL=https://t.me/polyyuanbot
NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME=polyyuanbot
```

只影响按钮跳转，不影响核心页面加载。

### 5. 前端观测与预热开关（推荐默认关闭）

```
NEXT_PUBLIC_POLYWEATHER_APP_ANALYTICS=false
NEXT_PUBLIC_POLYWEATHER_WEB_VITALS=false
NEXT_PUBLIC_POLYWEATHER_EAGER_CITY_SUMMARIES=false
```

## 七、支付配置与旧镜像治理

支付区有一层额外防护：

1. 用户点击支付前，前端会重新请求 `/api/payments/config`
2. 若发现 `receiver_contract` 与页面旧状态不一致，会自动切换到最新地址
3. 若后端返回的 `tx_payload.to` 与最新 `receiver_contract` 不一致，会直接阻断支付
4. 多链支付时，前端会展示后端返回的网络列表，并把用户选择的 `chain_id` 传给后端创建 intent
5. Ethereum 主网 USDC 当前走手动直转确认，前端不会把它当成 Polygon checkout 合约支付

这层防护降低以下事故概率：

- 用户使用长期未刷新的旧标签页
- 页面本地状态残留旧收款地址
- 用户在钱包默认网络（例如 Ethereum）付款，但系统按 Polygon intent 查账

如果变更过支付收款地址，由于前端镜像是构建期注入地址，需要触发一次 `main` push（或重新运行 deploy workflow）来发布新镜像；浏览器侧靠 `/api/payments/config` 的运行时校验兜底，无需等待所有用户刷新。

## 八、不要放进前端容器的变量

这些属于后端私密配置，不应该放到前端服务：

- `SUPABASE_SERVICE_ROLE_KEY`（除非前端 Route Handler 明确需要，且仅以非 `NEXT_PUBLIC_` 形式注入容器）
- `TELEGRAM_BOT_TOKEN`
- `POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN` 以外的后端 secret
- 支付签名私钥 / 交易私钥 / 任何 bot 凭据

特别注意：

- `NEXT_PUBLIC_*` 会暴露给浏览器
- 只有明确允许前端公开使用的值，才应加 `NEXT_PUBLIC_`

## 九、上线前检查

部署前至少确认：

1. `POLYWEATHER_API_BASE_URL` 指向容器内后端服务名 `http://polyweather_web:8000`，**不是** `polyweather.top`
2. CI Secrets 中的 `NEXT_PUBLIC_*` 值与预期一致（构建期注入，改了要重新构建镜像）
3. GitHub Actions 中 `frontend-quality` 已通过
4. 如果启用鉴权，Supabase redirect URL 已包含前端域名
5. `GET /api/payments/config` 返回的是当前最新地址，而不是旧收款合约
6. 如果启用了 `/ops`，确认 `POLYWEATHER_OPS_ADMIN_EMAILS` 已在前端与后端容器同时配置
7. 确认 `/api/events` 没有被 Cloudflare / Nginx 缓存或压缩成普通 JSON；它必须保持 `text/event-stream`

## 十、常见问题

### 1. 页面打开后 API 全部 500

先检查容器内 `POLYWEATHER_API_BASE_URL` 是否指向 `http://polyweather_web:8000`，以及 `polyweather_web` 容器是否健康。

### 2. 构建通过，但登录失败

先检查：

- 构建期注入的 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Supabase 项目里的站点 URL / redirect URL 是否包含前端域名

### 3. 钱包入口显示未配置

检查构建期 `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` 是否注入（前端镜像需要重新构建）。

### 4. 改了 `NEXT_PUBLIC_*` 但线上没生效

这类变量是构建期注入的。仅改 CI Secrets 不会更新已部署镜像，需要重新触发 `build-and-push` + `deploy`（即一次 `main` push，或手动重跑 deploy workflow）。

## 十一、成本与节流建议

### 1. Cloudflare 缓存规则

前端通过 `next.config.mjs` 的 `headers()` 为静态资源（`_next/static`、图片、字体）设置 `Cache-Control: public, max-age=31536000, immutable`，并为公共页面设置 `s-maxage=600, stale-while-revalidate=3600`。CI 的 `cloudflare-cache-rules` job 会同步 Cloudflare Cache Rules（见 `scripts/configure_cloudflare_free.py`）。

### 2. Cloudflare WAF 规则

如果发现大量 WordPress / PHP 扫描流量命中 Next.js（实际并不提供这些路径），建议在 Cloudflare WAF 中先 `Log` 再 `Deny` 这条规则：

```regex
(^/(wp-admin|wp-includes|wp-content|wp-login|wordpress|xmlrpc\.php))|\.php($|\?)
```

目的：在边缘层提前拦截扫描流量，避免无效请求继续触发 Nginx、Next.js middleware 与 route handler。

### 3. SSE 路径不要进缓存

`/api/events` 必须保持 `text/event-stream`，Cloudflare 和 Nginx 都不应缓存或压缩它。检查 Nginx 配置（`deploy/nginx/polyweather.conf`）中对 `/api/events` 的 `proxy_buffering off`。
