# 配置与密钥管理（中文）

最后更新：`2026-08-01`

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
   - GitHub Secrets（构建期 `NEXT_PUBLIC_*` 通过 build-arg 注入前端镜像）
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

- 前端本地开发与容器运行时环境变量模板

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
- `POLYWEATHER_TURNSTILE_BYPASS`
- `POLYWEATHER_TURNSTILE_ENFORCE_ACTION`
- `POLYWEATHER_TURNSTILE_REQUIRE_PAYMENT_SUBMIT`
- `WEATHERNEXT2_ENABLED`（WeatherNext2 worker 与 GCS Zarr 数据接入开关，默认 1）
- `POLYWEATHER_OBSERVATION_COLLECTOR_ENABLED`（独立观测采集器开关，web 服务默认 true，collector 服务默认 true）
- `POLYWEATHER_PAYMENT_EVENT_LOOP_ENABLED` / `POLYWEATHER_PAYMENT_CONFIRM_LOOP_ENABLED`（支付事件/确认循环开关，默认 true）
- `POLYWEATHER_WEEKLY_REWARD_ENABLED`（周榜奖励，默认 true）/ `POLYWEATHER_GROWTH_REWARD_ENABLED`（成长里程碑奖励，默认 false）

### 4.3 L3：运行调优项

这些一般不需要在第一天就改。

例如：

- 各类 `*_TTL_SEC`
- 各类 `*_TIMEOUT_SEC`
- 各类 `*_COOLDOWN_SEC`
- 各类 `*_INTERVAL_SEC`
- `TELEGRAM_AIRPORT_PUSH_INTERVAL_SEC`（机场跑道推送循环，默认 60）
- `TELEGRAM_AIRPORT_PUSH_MAX_WORKERS`（共享 VPS 建议保持 1）
- `POLYWEATHER_PAYMENT_RPC_URLS`
- `POLYWEATHER_PAYMENT_RPC_URLS_BY_CHAIN_JSON`
- `POLYWEATHER_PAYMENT_EVENT_LOOP_INTERVAL_SEC`（默认 20）/ `POLYWEATHER_PAYMENT_EVENT_LOOP_START_LOOKBACK_BLOCKS`（默认 5000）/ `POLYWEATHER_PAYMENT_EVENT_LOOP_STEP_BLOCKS`（默认 2000）/ `POLYWEATHER_PAYMENT_EVENT_LOOP_MAX_EVENTS_PER_CYCLE`（默认 200）
- `POLYWEATHER_PAYMENT_CONFIRM_LOOP_INTERVAL_SEC`（默认 20）/ `POLYWEATHER_PAYMENT_CONFIRM_LOOP_IDLE_INTERVAL_SEC`（默认 300）/ `POLYWEATHER_PAYMENT_CONFIRM_LOOP_IDLE_AFTER_EMPTY_CYCLES` / `POLYWEATHER_PAYMENT_CONFIRM_LOOP_BATCH_SIZE`（默认 20）
- `POLYWEATHER_SUPABASE_PROFILE_SYNC_MIN_INTERVAL_SEC`（默认 3600）/ `POLYWEATHER_SUPABASE_POINTS_SYNC_MIN_INTERVAL_SEC`（默认 60）
- `TAF_CACHE_TTL_SEC`（默认 900）
- `POLYWEATHER_CITY_SUMMARY_CACHE_TTL_SEC` 等城市缓存 TTL（默认由 `SCAN_ROWS_REFRESH_SEC`（120s）与 `OBSERVATION_REFRESH_SEC`（60s）钳制，见 `web/services/city_runtime.py`）
- `WEATHERNEXT2_WORKER_INTERVAL_SEC`（默认 21600）/ `WEATHERNEXT2_WORKER_INITIAL_DELAY_SEC`（默认 90）
- `POLYWEATHER_OBSERVATION_COLLECTOR_TICK_SEC`（默认 30）/ `POLYWEATHER_OBSERVATION_COLLECTOR_INITIAL_DELAY_SEC` / `POLYWEATHER_OBSERVATION_COLLECTOR_CACHE_REFRESH_WORKERS`（默认 2）
- `POLYWEATHER_OBSERVATION_COLLECTOR_*_SEC`（各来源轮询间隔：AMOS 60 / MADIS 300 / COWIN 60 / HKO 600 / MGM 300 / JMA 600 / MSS 60 / FMI 600 / KNMI 600 / IMS 600 / AEROWEB 900 / METAR 1800）
- `POLYWEATHER_ARBITRAGE_BATCH_CONCURRENCY`（默认 4）/ `POLYWEATHER_ARBITRAGE_BATCH_CACHE_TTL_SEC`（默认 12）/ `POLYWEATHER_ARBITRAGE_BATCH_PARTIAL_TIMEOUT_MS`（默认 15000）
- `POLYWEATHER_TRAINING_SETTLEMENT_INITIAL_DELAY_SEC`（默认 60）/ `POLYWEATHER_TRAINING_SETTLEMENT_INTERVAL_SEC`（默认 21600）/ `POLYWEATHER_TRAINING_SETTLEMENT_LOOKBACK_DAYS`（默认 10）
- `POLYWEATHER_WEEKLY_REWARD_SETTLE_WEEKDAY` / `POLYWEATHER_WEEKLY_REWARD_SETTLE_HOUR` / `POLYWEATHER_WEEKLY_REWARD_SETTLE_MINUTE` / `POLYWEATHER_WEEKLY_REWARD_CHECK_INTERVAL_SEC`（默认 300）
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
- `POLYWEATHER_TURNSTILE_SECRET_KEY`
- `POLYWEATHER_R2_ACCESS_KEY_ID`
- `POLYWEATHER_R2_SECRET_ACCESS_KEY`

