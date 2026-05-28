# 配置与密钥管理（中文）

最后更新：`2026-05-28`

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
- `POLYWEATHER_EVENT_STORE`

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
- `POLYWEATHER_EVENT_STORE`
- `POLYWEATHER_REDIS_REQUIRED`
- `POLYWEATHER_PAYMENT_ENABLED`
- `POLYWEATHER_PAYMENT_RPC_URLS_BY_CHAIN_JSON`
- `POLYGON_WALLET_WATCH_ENABLED`
- `TELEGRAM_ALERT_PUSH_ENABLED`
- `TELEGRAM_MARKET_FOCUS_DIGEST_ENABLED`

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
- `POLYWEATHER_PAYMENT_RPC_URLS_BY_CHAIN_JSON`
- `TAF_CACHE_TTL_SEC`
- `POLYWEATHER_REDIS_URL`
- `POLYWEATHER_REDIS_STREAM_KEY`
- `POLYWEATHER_REDIS_STREAM_MAXLEN`

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
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`

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
POLYWEATHER_EVENT_STORE=redis
POLYWEATHER_REDIS_URL=redis://polyweather_redis:6379/0
POLYWEATHER_REDIS_STREAM_MAXLEN=50000
POLYWEATHER_REDIS_REQUIRED=true
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
POLYWEATHER_BACKEND_URL=http://polyweather_web:8000
```

说明：

- `UID` / `GID` 主要给 Linux Docker 主机用，避免容器把运行文件写成 root 所有。
- Windows / macOS 一般可以直接保留默认值。
- `POLYWEATHER_RUNTIME_DATA_DIR` 建议放在仓库外，例如 `/var/lib/polyweather`。
- `docker-compose.yml` 会把这个目录同时挂载到容器内的 `/var/lib/polyweather` 和 `/app/data`，兼容现有缓存与 SQLite 路径。
- `POLYWEATHER_STATE_STORAGE_MODE` 当前线上推荐直接使用 `sqlite`。
- `POLYWEATHER_EVENT_STORE=redis` 表示实时观测 patch 使用 Redis Stream 做短窗口 replay 和多 worker fanout；本地或单进程可改为 `sqlite`。
- `POLYWEATHER_REDIS_REQUIRED=true` 表示 Redis 不可用时后端启动失败，避免生产环境广播不可 replay 的实时事件；开发环境可设为 `false` 允许回退 SQLite。
- `POLYWEATHER_PAYMENT_RPC_URLS` 支持默认链的逗号分隔多个 RPC；如果暂时只用单 RPC，也可以继续只配 `POLYWEATHER_PAYMENT_RPC_URL`。
- `POLYWEATHER_PAYMENT_RPC_URLS_BY_CHAIN_JSON` 用于多链支付，例如同时支持 Polygon 和 Ethereum 主网 USDC。
- 机器人市场监控包含 `关键提醒` 与 `关注清单`：关键提醒逐城判断并受冷却控制，关注清单每轮先扫描完整城市列表，再按全局 Top N 推送；同一轮已经触发关键提醒的城市不会重复出现在关注清单里。
- `TELEGRAM_MARKET_FOCUS_DIGEST_INTERVAL_SEC` 表示主动推送间隔，默认 `1800` 秒（30 分钟）。

说明：

- 这层只负责把结构化信号改写成短摘要，不替代真实模型、机场锚点和结算逻辑。

### 6.3 支付多链配置示例

当前生产推荐：

- 默认链：Polygon `chain_id=137`，继续承载 checkout 合约支付。
- 补充链：Ethereum Mainnet `chain_id=1`，正式支持 USDC 直转确认。
- 前端创建支付 intent 时会提交用户选择的 `chain_id`；后端确认时按 intent 的链和 token 查询对应 RPC。

```env
POLYWEATHER_PAYMENT_ENABLED=true
POLYWEATHER_PAYMENT_CHAIN_ID=137
POLYWEATHER_PAYMENT_RPC_URL=https://polygon-rpc.com
POLYWEATHER_PAYMENT_RPC_URLS=https://polygon-rpc.com,https://polygon-bor-rpc.publicnode.com
POLYWEATHER_PAYMENT_RPC_URLS_BY_CHAIN_JSON={"137":["https://polygon-rpc.com","https://polygon-bor-rpc.publicnode.com"],"1":["https://ethereum-rpc.example"]}
POLYWEATHER_PAYMENT_RECEIVER_CONTRACT=0x<polygon_checkout_contract>
POLYWEATHER_PAYMENT_DIRECT_RECEIVER_ADDRESS=0x<treasury_or_receiver_wallet>
POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON=[{"code":"usdc_polygon","symbol":"USDC","name":"USDC on Polygon","chain_id":137,"chain_code":"polygon","chain_name":"Polygon","address":"0x3c499c542cef5e3811e1192ce70d8cc03d5c3359","decimals":6,"receiver_contract":"0x<polygon_checkout_contract>","direct_receiver_address":"0x<treasury_or_receiver_wallet>","is_default":true},{"code":"usdc_ethereum","symbol":"USDC","name":"USDC on Ethereum","chain_id":1,"chain_code":"ethereum","chain_name":"Ethereum Mainnet","address":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48","decimals":6,"direct_receiver_address":"0x<treasury_or_receiver_wallet>","supports_contract_checkout":false,"supports_direct_transfer":true,"explorer_tx_url":"https://etherscan.io/tx/{tx_hash}"}]
```

注意：

- `POLYWEATHER_PAYMENT_CHAIN_ID` 只是默认链，不代表只支持这一条链。
- `POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON` 里每个 token 必须有明确 `chain_id`。
- Ethereum 行如果没有部署 checkout 合约，必须设置 `supports_contract_checkout=false`，前端会显示手动转账并阻止钱包合约支付。
- 私有 RPC URL 带 API key 时应放入真实 `.env` 或密钥管理，不要提交。

### 6.5 机器人市场监控建议配置

这套配置围绕市场本身做两类推送：

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
```

说明：

- `TELEGRAM_ALERT_MISPRICING_ONLY=true` 表示关键提醒优先围绕错价/市场触发，不把机器人做成泛通知器。
- `TELEGRAM_MARKET_FOCUS_DIGEST_INTERVAL_SEC=1800` 表示频道每 30 分钟主动推送一轮全局机会清单；每轮会先扫描完整 `TELEGRAM_ALERT_CITIES`，再选 Top N。
- `TELEGRAM_MARKET_FOCUS_DIGEST_TOP_N=5` 建议先保持较小，避免机器人一次推太多城市。

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
