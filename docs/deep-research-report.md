# PolyWeather 深度评估与改进提案报告

## 执行摘要

PolyWeather（仓库：`yangyuan-zhen/PolyWeather`）定位为**面向温度类结算预测市场（如 Polymarket 的温度结算合约）**的“生产级气象情报系统”，核心在于把多源天气观测/预报转化为**结算导向的概率桶（μ + bucket distribution）**，并进一步映射到市场报价完成**错价扫描**；同时提供 Web 仪表盘与 Telegram Bot 两套交互入口，并包含 Polygon 链上 USDC/USDC.e 支付、自动补单与订阅/积分体系。项目 README 现明确仓库代码采用 `AGPL-3.0-only`，同时将品牌、商标、生产私有数据与运营阈值保留在代码许可证之外。
从工程实现看，截至 `2026-03-21`，项目已经完成一轮明确的工程化收口：多源天气采集仍保持现有业务能力，同时已完成采集层与 Web API 大文件拆分、CI 质量门禁、配置分级（`.env.example` / `.env.secrets.example` / 中文部署文档）、EMOS/CRPS 校准链路、运行态状态与缓存向 SQLite 的渐进迁移，以及基础可观测性接口（`/healthz`、`/api/system/status`、`/metrics`）。
这意味着报告里最初最突出的“工程地基缺失”问题，已经有一部分被关闭：`src/data_collection/weather_sources.py` 与 `web/app.py` 不再是原来的超大单文件；GitHub Actions 已覆盖 Python、前端和 Docker build；配置与密钥治理已成体系；运行态状态不再只能依赖 JSON/JSONL 文件；EMOS 也不再只是概念，而是进入了可训练、可评估、可 shadow、可门禁判断的阶段。
但项目仍处在“从可用走向稳态”的中段，而不是终局。当前真正的高优先级问题已收敛为三类：第一，**运行态 SQLite 已经完成主读切换，但离线训练/回填脚本仍存在 legacy JSON/JSONL 默认输入**，需要继续把数据科学与运维脚本统一到单一数据源；第二，**可观测性只完成了轻量级指标层**，还没有形成完整的外部监控、阈值告警与趋势面板；第三，**EMOS 仍未达到生产切换标准**，当前门禁结论明确为 `hold`，阻塞原因是 shadow bucket brier 明显退化。支付链路方面，链下审计与容灾已明显增强：事件重放、SQLite 审计事件、RPC 多节点容灾、合约静态检查、`/ops` 支付异常单、按邮箱恢复脚本都已补齐；当前剩余风险主要集中在**链上合约本身仍是最小实现**，尚未升级到 SafeERC20、Pausable、链上套餐绑定等更强防护版本。
因此，当前阶段最正确的策略已经不是继续做“大范围基础重构”，而是围绕**迁移验收、可观测性补全、EMOS 上线门禁稳定化**这三条线持续收口。短中期内更高 ROI 的方向依然不是引入新的大模型，而是把现有“采集→后处理→市场映射→支付/订阅”的链路做成**状态一致、指标可见、发布可控、回退明确**的生产平台。
## 项目概览

