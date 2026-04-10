# 配置与密钥管理（中文）

## 1. 目标

PolyWeather 的环境变量很多，但不是所有变量都属于同一层级。

当前推荐做法是把配置拆成三类：

1. 可复现基础配置  
   放在：[.env.example](/E:/web/PolyWeather/.env.example)

2. 敏感密钥模板  
   放在：[.env.secrets.example](/E:/web/PolyWeather/.env.secrets.example)

3. 平台侧真实密钥  
   放在：
   - VPS / Docker `.env`
   - Vercel Environment Variables
   - GitHub Secrets（如需要）

## 2. 为什么要拆

如果把所有变量都平铺在一个 `.env` 里，会有三个问题：

1. 新环境很难知道“最小启动到底需要哪些变量”
2. 敏感密钥和普通开关混在一起，容易误泄露
3. 调优参数太多时，团队很难区分“必须填”和“保持默认即可”

所以正确做法不是“减少变量数量”，而是：

- 保留变量能力
- 按职责分层
- 给出最小启动路径

## 3. 文件职责

### 3.1 根 `.env.example`

文件：

- [.env.example](/E:/web/PolyWeather/.env.example)

用途：

- 后端 / Bot / Docker 的可复现配置模板
- 只放变量名、默认值、开关与非敏感示例

### 3.2 根 `.env.secrets.example`

文件：

- [.env.secrets.example](/E:/web/PolyWeather/.env.secrets.example)

用途：

- 只列敏感项
- 帮助运维明确哪些值必须从密钥系统注入

### 3.3 前端 `.env.example`

文件：

- [frontend/.env.example](/E:/web/PolyWeather/frontend/.env.example)

用途：

- 前端本地开发与 Vercel 环境变量模板

## 4. 配置分级

### 4.1 L1：最小启动必需项

这是“服务能跑起来”的最小集合。

后端 / Bot：

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `POLYWEATHER_RUNTIME_DATA_DIR`
- `POLYWEATHER_DB_PATH`
- `POLYWEATHER_STATE_STORAGE_MODE`

前端：

- `POLYWEATHER_API_BASE_URL`
- `POLYWEATHER_OPS_ADMIN_EMAILS`（如果启用 `/ops` 页面级管理员守卫）

如果启用登录：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### 4.2 L2：功能开关

这些变量一般不敏感，但会决定功能是否启用。

例如：

- `POLYWEATHER_AUTH_ENABLED`
- `POLYWEATHER_AUTH_REQUIRED`
- `POLYWEATHER_AUTH_REQUIRE_SUBSCRIPTION`
- `POLYWEATHER_OPS_ADMIN_EMAILS`
- `POLYWEATHER_STATE_STORAGE_MODE`
- `POLYWEATHER_PAYMENT_ENABLED`
- `POLYMARKET_MARKET_SCAN_ENABLED`
- `POLYGON_WALLET_WATCH_ENABLED`
- `TELEGRAM_ALERT_PUSH_ENABLED`
- `TELEGRAM_MARKET_FOCUS_DIGEST_ENABLED`
- `POLYMARKET_WALLET_ACTIVITY_ENABLED`（已退役，建议保持 `false`）
- `POLYWEATHER_DASHBOARD_PREWARM_ENABLED`
- `POLYWEATHER_GROQ_COMMENTARY_ENABLED`

### 4.3 L3：运行调优项

这些一般不需要在第一天就改。

例如：

