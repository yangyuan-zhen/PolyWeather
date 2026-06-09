# Changelog

## 1.8.1 - 2026-05-28

### 文档与发布
- README / README_ZH 改用 `frontend/public/static/web.png` 与 `frontend/public/static/tel.png` 作为产品截图，并移除旧 `docs/images` README 截图引用。
- 同步版本源到 `1.8.1`，刷新 API、Supabase、技术债、PolygonScan 验证等文档标题版本。
- 更新前端、实时事件、数据源、模型栈与服务文档，补齐 Redis Stream + SSE Patch、DEB hourly consensus、城市当地时间图表、legacy 高斯图表叠加、跑道/CoWIN 曲线和中英文 Telegram 推送口径。

### 当前线上口径确认
- 生产实时层为“HTTP snapshot + SSE patch + replayable event store”；前端只消费 `/api/events`，不直接连接 Redis。
- `deb_hourly_consensus.v1` 是峰值窗口与 DEB 曲线展示的优先小时路径；DEB 不作为实测来源。
- AMSC/AMOS 跑道曲线和香港 CoWIN 6087 参考站曲线按城市当地时间展示，结算跑道高亮，辅助跑道弱化。


## 1.8.0 - 2026-05-27

### 新增与重构
- **终端大洲区域过滤与分组**：终端重构支持按大洲/区域过滤与分组，添加移动端大洲 Tab 与卡片流响应式布局。
- **巨鲸盯盘面板**：对接 Polymarket Data API `/holders`，按区域展示 Polymarket 成交量最大的城市、温度合约及真实巨鲸持仓数据。
- **气温走势图升级**：使用 Recharts 交互式图表，支持双向概率分布对比柱状图，并在图表底部渲染 Polymarket 市场点击直达链接。
- **日内偏差动态修正**：引入实时偏差修正算法，用实况观测与多模型小时预报的偏差来动态修正 DEB 预报中枢以及 Mu 概率分布，极大提高了预报和校准的精度。
- **多数据源气温监控图表**：引入 `LiveTemperatureThresholdChart` 组件，展示实时跑道观测、DEB 预报中枢、多模型区间及目标阈值。
- **全站中文化与多语言 (i18n)**：全站支持中英文一键切换，硬编码字符串彻底清理并接入翻译词条。
- **机构落地页与鉴权优化**：首页重构为专业的机构落地页，添加了基于中间件的双层终端门控（/terminal 路由和 landing page 登录态感知）。
- **超大组件拆分与解耦**：`AccountCenter` 组件彻底重构拆分为多个细粒度 Hook（`useWalletBind`、`usePaymentFlow`、`useBilling`），主组件代码缩减 60%，提升可维护性。
- **Telegram 高频推送与内存优化**：机场观测推送重构，限制 LRU 缓存避免内存膨胀，并针对 Bot 动作和 API 接入进行连接复用与速率限制。

### 修复与优化
- **类型异常修复**：修复在 `_in_peak_time_window` 决策卡时间窗口计算中 `last_h` 为 `None` 导致 `NoneType` 异常报错的问题。
- **清理冗余类型转换**：移除 `src/utils/telegram_push.py` 中 8 处冗余的 `str()` 显式包装，精简 Python 代码。


## 1.7.0 - 2026-05-23

