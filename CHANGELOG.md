# Changelog

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


## Unreleased

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