- 各类 `*_TTL_SEC`
- 各类 `*_TIMEOUT_SEC`
- 各类 `*_COOLDOWN_SEC`
- 各类 `*_INTERVAL_SEC`
- `TELEGRAM_ALERT_MIN_TRIGGER_COUNT`
- `TELEGRAM_ALERT_MIN_SEVERITY`
- `TELEGRAM_ALERT_MISPRICING_ONLY`
- `TELEGRAM_ALERT_MISPRICING_INTERVAL_SEC`
- `TELEGRAM_MARKET_FOCUS_DIGEST_INTERVAL_SEC`
- `TELEGRAM_MARKET_FOCUS_DIGEST_TOP_N`
- `POLYWEATHER_PAYMENT_RPC_URLS`
- `TAF_CACHE_TTL_SEC`
- `POLYWEATHER_PREWARM_INTERVAL_SEC`
- `POLYWEATHER_PREWARM_JITTER_SEC`
- `POLYWEATHER_PREWARM_CITIES`
- `POLYWEATHER_PREWARM_INCLUDE_DETAIL`
- `POLYWEATHER_PREWARM_INCLUDE_MARKET`
- `POLYWEATHER_PREWARM_FORCE_REFRESH`
- `POLYWEATHER_GROQ_COMMENTARY_MODEL`
- `POLYWEATHER_GROQ_COMMENTARY_TIMEOUT_SEC`
- `POLYWEATHER_GROQ_COMMENTARY_CACHE_TTL_SEC`

策略：

- 先用默认值
- 出现性能或运维问题时再调

### 4.4 L4：敏感项

这些变量不应写进公开文档截图，也不应提交到仓库。

例如：

- `TELEGRAM_BOT_TOKEN`
- `SUPABASE_SERVICE_ROLE_KEY`
- `POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN`
- `POLYWEATHER_DASHBOARD_ACCESS_TOKEN`
- `METEOBLUE_API_KEY`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `POLYMARKET_SECRET_KEY`
- `GROQ_API_KEY`

## 5. 推荐部署矩阵

### 5.1 VPS / Docker（后端 + Bot）

建议放这些：

- 根 `.env` 的后端项
- 所有 secrets
- Bot / 支付 / watcher 配置

### 5.2 Vercel（前端）

建议只放前端真正需要的变量：

- `POLYWEATHER_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `POLYWEATHER_AUTH_ENABLED`
- `POLYWEATHER_AUTH_REQUIRED`
- `POLYWEATHER_OPS_ADMIN_EMAILS`
- `POLYWEATHER_DASHBOARD_ACCESS_TOKEN`
- `POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `NEXT_PUBLIC_WALLETCONNECT_POLYGON_RPC_URL`
- `NEXT_PUBLIC_POLYWEATHER_APP_ANALYTICS`
- `NEXT_PUBLIC_POLYWEATHER_WEB_VITALS`
- `NEXT_PUBLIC_POLYWEATHER_EAGER_CITY_SUMMARIES`

说明：

- `/ops` 现在是前后端双层限制：
  - 前端页面入口读取 `POLYWEATHER_OPS_ADMIN_EMAILS`
  - 后端写接口同样读取 `POLYWEATHER_OPS_ADMIN_EMAILS`
- 因此，Vercel 和 VPS / Docker 两侧都应配置相同的管理员邮箱白名单。

不要把后端专用密钥全搬进 Vercel。

### 5.3 GitHub Actions

当前 CI 不需要大规模 secrets。

如果未来要做自动部署，再考虑：

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

## 6. 最小部署示例

### 6.1 前端最小变量

```env
POLYWEATHER_API_BASE_URL=https://your-backend.example.com
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
POLYWEATHER_AUTH_ENABLED=true
POLYWEATHER_AUTH_REQUIRED=true
NEXT_PUBLIC_POLYWEATHER_APP_ANALYTICS=false
NEXT_PUBLIC_POLYWEATHER_WEB_VITALS=false
NEXT_PUBLIC_POLYWEATHER_EAGER_CITY_SUMMARIES=false
```