### 新增能力
- 市场监控面板（MonitorPanel）：22 城实时温度监控，温度分辨率链（AMOS 跑道 → airport_primary → airport_current → current），按数据源新鲜度驱动刷新
- 中国城市天气日报：AI 生成每日天气摘要，接入 CMA weather.com.cn 预报数据，推送至 Telegram 论坛群
- 后台管理系统重写：从 1694 行单页拆分为 9 个模块（总览、会员、订阅、支付、训练、Telegram 审计、健康检查、配置、日志），含漏斗图、KPI 卡片、缓存饼图、增长趋势图
- 跑道观测系统重构：全跑道展示、结算跑道标注、热力模型、风场分析，推送增加市场状态标签（超预期/升温中/冲顶观察/降温中）
- 新增 6 个高频数据源：AEROWEB (Météo-France)、NCM (沙特)、IMS Lod (以色列)、AMSC AWOS (中国跑道)、MSS 1 分钟 (新加坡)、AROME HD 15 分钟 (巴黎)
- 接入 HKO 1 分钟、流浮山 LFS 1 分钟、CWA 10 分钟 (台北松山) 实时温度
- NOAA MADIS HFMETAR 适配新格式（netCDF stationId 替代 icaoId）+ 目录迁移适配
- KNMI 适配新数据布局 (station,time) + 5 位 WMO 码 + S3 下载认证修复
- 新增 GET /api/cities/model-range 端点
- 积分转账功能：管理员手动扣除/划转用户积分
- 支付提交前 Tx 预校验：链上验签收款地址与金额
- CI 全流程自动化：测试通过后自动 SSH 部署到 VPS
- 一键部署脚本：deploy.sh + deploy.ps1

### 移除
- 删除 LGBM 全部代码和模型文件，概率路径收口为 legacy 高斯分桶
- 删除 Polymarket 价格拉取与 UI 层（MarketDecisionLine）
- 删除 Groq、Meteoblue、NMC、俄罗斯 pogodaiklimat 数据源
- 删除预热（prewarm）系统
- 删除市场提醒引擎（market_alert_engine）
- 删除 Lagos、Masroor Air Base 城市
- 移除季付/年付计划，统一月付 10 USDC

### 修复与优化
- 修复移动端城市列表搜索无数据、Leaflet flyTo NaN 崩溃
- 修复 MacBook Safari 布局崩溃（100vw/dvh、-webkit-backdrop-filter、grid minmax 溢出）
- 修复温度曲线图三个渲染问题：数据点过少、张力过高、canvas CSS 拉伸
- 修复 Open-Meteo 冷却期无限循环导致多模型数据缺失
- 修复转化漏斗数据显示 3750%（前端重复乘以 100）
- 多模型缓存优化 + ETag 缓存 + stale-while-revalidate
- 性能优化：Context 重渲染、LGBM 循环移除、TTL 对齐
- 账户页 Pro 状态偶发性丢失修复
- 机场推送重构：观测缓存分离 + 全城市覆盖 + 四路并发

- 全面修复前端 UI 设计审查 15 项问题：消除工程债务、统一 token 体系、提升可维护性
- CSS 架构：消除 !important 滥用（134→49，仅保留 Leaflet/图表所必需项）、浅色主题重构为 `html.light` 选择器体系
- 统一断点体系：18→10（480/640/768/960/1024/1200/1280/1360/1440/1680），对齐 Tailwind 标准
- CSS 变量迁移：10 个文件中数百处硬编码颜色（#4DA3FF/#E6EDF3/#9FB2C7/#6B7A90）替换为 token 变量
- 字体系统修复：13 个文件中所有非标准 font-weight（760/850/860/880/950）映射为 Inter 支持值
- 移除未加载的 Geist 字体声明、提升文字对比度 #6B7A90→#7D8FA3
- 修复 accent-green 类错误渲染为蓝色、accent-primary 与 accent-secondary 相同值问题
- 创建 scan-root-styles.ts 桶文件，将 22 个 CSS Module 导入合并为 1 个
- 添加全局 :focus-visible 轮廓环、跳过链接、Tab ARIA 属性
- 添加统一的 empty/error/retry 状态组件、prefers-reduced-motion 支持
- 去重 @keyframes：spin 4→1、loading-spin 2→0、pulse-pending 移至全局
- 添加 CSS 渐变品牌 Logo、按钮层级文档化
- 移除 dead code（1,697 行）：public/static/style.css + public/legacy/index.html
- Dashboard.module.css 本地变量桥接至全局 token
- 清理冗余文档：移除 FRONTEND_REDESIGN_REPORT.md、TECH_DEBT.md 重复文件、AGENTS.md
- 参考：docs/frontend-ui-design-review.md 完整修复记录