PolyWeather 的目标与范围在 README/README_ZH 中定义得较清楚：为温度结算市场提供气象情报（多源采集→融合→概率→对照市场报价），并提供“官方看板（Vercel 前端）+ VPS 后端 + Telegram Bot”。
项目主功能可归纳为四层：
**天气层（数据源/采集）**：聚合 20 个城市的实测与预报；支持 AviationWeather METAR（机场观测）、土耳其 MGM 站网、Open-Meteo（含多模型与集合预报）、美国 NWS（仅美国城市）、以及部分城市使用官方结算源（香港 HKO、台北 CWA）等。
**分析层（DEB/趋势/概率/结算口径）**：
DEB（Dynamic Error Balancing）基于过去 N 天模型误差（MAE）倒数加权，输出融合预报；同时维护 `daily_records.json` 做历史对账、命中率/MAE 统计，并支持基于 WU（Weather Underground 口径）四舍五入的结算命中评估。
趋势/概率引擎在 `trend_engine.py` 中实现：综合“集合预报区间→σ/μ→高温窗口→死盘判定→温度桶概率分布→边界提示”等，用于 bot 展示与 web 结构化数据输出。
**市场层（Polymarket 行情对照）**：只读模式从 Gamma API 发现市场、从 CLOB（`py-clob-client` 或 REST 回退）读取价格/盘口并计算 edge（模型概率 − 市场概率）生成信号标签。
**商业化与支付**：订阅（`Pro Monthly 5 USDC`）、积分抵扣、Polygon 链上收款合约（USDC/USDC.e），并提供“事件监听 + 周期确认”的自动补单机制。
**支持的数据集/数据源**：项目不是传统“训练数据集+模型训练”的机器学习仓库；其“数据集”本质是外部实时/预报 API 与站点观测数据。对外部数据的使用需要遵守来源方的访问与速率限制，例如 AviationWeather Data API 明确限制请求频率（含每分钟请求上限/建议降低频率与使用缓存文件）。
**许可证**：仓库根目录 `LICENSE` 当前为 `AGPL-3.0-only`。同时 README 与策略文档明确：品牌、商标、生产私有数据与运营策略不随代码许可证一并授权。
（插图：项目 README 中包含产品截图，可用于快速理解信息架构与 UI 形态） 
![PolyWeather demo map](https://raw.githubusercontent.com/yangyuan-zhen/PolyWeather/main/docs/images/demo_map.png)

## 架构与代码库分析

### 代码库模块地图

从 README、Docker/Compose、入口脚本与核心模块引用关系，可以抽象出如下模块地图（按“运行时组件”与“Python 域模块”两层描述）：
| 层级 | 目录/文件 | 角色定位 | 关键说明 |
| ------------- | ------------------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 运行时组件 | `frontend/` | Next.js 前端（Vercel） | 前端重构报告提到 App Router、Route Handlers（BFF）、缓存策略、支付与账户中心等。 |
| 运行时组件 | `web/app.py` + `web/core.py` + `web/routes.py` + `web/analysis_service.py` | FastAPI 后端 API | 已从单文件入口拆为启动入口、核心上下文、路由层、分析服务层。 |
| 运行时组件 | `bot_listener.py` + `src/bot/*` | Telegram Bot | 入口 `bot_listener.py` 调 `start_bot()`，并由 `StartupCoordinator` 启动多个后台 loop。 |
| Python 域模块 | `src/data_collection/*` | 天气采集 + 城市注册 + 市场读取 | 采集层已拆为 `weather_sources.py` 编排层 + `open_meteo_cache.py`、`settlement_sources.py`、`metar_sources.py`、`mgm_sources.py`、`nws_open_meteo_sources.py`。 |
| Python 域模块 | `src/analysis/*` | DEB/趋势/概率/结算口径 | `deb_algorithm.py`、`trend_engine.py`、`settlement_rounding.py`。 |
| Python 域模块 | `src/analysis/probability_calibration.py` + `src/analysis/probability_rollout.py` | 概率校准与上线门禁 | 已支持 `legacy / emos_shadow / emos_primary`，并可产出 rollout 判断。 |
| Python 域模块 | `src/payments/*` + `contracts/*` | 支付合约 + 事件监听/补单 | Solidity 合约 + Python 侧事件扫描/确认循环 + SQLite 审计事件 + RPC 多节点容灾 + 合约静态检查。 |
| Python 域模块 | `src/auth/*`、`docs/SUPABASE_SETUP_ZH.md`、`scripts/supabase/schema.sql` | Supabase 鉴权/订阅/积分 | 使用 `/auth/v1/user` 校验 JWT、`/rest/v1/subscriptions` 查订阅（服务端角色 key 必须保密）。 |
| Python 域模块 | `src/database/runtime_state.py` | 运行态状态与缓存仓储 | 已接入 `daily_records`、`telegram_alert_state`、`probability_training_snapshots`、`open_meteo` 持久缓存。 |
| 工程与运维 | `docker-compose.yml`、`Dockerfile`、`.github/workflows/ci.yml`、`scripts/*` | 部署/验证脚本 | 现已具备 CI 门禁、迁移脚本、状态校验脚本、配置校验脚本与 rollout 报告脚本。 |

### 参考架构与关键工作流

项目 README 给出了一版 mermaid 参考架构图（Web/Telegram→FastAPI→采集→分析→支付/市场层）。 在此基础上，结合 `StartupCoordinator` 的 loop 启动与支付监听逻辑，可补充一个更“运行时视角”的架构图：
```mermaid
flowchart TB
 subgraph Clients
 WEB[Next.js Frontend<br/>Vercel]
 TG[Telegram Bot<br/>TeleBot + Handlers]
 end

 subgraph API
 FAST[FastAPI<br/>web/app.py]
 end

 subgraph Data
 WX[WeatherDataCollector]
 CITY[CITY_REGISTRY]
 HIST[(SQLite runtime state<br/>daily_records / cache / snapshots)]
 JSON[Legacy JSON files<br/>dual-mode fallback]
 end

 subgraph ExternalAPIs
 OM[Open-Meteo Forecast/Ensemble/Multi-model]
 AW[AviationWeather Data API<br/>METAR]
 MGM[MGM Turkey]
 NWS[api.weather.gov]
 HKO[data.weather.gov.hk]
 CWA[opendata.cwa.gov.tw]
 PM_G[Polymarket Gamma API]
 PM_C[Polymarket CLOB API]
 SB[Supabase Auth/REST]
 RPC[Polygon RPC]
 end

 subgraph Payments
 SOL[PolyWeatherCheckout.sol]
 EVT[event_loop<br/>scan logs]
 CF[confirm_loop<br/>confirm intents]
 end

 WEB --> FAST
 TG --> FAST
 TG -->|StartupCoordinator<br/>starts loops| EVT
 TG --> CF

 FAST --> WX
 WX --> OM
 WX --> AW
 WX --> MGM
 WX --> NWS
 WX --> HKO
 WX --> CWA

 FAST --> PM_G
 FAST --> PM_C

 FAST --> SB
 EVT --> RPC
 CF --> RPC
 RPC --> SOL

 WX --> HIST
 WX --> JSON
 FAST --> HIST
 WX --> CITY
```

### 依赖与运行环境

**Python 依赖**：`requirements.txt` 包含 `requests`、`loguru`、`pyTelegramBotAPI`、`python-dotenv`、`numpy`、`web3`、`fastapi`、`uvicorn` 等，符合“采集+bot+api+链上交互”的需求。
**容器环境**：`Dockerfile` 基于 `python:3.11-slim`，默认启动 bot；`docker-compose.yml` 通过不同 command 分别启动 bot 与 web（`python bot_listener.py` / `python web/app.py`），并挂载运行态数据目录。
**前端依赖**：前端 README 描述 Next.js、Leaflet、Chart.js、Supabase Auth、WalletConnect 等；`frontend/package.json` 是前端依赖来源。
### 数据预处理、模型与“训练/推理”管线

本项目的“模型”主要是统计融合与规则/启发式引擎，而非深度网络训练：
**天气数据预处理**：`WeatherDataCollector` 内部做了大量“输入清洗+缓存+退避”的工程处理：
包含 Open-Meteo 三类缓存（forecast/ensemble/multi_model）、429 冷却期、最小调用间隔、磁盘持久化缓存文件（重启后避免冷启动打爆 API）、以及 METAR/结算源缓存。
**DEB（Dynamic Error Balancing）**：以最近 N 天各模型的 MAE 计算倒数权重并做加权融合；同时将 `forecasts / actual_high / deb_prediction / mu / prob_snapshot` 写入 `data/daily_records.json`，并提供命中率/MAE/Brier 等统计口径。
**概率引擎**：`trend_engine.py` 以集合预报的 p10/p90 推 σ（并考虑历史 MAE floor、风向/云量/压强的 shock_score、以及峰值窗口 time-decay），再用正态近似把连续分布映射为 WU 整数“温度桶概率”。
**推理流水线（在线）**：
Web/Telegram 请求 → FastAPI 调用采集器抓取/复用缓存 → 分析引擎输出结构化结果（μ、概率桶、趋势、死盘/窗口判定、DEB 预测、市场扫描）→ 前端渲染或 bot 消息格式化。
**检查点（checkpoints）**：传统 ML checkpoint 不适用；但项目现已形成两类“业务状态 checkpoint”：
（a）SQLite 运行态存储（当前线上主路径）；（b）legacy JSON/JSONL 文件（主要保留给迁移回滚与部分离线脚本默认输入）。当前设计仍支持 `POLYWEATHER_STATE_STORAGE_MODE=file|dual|sqlite`，但对线上部署而言，推荐目标状态已经是 `sqlite`。
### 测试、CI/CD 与运维验证

**测试**：仓库存在 `tests/test_trend_engine.py`，覆盖 μ 计算、死盘判定、预报崩盘提示、趋势方向等核心逻辑（通过 patch 隔离外部依赖）。
**CI/CD**：已补齐 GitHub Actions 工作流，至少覆盖 Python lint/test、前端 build、Docker build 三条门禁；当前缺口不再是“有没有 CI”，而是“是否已在 GitHub 分支保护中强制执行”。
**运维验收**：除 `scripts/validate_frontend_cache.sh` 外，现已新增配置校验、运行态迁移/核验、EMOS rollout 判断等脚本，并提供 `/healthz`、`/api/system/status`、`/metrics` 作为基础观测入口。
**部署/更新**：Compose 用于启动服务；另有 `update.sh` 通过 `pkill` + `nohup` 重启 bot 与 web。
## 优势与薄弱点

### 优势

**产品闭环完整、目标明确**：从“天气→结算→市场→错价信号→付费体系（订阅/积分/链上支付）”形成可商业化闭环，并在 README 清晰列出当前产品状态（订阅、积分抵扣、链上支付、自动补单等已上线）。
**复用一套分析内核服务多端**：趋势/概率/DEB 等核心逻辑被抽成分析模块，并被 web 与 bot 共用，避免“两套逻辑漂移”。
**面向外部 API 的工程防护意识较强**：Open-Meteo 429 冷却期、最小调用间隔、磁盘缓存、缓存 TTL 等措施表明作者已遭遇并处理速率限制与冷启动问题。 同时 AviationWeather 官方文档也明确建议控制频率并可使用 cache 文件降低负载，项目后续可进一步对齐最佳实践。
**支付侧有“事件监听 + 确认补单”的双通路**：支付链路天然存在“交易 pending / RPC 延迟 / 日志索引不完整”等问题，项目通过 event loop 与 confirm loop 双机制提升最终一致性。
### 薄弱点与风险

**核心文件过大问题已明显缓解，但边界仍需继续稳定**：`WeatherDataCollector` 与 `web/app.py` 的超大文件问题已完成第一阶段拆分；当前风险已从“文件过大”转为“跨模块兼容与边界稳定性”，例如旧调用路径、兼容导出、跨层 helper 仍需持续清理。
**可复现性已从“缺模板”进入“模板与生产对齐”的阶段**：`.env.example`、`.env.secrets.example`、中文配置文档、前端部署文档、运行时配置校验器都已存在；当前风险主要在于线上历史 `.env` 与新模板并存、旧变量命名残留、以及密钥轮换与分层是否真正落实。
**CI 已建立，但组织级质量门禁未必完全收口**：CI 现已覆盖 Python、前端与 Docker build。当前问题不再是“缺 CI”，而是是否把这些 status check 绑定到 `main` 保护策略，以及是否逐步引入更严格的 pre-merge 审查。
**运行态状态/缓存迁移已完成主切换，但离线脚本仍待收口**：`daily_records`、`telegram_alert_state`、`probability_training_snapshots`、`open_meteo` 缓存已经支持并可在生产中主读 SQLite，迁移/校验脚本也已验证可用；当前残留问题不再是线上是否能切，而是部分训练、回填、报表脚本仍默认读取 `data/*.json` / `data/*.jsonl`，容易形成“线上一套数据、离线一套输入”的维护成本。
**第三方服务合规与稳定性风险**：
项目强依赖外部 API（Open-Meteo、AviationWeather、NWS、HKO、CWA、Polymarket、Supabase）。其中 AviationWeather Data API 有明确速率限制；Polymarket 官方说明 Gamma/Data/CLOB 三套 API 分属不同域，CLOB 交易端点需鉴权且策略可能变化；Supabase 明确强调 `service_role`/secret keys 绝不可暴露。若缺乏集中治理（重试/退避/熔断/降级/配额监控/密钥轮换），稳定性与合规不可控。
**可观测性已起步，但仍不构成完整监控体系**：项目现在已有 `/healthz`、`/api/system/status`、`/metrics`，并为 HTTP 与关键第三方源增加了轻量指标；但仍缺少 Prometheus/Grafana 级别的外部抓取、告警阈值、趋势面板和运行日报。这部分现在属于“已开始，不算完成”。
**EMOS 已完成工程接入，但未完成生产发布**：EMOS/CRPS 校准、shadow 观测、rollout report、上线门禁都已实现；当前真实门禁结果为 `hold`，阻塞原因是 shadow bucket brier 明显退化。因此概率引擎标准化并非未做，而是“工程完成、发布未通过”。
**许可证/商业使用的潜在冲突点**：仓库自身现为 `AGPL-3.0-only`，但如果未来尝试引入外部 AI 预报模型，仍需单独核验第三方代码与权重的商用条件：GraphCast 仓库代码 Apache-2.0，但权重使用 CC BY-NC-SA 4.0（非商业），Pangu-Weather 权重同样 BY-NC-SA 且明确禁止商业用途；不加区分地把这些模型用于付费产品会留下法律风险。
## 对标分析

为满足“至少 3 个相似开源项目或近期论文”对标，本报告选择三类代表：
1）**AI 气象预报模型**（GraphCast / FourCastNet / Pangu-Weather）：用于评估“若 PolyWeather 未来扩展到更强预测能力”的技术与许可边界； 
2）**概率后处理方法**（EMOS）：作为 PolyWeather 概率引擎的更标准化替代/对照； 
3）**预测市场 API 客户端生态**（Polymarket/py-clob-client、aiopolymarket）：用于评估市场层的工程选型。
### 关键对比表

| 项目/论文 | 解决的问题 | 输出形态 | 性能/效果（公开描述） | 易用性与依赖 | 许可证要点 |
| --------------------------------------------------------- | ---------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **PolyWeather**（本仓库） | 温度结算市场气象情报：多源→概率桶→错价扫描→订阅/支付 | 生产级应用（Web+Bot+API+支付） | 以工程能力为主；内置 DEB、概率桶、死盘判定、市场扫描；覆盖 20 城市。 | 主要依赖外部 API；Docker Compose 一键启动。 | 仓库 `AGPL-3.0-only`；品牌、生产私有数据与运营规则不随代码许可证授权。 |
| **GraphCast**（google-deepmind/graphcast） | 10 天全球中期预报（ML 替代/增强 NWP） | 模型代码+权重+notebooks | 论文与介绍提到在大量指标上优于主流确定性系统；仓库提供预训练权重与示例数据入口，并提示 ERA5/HRES 数据条款需另行遵守。 | 完整训练需 ERA5 等；更适合科研/平台级推理，不是产品级 BFF。 | 代码 Apache-2.0；权重 CC BY-NC-SA 4.0（商业限制）。 |
| **FourCastNet**（NVlabs/FourCastNet） | 高分辨率 data-driven 全球预报（AFNO/ViT） | 模型训练/推理代码+数据/权重链接 | README 描述：0.25° 分辨率、周尺度推理非常快，并可做大规模集合；适合平台型预报。 | 训练/数据依赖大（ERA5 子集 TB 级）；工程集成成本高。 | BSD 3-Clause（代码）。 |
| **Pangu-Weather**（198808xc/Pangu-Weather + Nature 论文） | 3D Transformer 架构的中期全球预报 | ONNX 推理代码+预训练模型 | Nature 论文称在 reanalysis 上对比 IFS 有更强确定性预报表现，并强调速度优势；仓库提供 ONNX 推理与 lite 版训练说明。 | 模型文件大（多份 ~GB 级），训练资源需求高；更适合科研推理或内部平台。 | 权重 BY-NC-SA 4.0、明确禁止商业用途。 |
| **EMOS**（Gneiting & Raftery 等） | 集合预报校准：纠偏与解决 underdispersion | 统计后处理方法 | 提出用回归形式输出概率分布（常见为高斯），并以 CRPS 等指标拟合，属于成熟的气象概率校准路线。 | 易落地：对 PolyWeather 而言只需“历史库+拟合器”。 | 方法论（论文）；可自行实现，无额外许可约束（注意论文版权）。 |
| **Polymarket/py-clob-client** | Polymarket CLOB 读写 SDK | Python SDK | 官方 SDK，支持 read-only 与交易接口；协议与端点在官方文档中给出。 | 易用，适合增强 PolyWeather 市场层。 | MIT。 |
| **aiopolymarket** | Polymarket APIs 的 async 客户端 | Python async 客户端 | 强调类型安全（Pydantic）、自动分页、重试与 backoff，适合高并发与健壮性诉求。 | 适合替换/补强当前同步 requests 与自定义缓存。 | 以仓库许可为准（此处建议上线前核验）。 |

**对标结论**：PolyWeather 与这类“全球 AI 预报模型”不在同一层级：PolyWeather 是“面向结算市场的产品化情报系统”，其价值核心是**将预测转成可交易/可结算的决策信息**。短中期内更高 ROI 的方向不是“自训大模型”，而是把现有“采集+后处理+市场映射”的链路做成**可复现、可观测、可评测、可扩展**的工程平台；在许可合规前提下，再评估引入外部模型推理作为额外信号源。
## 优先级改进建议

下表按截至 `2026-03-21` 的真实状态重排优先级。已完成项不再继续列为“待做”，只保留当前仍需推进的事项。
| 优先级 | 改进项 | 预估工作量 | 主要收益 | 主要风险 | 可执行步骤（建议顺序） |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------: | ------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 高 | **完成 SQLite 迁移的“第二阶段收口”**：把离线脚本、训练与回填链路统一成 SQLite 优先 | 2–5 天 | 彻底形成单一数据源，避免线上 SQLite 与离线 JSON/JSONL 双轨漂移 | 训练脚本行为变化可能影响既有报表或回填输出 | 1) 盘点所有默认读取 `data/*.json` / `data/*.jsonl` 的脚本 → 2) 改为按 `state_storage_mode` 自动优先读 SQLite → 3) 保留显式 `--history-file/--snapshot-file` 作为回退输入 → 4) 用同一批数据对比训练与报表结果 |
| 高 | **把轻量可观测性接入外部监控与告警**：围绕 `/metrics` 建立抓取、阈值与巡检 | 3–7 天 | 不再只靠日志定位问题；可以监控第三方源错误率、缓存命中与 HTTP 延迟 | 指标不分层会导致噪音高、告警无用 | 1) 抓取 `/metrics` → 2) 先围绕 HTTP、Open-Meteo、MGM、METAR 建立最小仪表板 → 3) 为 429/403/error/stale_cache 设阈值 → 4) 增加巡检脚本或告警通道 |
| 高 | **稳定 EMOS shadow 并收紧上线门禁** | 1–2 周 | 让概率引擎升级具备明确发布条件，避免拍脑袋切换 | 当前 shadow bucket brier 退化明显，存在误上线风险 | 1) 持续积累 snapshot 样本 → 2) 定期重训与生成 `evaluation_report` / `shadow_report` / `rollout_report` → 3) 重点压 `bucket_brier` 退化 → 4) 只有门禁从 `hold` 进入 `observe/promote` 后才考虑上线 |
| 中 | **市场层升级为 async + 类型安全**：引入 `aiopolymarket` 或在现有层加重试/backoff/连接池 | 4–7 天 | 行情层更稳，减少短时网络抖动；更易扩展更多市场/分页 | 依赖升级带来的行为差异 | 1) 把 requests.Session 替换为 aiohttp/httpx → 2) 在 Gamma/CLOB 调用侧实现指数退避 → 3) 引入 typed models，减少解析失败 |
| 中 | **支付合约从“最小可用”升级到“更强合约防护”** | 1–2 周 | 在已完成的链下审计与容灾之上，进一步收紧链上授权边界 | 合约升级需要重新部署、迁移配置并再次验证 | 1) 维持现有事件重放、SQLite 审计、多 RPC fallback → 2) 升级合约到 SafeERC20 + Pausable → 3) 评估链上 plan/amount/token 绑定或 EIP-712 签名校验 → 4) 迁移后更新 PolygonScan 验证与支付审计文档 |
| 中 | **将 CI 与分支保护/发布流程真正绑定** | 1–3 天 | 让现有 CI 从“存在”变成“强制门禁” | 历史分支/热修流程可能受影响 | 1) GitHub `main` 开启 required checks → 2) 把 release/tag 流程绑定 CI → 3) 明确热修例外流程 |
| 低 | **引入外部 AI 预报模型作为附加信号**（GraphCast/FourCastNet/Pangu-Weather 等） | 2–6 周（取决于范围） | 可能提升极端/中期预测能力与差异化 | **商业许可限制**（多为 CC BY-NC-SA/禁止商业）与算力成本 | 1) 先做合规评审（权重许可/数据条款）→ 2) 仅在研究/非商业环境评估 → 3) 若要商用，优先选择可商用权重或自研/购买授权 |

