# Cloudflare 免费版缓存配置

目标：让 Cloudflare 承担公开页面、公开 API 和静态资源的重复读取，降低 VPS CPU、Next.js worker 和后端 detail-batch 压力，同时避免缓存账户、支付、反馈和实时连接。

代码已通过 `Cache-Control` 与 `Cloudflare-CDN-Cache-Control` 声明 TTL。由于免费版会严格遵守源站的 `max-age=0`，稳定公开路径的 Cache Rules 额外按状态码覆盖 Edge TTL；可能返回 partial、stale 或 failed 的接口继续尊重源站缓存头。不要给所有 `/api/*` 统一启用 Cache Everything。

缓存规则只允许作用于前端域名 `polyweather.top`。`api.polyweather.top` 是带服务令牌和会员校验的后端源站，必须绕过 Cloudflare 缓存，避免缓存命中绕过后端权限检查。

## 基础设置

- `Caching > Configuration > Browser Cache TTL`：Respect Existing Headers
- `Caching > Configuration > Development Mode`：Off
- `Caching > Configuration > Always Online`：On
- `Caching > Tiered Cache`：Smart Tiered Cache，若当前免费套餐控制台提供则开启
- `Speed > Optimization > Content Optimization > Brotli`：On
- `Speed > Optimization > Content Optimization > Early Hints`：On
- `Network > HTTP/3 (with QUIC)`：On
- `Network > WebSockets`：On
- 确保 `api.polyweather.top` 与 `polyweather.top` 代理状态为 Proxied

## Cache Rules

按以下顺序创建。Cloudflare 同一阶段最后匹配的规则生效，因此绕过规则必须放在公开缓存规则之后。免费版规则数量有限，因此使用路径集合合并表达式。

也可以使用仓库内脚本自动创建或更新规则。脚本会保留非 PolyWeather 规则，并把绕过规则放在最后。

Cloudflare 新版 Token UI 中，文档里的 Cache Rules 权限通常显示为：

- 权限策略资源：`指定域名` -> `polyweather.top`
- `Cache & Performance` -> `Cache Settings` -> `Edit`

为了避免 Token 还需要列出 Zone，请同时在 GitHub Secrets 配置 `CLOUDFLARE_ZONE_ID`。Zone ID 在 Cloudflare 进入 `polyweather.top` 后，右侧 API 区域或 Overview 页面可以复制。

GitHub Actions 需要两个仓库 Secret：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`

```powershell
$env:CLOUDFLARE_API_TOKEN="<具有 Cache Settings Edit 权限的 token>"
$env:CLOUDFLARE_ZONE_ID="<polyweather.top 的 Zone ID>"
python scripts/configure_cloudflare_free.py
python scripts/configure_cloudflare_free.py --apply
```

第一条命令只输出计划；只有带 `--apply` 才会修改 Cloudflare。

部署流水线也会执行同一脚本。给 GitHub 仓库增加 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ZONE_ID` 两个 Secret 后，后续每次成功部署都会同步 Cache Rules；未配置时流水线会明确跳过，不影响主站部署。

### 1. 缓存公开内容

脚本会创建 5 条互不重叠的公开缓存规则。动作均为 Eligible for cache：

- 静态资源：2xx Edge TTL 覆盖为 1 年。
- 首页和公开文档页：2xx Edge TTL 覆盖为 10 分钟。
- `/api/cities`：2xx Edge TTL 覆盖为 5 分钟。
- 城市详情与 detail-batch：尊重源站成功、partial、stale 和错误缓存策略。
- `/api/scan/terminal` 与 `/api/system/status`：尊重源站成功、busy、failed 和错误缓存策略。

### 2. 最后绕过后端域名、动态和敏感请求

动作：Bypass cache

表达式：

```text
http.host eq "api.polyweather.top"
or (http.request.method ne "GET" and http.request.method ne "HEAD")
or starts_with(http.request.uri.path, "/api/auth/")
or starts_with(http.request.uri.path, "/api/feedback")
or starts_with(http.request.uri.path, "/api/events")
or starts_with(http.request.uri.path, "/api/internal/")
or starts_with(http.request.uri.path, "/api/ops/")
or starts_with(http.request.uri.path, "/api/payments/")
or starts_with(http.request.uri.path, "/account")
or starts_with(http.request.uri.path, "/auth")
or starts_with(http.request.uri.path, "/ops")
or starts_with(http.request.uri.path, "/terminal")
or http.request.uri.query contains "force_refresh=true"
```

若 Dashboard 支持请求头或 Cookie 条件，再加入：

```text
or any(http.request.headers["authorization"][*] ne "")
or http.cookie contains "sb-"
```

## 缓存 TTL

### 静态资源

动作：Eligible for cache；2xx Edge TTL 覆盖为一年。

表达式：

```text
http.host eq "polyweather.top"
and (
  starts_with(http.request.uri.path, "/_next/static/")
  or lower(http.request.uri.path.extension) in {
    "js" "css" "woff" "woff2" "png" "jpg" "jpeg" "webp" "avif" "svg" "ico"
  }
)
```

源站仍声明一年 immutable，Cloudflare Edge TTL 同样固定为一年。

### 公开页面

动作：Eligible for cache；2xx Edge TTL 覆盖为 10 分钟。

表达式：

```text
http.host eq "polyweather.top"
and (
  http.request.uri.path eq "/"
  or starts_with(http.request.uri.path, "/docs/")
  or starts_with(http.request.uri.path, "/modern/")
  or starts_with(http.request.uri.path, "/probabilities/")
  or starts_with(http.request.uri.path, "/subscription-help/")
)
```

源站 TTL：10 分钟，过期后允许后台刷新 1 小时。

### 公开数据接口

动作：Eligible for cache；城市列表的 2xx Edge TTL 覆盖为 5 分钟，详情、扫描和系统状态尊重源站缓存头。

表达式：

```text
http.host eq "polyweather.top"
and (
  http.request.uri.path eq "/api/cities"
  or http.request.uri.path eq "/api/cities/detail-batch"
  or starts_with(http.request.uri.path, "/api/city/")
  or http.request.uri.path eq "/api/scan/terminal"
  or http.request.uri.path eq "/api/system/status"
)
```

接口 TTL：

- `/api/cities`：5 分钟，过期后可复用 1 小时。
- 城市详情与 detail-batch：60 秒，过期后可复用 5 分钟。
- `/api/scan/terminal`：5 分钟，过期后可复用 15 分钟。
- partial、busy、timeout、stale、force refresh 和错误响应：源站为 `no-store`，详情和扫描规则不会覆盖；force refresh 由最后一条绕过规则排除。

## 验证

每次规则变更后连续请求同一 URL，检查响应头：

```powershell
curl.exe -sS -D - -o NUL "https://polyweather.top/api/cities"
curl.exe -sS -D - -o NUL "https://polyweather.top/api/scan/terminal?limit=1"
```

正常命中应看到 `CF-Cache-Status: HIT` 和递增的 `Age`。首次请求通常是 `MISS`；动态或明确 `no-store` 的请求应保持 `DYNAMIC` 或 `BYPASS`。