## 5. 推荐部署矩阵

### 5.1 VPS / Docker（后端 + Bot）

建议放这些：

- 根 `.env` 的后端项
- 所有 secrets
- Bot / 支付 / watcher 配置

### 5.2 前端容器（Docker Compose）

前端与后端一起以 Docker Compose 部署，环境变量分两类来源：

**运行时变量**（`.env` 或 compose `environment` 块）：

- `POLYWEATHER_API_BASE_URL`（容器内使用 `http://polyweather_web:8000`）
- `POLYWEATHER_AUTH_ENABLED`
- `POLYWEATHER_AUTH_REQUIRED`
- `POLYWEATHER_OPS_ADMIN_EMAILS`
- `POLYWEATHER_DASHBOARD_ACCESS_TOKEN`
- `POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN`

**构建期变量**（GitHub Secrets → CI `build-and-push` → `frontend/Dockerfile` 的 `ARG`，改了必须重新构建镜像）：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `NEXT_PUBLIC_WALLETCONNECT_POLYGON_RPC_URL`
- `NEXT_PUBLIC_PAYMENT_ALLOWED_HOSTS`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `NEXT_PUBLIC_POLYWEATHER_APP_ANALYTICS`
- `NEXT_PUBLIC_POLYWEATHER_WEB_VITALS`
- `NEXT_PUBLIC_POLYWEATHER_EAGER_CITY_SUMMARIES`

说明：

- `/ops` 现在是前后端双层限制：
  - 前端页面入口读取 `POLYWEATHER_OPS_ADMIN_EMAILS`
  - 后端写接口同样读取 `POLYWEATHER_OPS_ADMIN_EMAILS`
- 因此，前端容器和后端容器两侧都应配置相同的管理员邮箱白名单。

不要把后端专用密钥全搬进前端容器。

### 5.3 GitHub Actions

当前 CI 已配置自动部署，需要的 secrets 见 `.github/workflows/ci.yml`：

- `VPS_SSH_KEY` / `VPS_HOST` / `VPS_USER` / `GHCR_PAT`（SSH 部署到 VPS）
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID`（同步 Cloudflare Cache Rules）
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`（构建期注入前端镜像）
- 前端构建期 `NEXT_PUBLIC_*`（注入前端镜像）

### 5.4 Cloudflare 免费能力

Turnstile：

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` 是浏览器可见的 site key，属于前端构建期变量；改动后需要重新构建前端镜像。
- `POLYWEATHER_TURNSTILE_SECRET_KEY` 只放 VPS / Docker `.env`，用于 Next API Route 服务端校验。
- `POLYWEATHER_TURNSTILE_BYPASS=true` 可在排障时临时关闭校验。
- 支付 tx 提交默认不强制二次 Turnstile，因为 Cloudflare token 是一次性校验；订单创建已做校验。只有确认 UX 能支持二次挑战时，才设置 `POLYWEATHER_TURNSTILE_REQUIRE_PAYMENT_SUBMIT=true`。

R2：

- `POLYWEATHER_R2_ACCOUNT_ID`
- `POLYWEATHER_R2_BUCKET`
- `POLYWEATHER_R2_ACCESS_KEY_ID`
- `POLYWEATHER_R2_SECRET_ACCESS_KEY`
- `POLYWEATHER_R2_REGION=auto`
- `POLYWEATHER_R2_ARCHIVE_SOURCE=redis`

归档脚本只读 Redis Stream 或 SQLite，不删除热路径数据：

```bash
python scripts/archive_realtime_events_to_r2.py --date 2026-06-16 --dry-run
python scripts/archive_realtime_events_to_r2.py --date 2026-06-16
```

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
- 机器人推送当前以**机场跑道推送**为主（`TELEGRAM_AIRPORT_PUSH_*`）：逐机场按结算端点跑道温度推送双语摘要，默认 60 秒一轮；共享 VPS 建议 `TELEGRAM_AIRPORT_PUSH_MAX_WORKERS=1`。
- 周榜奖励与群消息积分见 `.env.example` 第 8 段（`POLYWEATHER_WEEKLY_REWARD_*`、`POLYWEATHER_BOT_MESSAGE_POINTS` 等），`POLYWEATHER_GROWTH_REWARD_ENABLED` 默认关闭。

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

### 6.4 WeatherNext2 / 套利对比 / 训练结算配置示例

以下均为可选模块，不开即可用默认行为：

```env
# WeatherNext2（GCS Zarr，6 小时周期）
WEATHERNEXT2_ENABLED=1
WEATHERNEXT2_BACKEND=gcs_zarr
WEATHERNEXT2_GCS_ZARR_URI=gs://weathernext/weathernext_2_0_0/zarr
WEATHERNEXT2_CITY_HIGHS_PATH=/app/data/weathernext2_city_highs.json
WEATHERNEXT2_MODEL_DIR=/app/data/models/weathernext2_calibrator
WEATHERNEXT2_WORKER_INTERVAL_SEC=21600
WEATHERNEXT2_WORKER_INITIAL_DELAY_SEC=90