### 文档、测试与贡献流程的具体补强建议（落到仓库层面）

1）**文档体系**：保留现有中文 API/TechDebt 文档的同时，增加三份“高价值”文档：
（a）《运行与配置手册》：按环境（本地/测试/VPS/生产）列必需变量、默认值、敏感等级；（b）《数据源与合规说明》：列出 Open-Meteo、AviationWeather、NWS、HKO、CWA、Polymarket、Supabase 的使用条款要点、速率限制与降级策略（例如 AviationWeather 明确建议降低请求频率并提供 cache 文件）。 （c）《故障排查 Runbook》：429、支付 pending、市场扫描 miss、前端缓存异常等典型故障处理。
2）**测试金字塔**：在现有 `trend_engine` 单测基础上，补齐：
（a）天气 provider 的“录制回放”测试（VCR 思路：固定响应→确保解析稳定）；（b）市场层的契约测试（Gamma/CLOB schema 变更时提前失败）；（c）支付链路的本地链集成测试（Hardhat/Anvil + 事件扫描回放）。这些测试能把“外部依赖漂移”尽量转成可控的回归失败。
3）**贡献工作流**：引入 `CONTRIBUTING.md`（分支策略、PR 模板、变更日志、版本号策略）、`CODEOWNERS`（核心模块审查人）、`SECURITY.md`（漏洞披露与密钥处理），并把静态检查（ruff/eslint）作为 pre-commit + CI 必过项。
## 建议实验与基准