## 1.5.5 - 2026-04-27

- Dashboard 新增 v1.5.5 升级公告，提示所有会员已额外延长 7 天，并集中说明 DeepSeek 机场报文解读、日历行动视图、本地时间峰值窗口和 AI 证据护栏
- 城市决策卡空状态与市场不可用文案产品化：将“未接入/缺失”改为“市场价格暂不可用，天气判断仍可参考”，避免用户误以为系统故障
- 城市决策卡新增“为什么推荐/为什么不推荐”短句，优先解释实测突破、峰值窗口已过、METAR 过旧、市场暂不可用或模型一致等关键原因
- 移动端城市决策卡前置当前温度、预测高点和峰值时间；长 AI 解读在手机端默认折叠，可展开查看，市场价格单独成行展示
- 新增 Qingdao / 青岛城市，结算锚点接入 Wunderground 青岛胶东国际机场 `ZSQD` 历史页，并补齐别名、时区、预热、官方来源和前端地区归类
- 城市决策卡顶部状态标签收口为 2-3 个高优先级信号，优先展示“实测突破 / 峰值窗口已过 / METAR 过旧 / AI 解读中 / 市场价暂不可用 / 模型高度一致 / 需要等待下一报文”，让用户第一眼看到重点
- 城市决策卡 AI 机场报文区明确拆分“快速判断已完成，AI 正在补充机场报文细节… / AI 机场报文解读已完成 / AI 解读未完整返回，当前使用规则证据”三种状态，减少 fallback 与流式返回造成的误解
- 城市决策卡新增“数据新鲜度”区块，分别展示 METAR/官方观测、模型、市场价格和 AI 状态；过旧观测会标明“仅作背景参考”
- 日历视图升级为行动视图，按“现在可看 / 1-3 小时内 / 今天稍后 / 已过峰值，等待确认”分组，并为每个城市显示一句核心原因
- 城市决策卡新增 AI 机场报文解读缓存说明：页面内存缓存保留 loading / 流式片段 / 最终结果，`localStorage` 保存最终成功 payload，后端 AI 缓存不再因 `local_time` 变化失效
- 城市决策卡兜底文案明确标记“快速证据模式”，避免在 DeepSeek 未完整返回时误写成“AI 机场报文解读正常”
- 城市决策卡流式 AI 解读改为只请求 METAR/官方观测核心解读与判断依据，最高温中枢、模型一致性和风险清单由后端规则补齐，减少等待时间
- 城市决策卡兜底判断新增实测突破识别：当最新 METAR/观测已高于 DEB 中枢或模型上沿时，改为提示最高温中枢需要上修
- 城市决策卡兜底判断补充实测偏低和峰值窗口已过分支：峰后未追上模型时提示下修压力，峰前偏低时只提示等待确认
- 城市决策卡新增过旧 METAR/观测识别：过旧报文只作为背景参考，不再触发强实况锚点、上修或下修判断；AI 缓存键同步纳入观测时间与 stale 状态
- 城市决策卡新增 AI 结果后处理护栏：完整 DeepSeek 返回若与过旧观测、实测突破、峰后下修等确定性证据冲突，会以后端规则覆盖关键数值和结论文案
- 城市决策卡新增状态标签与数据新鲜度提示，直接标出 AI 是否完成、市场价格是否同步、METAR/官方观测是否过旧或已突破模型区间，减少用户等待和误读
- 后端 Scan Terminal 代码拆出 `scan_city_ai_helpers.py`，将城市 AI JSON 解析、fallback 文案、schema completion 与证据护栏从主服务文件中剥离，降低后续维护成本
- 城市决策卡市场层改用完整 `all_buckets` 并严格识别 exact / range / or higher / or lower 温度桶方向，避免最高温中枢错配到不合理尾部桶
- 温度桶标签统一规范化 `C/F/°C/°F`，修复 `31°°C` 这类重复单位展示
- 决策卡展示文案将“概率差”收口为“模型-市场差”，明确口径为 `模型概率 - 市场隐含概率`
- Scan Terminal 新增日历视图：按城市 + 日期去重、按峰值窗口倒计时分组，并在卡片中同时展示用户电脑本地时间与城市窗口
- 日历视图只保留未来 12 小时内或峰后 3 小时内的可行动窗口，避免 London 这类距离峰值过久的城市过早占用日历
- README、前端 README、API 文档和网页 `/docs` 文档同步补充城市决策卡、AI 机场报文解读组成、缓存策略和市场层解释