# 套利对比（Polymarket overview）
POLYWEATHER_ARBITRAGE_REDIS_CACHE_ENABLED=1
POLYWEATHER_ARBITRAGE_REDIS_CACHE_TTL_SEC=3600
POLYWEATHER_ARBITRAGE_BATCH_CONCURRENCY=4
POLYWEATHER_ARBITRAGE_BATCH_CACHE_TTL_SEC=12
POLYWEATHER_ARBITRAGE_BATCH_PARTIAL_TIMEOUT_MS=15000

# 训练结算服务（初始延迟 60s、周期 6h、回看 10 天）
POLYWEATHER_TRAINING_SETTLEMENT_INITIAL_DELAY_SEC=60
POLYWEATHER_TRAINING_SETTLEMENT_INTERVAL_SEC=21600
POLYWEATHER_TRAINING_SETTLEMENT_LOOKBACK_DAYS=10

# 独立观测采集器（各来源轮询间隔）
POLYWEATHER_OBSERVATION_COLLECTOR_ENABLED=true
POLYWEATHER_OBSERVATION_COLLECTOR_TICK_SEC=30
POLYWEATHER_OBSERVATION_COLLECTOR_AMOS_SEC=60
POLYWEATHER_OBSERVATION_COLLECTOR_MADIS_SEC=300
POLYWEATHER_OBSERVATION_COLLECTOR_COWIN_SEC=60
POLYWEATHER_OBSERVATION_COLLECTOR_HKO_SEC=600
POLYWEATHER_OBSERVATION_COLLECTOR_CACHE_REFRESH_WORKERS=2
```

说明：

- WeatherNext2 worker 会读 GCS Zarr 生成 `weathernext2_city_highs.json`（写盘带 `.bak` 兜底），输出由 LightGBM 校准器转成 q10 / q50 / q90 高温度数分位。
- 套利对比接口无 Redis 时会退化为单进程内存缓存（`POLYWEATHER_ARBITRAGE_REDIS_CACHE_ENABLED`）。
- 观测采集器各来源间隔代码有下限钳制（如 AMOS 最低 30s、METAR 最低 1800s），参考 `web/observation_collector_service.py`。

### 6.5 机器人推送建议配置

当前机器人的主动推送以**机场跑道推送**为主（替换了早期基于 `TELEGRAM_ALERT_PUSH_*` / `TELEGRAM_MARKET_FOCUS_DIGEST_*` 的市场监控推送，这些变量已删除）：

推荐值：

```env
TELEGRAM_AIRPORT_PUSH_ENABLED=true
TELEGRAM_AIRPORT_PUSH_INTERVAL_SEC=60
TELEGRAM_AIRPORT_PUSH_MAX_WORKERS=1
TELEGRAM_PUSH_LANGUAGE=both
```

说明：

- `TELEGRAM_AIRPORT_PUSH_INTERVAL_SEC=60` 表示每 60 秒扫描一次结算端点跑道温度并推送斜率/当前/摘要。
- `TELEGRAM_AIRPORT_PUSH_MAX_WORKERS=1` 在共享 VPS 上保持单 worker，避免多进程重复推送。
- 周榜与群积分奖励通过 `POLYWEATHER_WEEKLY_REWARD_*`、`POLYWEATHER_BOT_MESSAGE_POINTS` 等控制，见 `.env.example` 第 8 段。

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