### 6.2 后端最小变量

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
POLYWEATHER_RUNTIME_DATA_DIR=/var/lib/polyweather
POLYWEATHER_DB_PATH=/var/lib/polyweather/polyweather.db
POLYWEATHER_STATE_STORAGE_MODE=sqlite
UID=1000
GID=1000
POLYWEATHER_AUTH_ENABLED=true
POLYWEATHER_AUTH_REQUIRED=false
POLYWEATHER_OPS_ADMIN_EMAILS=yhrsc30@gmail.com
TAF_CACHE_TTL_SEC=900
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN=...
TELEGRAM_ALERT_PUSH_ENABLED=true
TELEGRAM_ALERT_PUSH_INTERVAL_SEC=300
TELEGRAM_ALERT_PUSH_COOLDOWN_SEC=1800
TELEGRAM_ALERT_MIN_TRIGGER_COUNT=2
TELEGRAM_ALERT_MIN_SEVERITY=medium
TELEGRAM_ALERT_MISPRICING_ONLY=true
TELEGRAM_ALERT_MISPRICING_INTERVAL_SEC=7200
TELEGRAM_MARKET_FOCUS_DIGEST_ENABLED=true
TELEGRAM_MARKET_FOCUS_DIGEST_INTERVAL_SEC=1800
TELEGRAM_MARKET_FOCUS_DIGEST_TOP_N=5
POLYMARKET_WALLET_ACTIVITY_ENABLED=false
POLYWEATHER_DASHBOARD_PREWARM_ENABLED=true
POLYWEATHER_PREWARM_INTERVAL_SEC=300
POLYWEATHER_PREWARM_JITTER_SEC=20
POLYWEATHER_PREWARM_INCLUDE_DETAIL=true
POLYWEATHER_PREWARM_INCLUDE_MARKET=true
POLYWEATHER_BACKEND_URL=http://polyweather_web:8000
POLYWEATHER_GROQ_COMMENTARY_ENABLED=false
POLYWEATHER_GROQ_COMMENTARY_MODEL=openai/gpt-oss-20b
POLYWEATHER_GROQ_COMMENTARY_TIMEOUT_SEC=8
POLYWEATHER_GROQ_COMMENTARY_CACHE_TTL_SEC=1800
```

说明：

- `UID` / `GID` 主要给 Linux Docker 主机用，避免容器把运行文件写成 root 所有。
- Windows / macOS 一般可以直接保留默认值。
- `POLYWEATHER_RUNTIME_DATA_DIR` 建议放在仓库外，例如 `/var/lib/polyweather`。
- `docker-compose.yml` 会把这个目录同时挂载到容器内的 `/var/lib/polyweather` 和 `/app/data`，兼容现有缓存与 SQLite 路径。
- `POLYWEATHER_STATE_STORAGE_MODE` 当前线上推荐直接使用 `sqlite`。
- `POLYWEATHER_PAYMENT_RPC_URLS` 支持逗号分隔多个 RPC；如果暂时只用单 RPC，也可以继续只配 `POLYWEATHER_PAYMENT_RPC_URL`。
- 机器人市场监控当前以 `关注清单` 为主，按固定间隔主动推送。
- `TELEGRAM_MARKET_FOCUS_DIGEST_INTERVAL_SEC` 表示主动推送间隔，默认 `1800` 秒（30 分钟）。
- `POLYMARKET_WALLET_ACTIVITY_ENABLED` 已退役，保留为 `false` 即可，不建议再启用钱包异动监听。
- `POLYWEATHER_DASHBOARD_PREWARM_ENABLED=true` 时，建议同时启用独立 worker 或 bot 内嵌预热线程。
- `POLYWEATHER_BACKEND_URL` 仅在独立 `polyweather_prewarm` worker 容器中使用，建议设为 `http://polyweather_web:8000`，不要写 `127.0.0.1`。
- `POLYWEATHER_GROQ_COMMENTARY_ENABLED=false` 表示默认仍走规则文案；只有在确实配置了 `GROQ_API_KEY` 时才建议开启。

### 6.3 Dashboard 预热 worker 推荐变量

```env
POLYWEATHER_DASHBOARD_PREWARM_ENABLED=true
POLYWEATHER_PREWARM_INTERVAL_SEC=300
POLYWEATHER_PREWARM_JITTER_SEC=20
POLYWEATHER_PREWARM_CITIES=ankara,istanbul,shanghai,beijing,shenzhen,wuhan,chengdu,chongqing,hong kong,taipei,london,paris,new york,los angeles
POLYWEATHER_PREWARM_INCLUDE_DETAIL=true
POLYWEATHER_PREWARM_INCLUDE_MARKET=true
POLYWEATHER_PREWARM_FORCE_REFRESH=false
POLYWEATHER_BACKEND_URL=http://polyweather_web:8000
```

说明：