## 1.5.4 - 2026-04-18

- 今日日内分析升级为专业气象判断台：主判断、置信度、基准/上修/下修路径、下一观测点、证据链、失效条件和确认条件前置展示
- 日内分析弹窗新增显式 `today/future` 模式，修复点击“今日日内分析”偶发进入未来日期分析布局的问题
- 日内分析在 full detail / market scan 同步完成前锁住旧内容，避免刷新期间短暂展示错误城市、错误日期或旧缓存数据
- 右侧详情面板识别稀疏 detail / 单日 forecast 中间态，并显示同步占位卡，避免用户把未补齐数据误认为完整结果
- 概率区改为“校准模型概率”：有 LGBM 时展示 LGBM 校准概率；模型共识与市场价格降级为辅助参考
- 模型层补齐 DWD ICON、ECMWF AIFS、ECCC GEM/GDPS/RDPS/HRDPS 等开放模型说明，并明确 AIFS 不称作“AI 预报”
- 新增 / 补齐 Manila、Karachi 等城市说明；机场市场以 METAR / 机场主站为结算锚点，Wunderground 仅作为历史页面或参考入口
- 历史对账、模型栈、LGBM、监控、前端 README 与网页 `/docs` 文档同步更新到当前产品口径

## 1.5.3 - 2026-04-10

- 东京新增 `JMA AMeDAS` 羽田 10 分钟官方增强层，只取温度并作为机场周边官方参考
- 韩国官方增强层补齐 `KMA` 接入链，与 `METAR` 锚点保持分离
- 城市点击交互恢复地图 `flyTo` 放大动画，并补回明确的 loading 提示
- 城市点击后新增地图顶部同步提醒与详情面板内同步徽标，降低“看起来像卡住”的误判
- 城市 detail 现在会识别“单模型 / 单日”的稀疏缓存并自动强刷，修复“模型只剩 DEB / 多日预报只剩今天”这类残缺展示
- 前端多日预报在窄面板下改为可横向滚动，并对稀疏日序列给出刷新提示
- `/ops` 与 `/api/system/status` 新增 prewarm worker 运行态、heartbeat、summary/detail/market 统计，以及缓存桶状态与 summary cache hit/miss
- 新增 Dashboard 定向预热脚本、后台 worker 和 docker service，支持热点城市 summary/detail/market 预热
- 共享天气采集 HTTP 层进一步统一到 `httpx` helper，并补齐短重试与错误分类
- 今日日内分析改造成更交易化的工作台结构：`锚点状态 / 当前节奏 / 当前命中胜率 / 模型区间与分歧 / 今日日内结构信号`
- 今日日内结构解读新增可选 `Groq` 改写层，失败时自动回退到规则文案
- 文档统一更新到 `v1.5.3`，补充预热 worker、Groq、Vercel 节流与官方增强站网说明

## 1.5.1 - 2026-03-23