PolyWeather 的评测应围绕“结算场景”而非传统数值天气预报所有变量。建议建立两类基准：**气象预测基准（结算导向）**与**市场信号基准（交易导向）**。
### 气象预测与概率校准基准

**数据集**（建议从现有生产数据演进） 
1）`daily_records.json` 的历史快照：已包含多模型预报、`actual_high`、`deb_prediction`、`mu` 与概率快照字段，天然可转成评测数据（建议迁移到 DB 后做版本化导出）。
2）观测“真值”统一口径：对 METAR 城市用 AviationWeather Data API；对香港/台北等按结算源（HKO/CWA）作为真值，和项目当前逻辑一致。
**指标** 
1）确定性误差：MAE、RMSE（按城市、按季节、按风险等级分组）； 
2）结算命中率：`WU_round(pred) == WU_round(actual)`（项目已有统计口径）； 
3）概率质量：Brier Score（对离散温度桶），以及建议补充 CRPS（连续变量概率评分，EMOS 体系常用）。
4）校准曲线：预测概率分箱的可靠性图（reliability diagram）与 Sharpness（分布集中度）。
**基线**

- Baseline A：Open-Meteo 当日最高温（或 forecast median）作为点预测；
- Baseline B：等权平均（DEB 在历史少时也会回退此策略）；
- Baseline C：当前 DEB；
- Baseline D：EMOS（以 ensemble 均值/方差为输入，拟合 μ 与 σ，优化 CRPS）。
**预期结果（定性）**

