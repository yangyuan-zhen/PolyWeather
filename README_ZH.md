# PolyWeather Pro

面向温度结算市场的生产级气象情报系统。

官方看板：[polyweather-pro.vercel.app](https://polyweather-pro.vercel.app/)

## 产品截图

### 全球看板

![PolyWeather 全球地图看板](docs/images/demo_map.png)

### 城市分析（Ankara）

![PolyWeather Ankara 分析页](docs/images/demo_ankara.png)

## 当前产品状态（2026-04-27）

- 已上线订阅制：`Pro 月付 5 USDC`。
- 已上线积分抵扣：`500 积分 = 1 USDC`，最多抵扣 `3 USDC`。
- 已上线链上支付：Polygon 合约支付（USDC / USDC.e）。
- 已上线自动补单：事件监听 + 周期确认双链路。
- 已上线支付运行态与审计接口：`/api/payments/runtime`。
- 已上线轻量运营后台：`/ops`（会员、周榜、补分、支付异常单）。
- 已上线轻量可观测性：`/healthz`、`/api/system/status`、`/metrics`。
- 已补最小外部监控栈：Prometheus + Alertmanager + Grafana + Telegram 告警 relay。
- 运行态状态、缓存与核心离线训练/回填链路已完成 SQLite 主路径收口；legacy JSON/JSONL 仅保留给迁移、导出与显式回退输入。
- EMOS/CRPS 校准链路已接通，但生产主概率保持 `legacy` 或 `emos_shadow`；`emos_primary` 只在本地离线评估通过并手动灰度后启用。
- 官方增强站网已统一接入：
  - `MGM`（土耳其）
  - `CMA/NMC`（中国内地）
  - `JMA AMeDAS`（日本）
  - `KMA`（韩国）
  - `HKO`（香港）
  - `CWA`（台湾）
- 东京现已接入羽田 `JMA AMeDAS` 10 分钟温度作为官方增强层。
- 已支持 Dashboard 定向预热 worker / cron 路径，运行态在 `/api/system/status` 与 `/ops` 可见。
- `/ops` 现已展示缓存桶数量、summary cache hit/miss 与 prewarm heartbeat。
- 今日日内分析已改为“专业气象判断台”：顶部先给气象主判断、置信度、基准/上修/下修路径、下一观测点，再展示证据链、失效条件、确认条件和模型层。
- 日内分析弹窗在 full detail / market detail 同步完成前会锁住旧内容并显示刷新状态，避免用户短暂看到上一轮缓存数据后误判。
- 城市决策卡已接入 AI 机场报文解读：先用 METAR、DEB、多模型集群和 AI 最高温中枢判断天气路径，再映射到 Polymarket 温度桶。
- AI 机场报文解读现在同时使用页面内存缓存、浏览器 `localStorage` 和后端短 TTL 缓存；从其他选项卡切回决策卡时会优先恢复已有流式内容或最终结果。
- 市场温度桶匹配已改为完整 `all_buckets` 映射，按 exact / range / or higher / or lower 方向严格匹配，避免把天气中枢错配到不合理尾部桶。
- 决策卡中的“模型-市场差”口径为 `模型概率 - 市场隐含概率`，正值表示天气概率高于市场报价，负值表示市场已经更充分计价。
- 概率区已改为“校准模型概率”；默认展示生产概率引擎输出，EMOS/LGBM 只在通过评估或作为 shadow 时进入解释层。
- 今日日内结构解读已支持可选 `Groq` 改写层，失败时自动回退规则文案。
- 前端部署文档已补充 Vercel 节流建议，包括 analytics 关闭、eager fetch 开关与扫描流量防火墙规则。
- 前端设计系统全面重构：统一 CSS token 体系、消除 !important 滥用（134→49）、合并断点（18→10）、数百处硬编码颜色迁移至 CSS 变量、添加 ARIA 无障碍属性和键盘导航。完整审查记录见 `docs/frontend-ui-design-review.md`。

## 许可证与商用边界（重要）

本仓库自 `2026-03-30` 起采用 **GNU AGPL-3.0-only**。

- 仓库公开部分：天气聚合、基础分析、前端看板、Bot 基础能力、标准支付流程。
- 不包含在仓库中的部分：生产私有数据、商业风控规则、运营阈值、收费策略细节、内部对账与增长工具。
- 商标、品牌、域名、生产数据库与托管服务运营能力，不因代码许可证一并授权。

详细见：[AGPL-3.0 与商用边界](docs/OPEN_CORE_POLICY.md)

## 核心能力

- 聚合 52 个监控城市的实测与预报数据。
- DEB（Dynamic Error Balancing）融合多模型最高温。
- 输出结算导向校准概率分布（`mu` + 温度桶），并在 LGBM 生效时展示校准引擎元数据。
- 将模型观点映射到 Polymarket 行情，做错价扫描。
- 地图城市决策卡把 AI 机场报文解读、最高温中枢、完整市场温度桶和模型-市场差放在同一张卡中展示。
- Web 仪表盘与 Telegram Bot 复用同一分析内核。
- 支付链路具备事件重放、SQLite 审计事件与 RPC 容灾能力。
- 官方增强层支持按国家 provider 统一接入，但不替代机场主站、METAR 或明确官方结算站。
- 支持后台预热热点城市，降低用户点击城市后的冷启动成本。

## 参考架构

```mermaid
flowchart LR
    U["用户（Web / Telegram）"] --> FE["Next.js 前端（Vercel）"]
    U --> BOT["Telegram Bot（VPS）"]
    FE --> API["FastAPI /web/app.py"]
    BOT --> API

    API --> WX["Weather Collector"]
    WX --> METAR["Aviation Weather（METAR）"]
    WX --> MGM["MGM（土耳其站网）"]
    WX --> JMA["JMA AMeDAS（日本）"]
    WX --> KMA["KMA（韩国）"]
    WX --> OM["Open-Meteo"]
    WX --> HKO["HKO / CWA / NOAA 等官方结算源"]

    API --> ANA["DEB + 趋势 + 概率 + 市场扫描"]
    ANA --> PAY["支付状态（Intent + Event + Confirm Loop）"]
    ANA --> PM["Polymarket 只读层"]
    API --> OBS["healthz / system status / metrics"]
    API --> PREWARM["Dashboard 预热接口 / Worker"]
    ANA --> LLM["可选 Groq 文案改写层"]
    ANA --> STATE["SQLite runtime state<br/>legacy files only for migration/export fallback"]
```

## 监控城市（52）

- 欧洲/中东/非洲：Ankara、Istanbul、Moscow、London、Paris、Munich、Milan、Warsaw、Madrid、Tel Aviv、Amsterdam、Helsinki、Lagos、Cape Town、Jeddah
- 亚太：Seoul、Busan、Hong Kong、Lau Fau Shan、Taipei、Shanghai、Beijing、Wuhan、Chengdu、Chongqing、Shenzhen、Guangzhou、Singapore、Tokyo、Kuala Lumpur、Jakarta、Manila、Wellington
- 美洲：Toronto、New York、Los Angeles、San Francisco、Aurora、Austin、Houston、Chicago、Dallas、Miami、Atlanta、Seattle、Mexico City、Buenos Aires、Sao Paulo、Panama City
- 南亚：Lucknow、Karachi

## 快速启动

### 后端 + Bot（Docker）

```bash
docker compose up -d --build
```

### 前端本地运行

```bash
cd frontend
npm ci
npm run dev
```

## 运行数据目录（VPS 推荐）

建议将运行态数据放到仓库外（避免 `git pull` 被 SQLite 卡住）：

```env
POLYWEATHER_RUNTIME_DATA_DIR=/var/lib/polyweather
POLYWEATHER_DB_PATH=/var/lib/polyweather/polyweather.db
POLYWEATHER_STATE_STORAGE_MODE=sqlite
```

## EMOS 本地训练流程

低配 VPS 只负责采集、服务和加载已通过评估的参数，不建议在 VPS 上跑 EMOS 全量训练。训练前先从 VPS 拉 SQLite 副本到本地：

```powershell
scp root@38.54.27.70:/var/lib/polyweather/polyweather.db E:\web\PolyWeather\data\polyweather-prod.db
```

本地训练：

```powershell
$env:POLYWEATHER_DB_PATH="E:\web\PolyWeather\data\polyweather-prod.db"
$env:POLYWEATHER_RUNTIME_DATA_DIR="E:\web\PolyWeather\artifacts\local_runtime"
python scripts\auto_retrain_probability_calibration.py --verbose --snapshot-limit 50000
```

只有 `auto_retrain_report.json` 中 `ready_for_promotion=true` 时，才允许把候选 `default.json` 传回 VPS，并优先以 `emos_shadow` 观察。

## 运维验收

### 健康与系统状态

```bash
curl http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/system/status
curl http://127.0.0.1:8000/metrics
```

### Dashboard 预热 Worker

```bash
docker compose --profile workers up -d polyweather_prewarm
curl http://127.0.0.1:8000/api/system/status
```

重点关注：

- `prewarm.thread_alive`
- `prewarm.runtime.cycle_count`
- `prewarm.runtime.last_summary_ok`
- `cache.analysis.hit_rate`

### 前端缓存头

```bash
./scripts/validate_frontend_cache.sh "https://polyweather-pro.vercel.app"
```

### 支付自动补单日志

```bash
docker compose logs -f polyweather | egrep "payment event loop started|payment confirm loop started|payment auto-confirmed"
```

### 外部监控栈

```bash
docker compose --profile monitoring up -d polyweather_prometheus polyweather_alertmanager polyweather_alert_relay polyweather_grafana
```

- Prometheus：`http://127.0.0.1:${POLYWEATHER_PROMETHEUS_PORT:-9090}`
- Alertmanager：`http://127.0.0.1:${POLYWEATHER_ALERTMANAGER_PORT:-9093}`
- Grafana：`http://127.0.0.1:${POLYWEATHER_GRAFANA_PORT:-3001}`

手动巡检：

```bash
python scripts/check_ops_health.py --base-url http://127.0.0.1:8000
```

### 支付运行态

```bash
curl http://127.0.0.1:8000/api/payments/runtime
```

### 运营后台

- 前端入口：`https://polyweather-pro.vercel.app/ops`
- 后端需配置：

```env
POLYWEATHER_OPS_ADMIN_EMAILS=yhrsc30@gmail.com
```

### 钱包异动监听日志

```bash
docker compose logs -f polyweather | egrep "polymarket wallet activity watcher started|wallet activity pushed"
```

## Telegram 指令

| 指令 | 用途 |
| :-- | :-- |
| `/city <name>` | 城市实时分析 |
| `/deb <name>` | DEB 历史对账 |
| `/top` | 用户积分排行 |
| `/id` | 查看聊天 Chat ID |
| `/diag` | Bot 启动诊断 |
| `/help` | 帮助与用法 |

## 文档索引

- 英文总览：[README.md](README.md)
- API 文档（中文）：[docs/API_ZH.md](docs/API_ZH.md)
- 商业化说明：[docs/COMMERCIALIZATION.md](docs/COMMERCIALIZATION.md)
- AGPL-3.0 边界：[docs/OPEN_CORE_POLICY.md](docs/OPEN_CORE_POLICY.md)
- Supabase 接入：[docs/SUPABASE_SETUP_ZH.md](docs/SUPABASE_SETUP_ZH.md)
- 配置与密钥管理：[docs/CONFIGURATION_ZH.md](docs/CONFIGURATION_ZH.md)
- 前端部署（Vercel）：[docs/FRONTEND_DEPLOYMENT_ZH.md](docs/FRONTEND_DEPLOYMENT_ZH.md)
- EMOS 训练报告：[docs/EMOS_TRAINING_REPORT_ZH.md](docs/EMOS_TRAINING_REPORT_ZH.md)
- 概率快照归档：[docs/PROBABILITY_SNAPSHOT_ARCHIVE_ZH.md](docs/PROBABILITY_SNAPSHOT_ARCHIVE_ZH.md)
- 技术债（中文镜像）：[docs/TECH_DEBT_ZH.md](docs/TECH_DEBT_ZH.md)
- 技术债（主文档）：[docs/TECH_DEBT.md](docs/TECH_DEBT.md)
- 支付合约验证：[docs/payments/POLYGONSCAN_VERIFY.md](docs/payments/POLYGONSCAN_VERIFY.md)
- 支付审计说明：[docs/payments/PAYMENT_AUDIT_ZH.md](docs/payments/PAYMENT_AUDIT_ZH.md)
- 支付 V2 升级方案：[docs/payments/PAYMENT_UPGRADE_V2_ZH.md](docs/payments/PAYMENT_UPGRADE_V2_ZH.md)
- 运营后台说明：[docs/OPS_ADMIN_ZH.md](docs/OPS_ADMIN_ZH.md)
- 外部监控说明：[docs/MONITORING_ZH.md](docs/MONITORING_ZH.md)
- 模型栈与 DEB：[docs/MODEL_STACK_AND_DEB_ZH.md](docs/MODEL_STACK_AND_DEB_ZH.md)
- LightGBM 日最高温模型：[docs/LGBM_DAILY_HIGH_ZH.md](docs/LGBM_DAILY_HIGH_ZH.md)
- EMOS + LGBM 系统：[docs/EMOS_LGBM_SYSTEM_ZH.md](docs/EMOS_LGBM_SYSTEM_ZH.md)
- 深度评估报告：[docs/deep-research-report.md](docs/deep-research-report.md)
- 前端报告：[FRONTEND_REDESIGN_REPORT.md](FRONTEND_REDESIGN_REPORT.md)
- 发布流程：[RELEASE.md](RELEASE.md)
- 变更记录：[CHANGELOG.md](CHANGELOG.md)

## 当前版本

- 版本：`v1.5.4`
- 文档最后更新：`2026-04-19`