- `/ops` 页面增加管理员守卫，前后端双层限制管理员访问
- `/ops` 支持会员列表、支付异常单、用户查询、周榜和手动补分
- `/ops` 支付异常单支持按原因筛选、标记已处理，并补充支付异常审计视图
- 会员列表支持按 `user_id` 去重，并优先回补 Supabase Auth 邮箱/注册时间
- 新增按邮箱补跑订阅恢复脚本 `scripts/reconcile_subscription_by_email.py`
- 支付确认失败（如 `receiver_mismatch`）现在会明确落 `failed`，并写入 SQLite 审计事件
- 支付前强制重新拉取 `/api/payments/config`，并校验最新地址、允许域名和当前支付上下文
- 浏览器钱包选择补齐 EIP-6963 发现、稳定去重和绑定后账户状态即时刷新
- 城市详情页新增 `官方参考 / Official Sources` 区块，覆盖主要城市的官方机构/机场/METAR 链接
- “今日日内分析”结构解读改为后端同源动态短评，并统一网页与 Bot 解释口径
- 台北主结算源切换到 `NOAA RCTP`，按最终质控后的最高整度摄氏值展示和说明
- 浏览器插件同步台北 `NOAA RCTP` 结算参考标签和说明
- `/ops` 手机端收口为卡片化视图，保留桌面表格
- 账户中心补充本周积分显示，`weekly_points` 与周排行同屏展示
- Dashboard 历史对账补充“峰值前 12 小时 DEB 参考（近似）”卡片
- 历史图不再错误混入 `settlement_history` 实测，历史样本仅按可比较样本统计
- 新增 `scripts/backfill_recent_daily_actuals_from_metar.py`，支持为缺失 `daily_records` 的 METAR 城市补最近 14 天 `actual_high`
- 历史接口对新接入的 METAR 城市增加自动 bootstrap，避免新增城市历史页整块空白
- 香港历史/日内展示继续坚持 `HKO` 官方口径，不再 fallback 到 `VHHH METAR` 连续线
- 香港 HKO 当天官方点位不再落单独 JSON，统一写入 runtime state
- 今日日内结构信号按城市本地时间与峰值窗口分析，不再只看固定下午时段
- 新增高空结构信号：冲高环境、压温风险、午后扰动、冲高效率，并提供中英文说明
- 新增交易动作卡：结合高空结构、市场拥挤度与 `edge_percent` 输出 `偏暖侧 / 偏谨慎 / 先观察`
- 非香港机场城市新增 `TAF` 接入，支持 `FM / TEMPO / BECMG / PROB30/40` 时间片解析
- 温度走势图新增 `TAF 时段 / TAF Timing` 标记，并在 tooltip 中显示对应时段摘要
- `TAF` 信号与 `market_signal / edge_percent` 联动进入交易动作，提示更贴近交易语境
- `TAF` 展示词已改成普通用户可读版本：`基础时段 / 明确切换 / 临时波动 / 逐步转变`
- 日内结构总摘要补充“TAF 未新增压温不等于继续升温”的解释，避免误读
- 浏览器插件多日预报改为 `DEB` 优先，基础判断卡补充方向、置信度与原因，并统一引流到主站首页

## 1.5.0 - 2026-03-21

- 运行态状态与缓存支持 SQLite 渐进迁移，新增 `POLYWEATHER_STATE_STORAGE_MODE=file|dual|sqlite`
- 新增 `/healthz`、`/api/system/status`、`/metrics`
- 新增支付运行态接口 `/api/payments/runtime`
- 支付侧新增 SQLite 审计事件、事件重放脚本与多 RPC 容灾支持
- 新增支付静态审计脚本与 V2 合约升级草案
- 统一周积分显示口径，`/top` 中“我的状态”改为累计发言/本周排名/本周积分
- 文档同步更新为 2026-03-20 当前状态

## 1.4.0 - 2026-03-14

- 统一收费阶段产品口径，发布 PolyWeather Pro `v1.4.0`
- 前端交付覆盖账户、支付、权限展示与缓存策略
- 支付链路支持 intent -> submit -> confirm 与自动补单
- 文档统一切换到单一版本源管理