- 若历史样本足够，DEB 应在“系统性偏差明显”的城市提升 MAE；
- EMOS 类方法通常能在概率校准（可靠性与 CRPS）上更稳定，尤其当 ensemble 信息可用（项目已接入 Open-Meteo ensemble/p10/p90）。
**算力**：以上评测全部可在 CPU 上完成；数据量按“20 城市 × 180 天”级别，pandas/duckdb 即可。若引入更复杂拟合（如分层贝叶斯/分位数回归），也通常不需要 GPU。
### 错价信号与市场有效性基准

**数据集**

- 保存每次扫描输出：`date/city/bucket/model_prob/market_price/liquidity/edge`，并加上未来 `settled_bucket` 作为标签；Polymarket 市场发现与报价来自 Gamma/CLOB（官方文档说明三套 API：Gamma/Data/CLOB）。
**指标**

- Signal 覆盖率：能否找到正确 market / bucket；
- Edge 稳健性：不同流动性分位的 edge 分布；
- 交易模拟（如需）：在考虑滑点/手续费/成交概率下的期望收益（即使项目当前只读，也可以离线评估“若执行”会怎样）。
**基线**

- 简单策略：仅用市场中间价（不做模型）作为概率；
- 当前策略：模型概率 vs 市场概率 edge 阈值；
- 改进策略：引入“流动性/盘口深度/波动”作为信号置信度（aiopolymarket/py-clob-client 提供更完整的盘口读取能力）。
**算力**：CPU 即可；关键在于数据采样与回放。
## 路线图与风险缓解