- 这组变量用于后台定向预热热点城市，避免用户点击城市时才冷启动拉 detail。
- 如果使用独立 `polyweather_prewarm` 容器，`POLYWEATHER_BACKEND_URL` 必须指向容器网络中的 `polyweather_web`。

### 6.4 Groq 解读增强层

```env
POLYWEATHER_GROQ_COMMENTARY_ENABLED=true
GROQ_API_KEY=...
POLYWEATHER_GROQ_COMMENTARY_MODEL=openai/gpt-oss-20b
POLYWEATHER_GROQ_COMMENTARY_TIMEOUT_SEC=8
POLYWEATHER_GROQ_COMMENTARY_CACHE_TTL_SEC=1800
```

说明：

- 这层只负责把结构化信号改写成短摘要，不替代真实模型、机场锚点和结算逻辑。
- Groq 调用失败时，系统会自动回退到规则文案。

### 6.5 机器人市场监控建议配置

这套配置用于替代旧的钱包异动监听，围绕市场本身做两类推送：

- `关键提醒`：实时错价/触发条件满足时发送
- `关注清单`：按亚洲时区定时推送当日重点市场摘要

推荐值：

```env
TELEGRAM_ALERT_PUSH_ENABLED=true
TELEGRAM_ALERT_PUSH_INTERVAL_SEC=300
TELEGRAM_ALERT_PUSH_COOLDOWN_SEC=1800
TELEGRAM_ALERT_MIN_TRIGGER_COUNT=2
TELEGRAM_ALERT_MIN_SEVERITY=medium
TELEGRAM_ALERT_MISPRICING_ONLY=true
TELEGRAM_ALERT_MISPRICING_INTERVAL_SEC=7200
TELEGRAM_MARKET_FOCUS_DIGEST_ENABLED=true
TELEGRAM_MARKET_FOCUS_DIGEST_INTERVAL_SEC=1800
TELEGRAM_MARKET_FOCUS_DIGEST_TOP_N=5
POLYMARKET_WALLET_ACTIVITY_ENABLED=false
```

说明：

- `TELEGRAM_ALERT_MISPRICING_ONLY=true` 表示关键提醒优先围绕错价/市场触发，不把机器人做成泛通知器。
- `TELEGRAM_MARKET_FOCUS_DIGEST_INTERVAL_SEC=1800` 表示频道每 30 分钟主动推送一轮机会清单。
- `TELEGRAM_MARKET_FOCUS_DIGEST_TOP_N=5` 建议先保持较小，避免机器人一次推太多城市。
- `POLYMARKET_WALLET_ACTIVITY_ENABLED=false` 表示停用旧的钱包异动监听，统一收敛到市场监控。

## 7. 当前建议的运维规则

### 7.1 仓库中允许存在

- `.env.example`
- `.env.secrets.example`
- `frontend/.env.example`

### 7.2 仓库中不应提交

- `.env`
- `.env.local`
- 任何带真实 token / key 的配置文件

### 7.3 截图与共享规则

以下值一旦出现在截图或聊天里，建议视为泄露并轮换：

- `SUPABASE_SERVICE_ROLE_KEY`
- `POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- 第三方私有 API Key

## 8. 如何收口配置复杂度

如果你觉得变量仍然太多，正确的做法不是一刀删掉，而是：

1. 把“功能开关”和“调优参数”分开看
2. 保持 `.env.example` 中：
   - 最小启动项
   - 常用功能开关
   - 默认调优值
3. 让不常改的高阶参数继续留默认

也就是说：

- 使用者只需要先关心 10-20 个关键变量
- 其余变量保持默认即可

## 9. 当前已经完成的配置治理

1. 根 `.env.example` 收口
2. `.env.secrets.example` 新增
3. 前端 `.env.example` 收口
4. 运行时配置校验脚本新增
5. `/ops` 管理员白名单与前后端职责边界已明确
5. 支付运行态与多 RPC 配置支持
6. 运行态 SQLite 迁移配置支持

## 10. 配置校验命令

在不启动服务的情况下，你可以直接检查配置：

```bash
python scripts/validate_runtime_env.py --component web
python scripts/validate_runtime_env.py --component bot
```