下面给出一个**12 周**（约 3 个月）的建议路线图，按“可稳定交付的工程里程碑”组织；人力以“1 名后端/数据工程 + 1 名前端（可兼职）+ 0.5 名链上工程（按需）”估算。
| 时间窗 | 里程碑 | 交付物 | 资源/备注 |
| ----------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 第 1–2 周 | 工程地基：CI + 规范 + 配置可复现 | GitHub Actions；ruff/eslint；pytest 可一键跑；`.env.example`；敏感项分级说明（尤其 Supabase service role key 不可暴露）。 | 后端为主；前端补 eslint/typecheck |
| 第 3–5 周 | 核心模块解耦：采集 Provider 化 + API 分层 | provider 接口与实现；`web/app.py` 拆分路由与服务；核心 schema（Pydantic） | 风险：行为漂移；用回放测试压住 |
| 第 6–8 周 | 状态/缓存统一 + 可观测性 | `daily_records/open_meteo_cache` 主读 SQLite；离线脚本也切到 SQLite 优先；指标（请求量/429/延迟/命中率）；告警阈值 | 可先用 SQLite/Redis，后续再上 Postgres |
| 第 9–10 周 | 评测体系上线 | 离线评测脚本（MAE/RMSE/WU-hit/Brier/CRPS）；日报/周报自动生成 | 直接基于项目现有字段扩展 |
| 第 11–12 周 | 概率引擎升级（可选）+ 市场层健壮性增强 | EMOS/CRPS 拟合的 shadow 输出；Gamma/CLOB 客户端增强（async、重试、分页） | 以“小步可回滚”为原则，避免一次性替换 |

### 主要风险与缓解策略

**外部 API 速率限制/格式变更**：AviationWeather 明确 rate limit 与建议使用 cache 文件；Open-Meteo 也可能在不同端点策略上变化。缓解：统一“请求预算”与退避/熔断；关键响应做 schema 校验与回放测试；对高频数据优先拉取官方 cache/批量接口（若可用）。
**密钥泄露与权限滥用**：Supabase 明确强调 `service_role` 属高权限密钥，绝不可出现在前端或公开环境。缓解：密钥分级、CI secret scan、运行时最小权限、日志脱敏。
**支付链路最终一致性与链上不确定性**：链上事件索引延迟、RPC 不稳定、交易确认数不足都会导致误判。当前项目已经补齐“事件监听 + 确认补单”双路径、事件重放脚本、SQLite 审计事件与多 RPC fallback；现阶段的主要剩余风险不再是“没有防护”，而是链上合约仍为最小实现，owner 为单地址管理，且没有 pause 开关与 SafeERC20。
**引入外部 AI 预报模型的商业合规风险**：GraphCast/Pangu-Weather 的权重许可均带非商业限制（CC BY-NC-SA/BY-NC-SA）；若 PolyWeather 是付费产品，必须先做法务与授权评审。缓解：只在研究环境评估；商用优先选择可商用权重/购买授权/自研。
**代码公开与生产私有资产边界导致的“公开仓库与生产行为不一致”**：README 明确品牌、商标、生产私有数据与运营阈值不在代码许可证授权范围内。缓解：把“公开核心”的可复现与评测做扎实（接口/数据 schema/测试/评测），私有策略只作为可插拔 policy layer 接入。
## 参考链接

- PolyWeather 仓库（本次评估对象）：https://github.com/yangyuan-zhen/PolyWeather
- Polymarket API 文档（Gamma/Data/CLOB）：https://docs.polymarket.com/api-reference
- AviationWeather Data API（METAR 等）：https://aviationweather.gov/data/api/
- Open-Meteo Docs（Forecast）：https://open-meteo.com/en/docs
- Open-Meteo Docs（Ensemble）：https://open-meteo.com/en/docs/ensemble-api
- Supabase REST API：https://supabase.com/docs/guides/api
- Supabase API keys（service_role 风险）：https://supabase.com/docs/guides/api/api-keys
- GraphCast（代码 Apache-2.0；权重 CC BY-NC-SA）：https://github.com/google-deepmind/graphcast
- FourCastNet（BSD-3）：https://github.com/NVlabs/FourCastNet
- Pangu-Weather（权重 BY-NC-SA，禁商用）：https://github.com/198808xc/Pangu-Weather
- Polymarket 官方 Python CLOB SDK（MIT）：https://github.com/Polymarket/py-clob-client
- aiopolymarket（async、类型安全）：https://github.com/the-odds-company/aiopolymarket


