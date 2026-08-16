# 机场高频实时数据源

> 由 AIRPORT_REALTIME_SOURCES.md + CITY_DATA_SOURCES.md 合并（2026-08-16）


最后更新：`2026-08-01`

## 已接入城市

| 城市 | 机场 | ICAO/站点 | 数据源 | 频率 | 类型 | 费用 |
|------|------|-----------|--------|------|------|------|
| 香港 | CoWIN 6087 | 6087 | CoWIN (`cowin.hku.hk`) | 1 分钟 | 参考站温度（保良局陈守仁小学） | 免费 |
| 香港 | HKO | HKO | HKO 官方 CSV (`data.weather.gov.hk`) | 10 分钟 | 官方气象站温度 | 免费 |
| 深圳 | 流浮山 | LFS | HKO 官方 CSV (`data.weather.gov.hk`) | 10 分钟 | 官方自动站温度（结算源） | 免费 |
| 东京 | 羽田 | RJTT | JMA AMeDAS (`jma.go.jp`) | 10 分钟 | 机场站点实时温度 | 免费 |
| 安卡拉 | Esenboğa | 17128 | MGM (`servis.mgm.gov.tr`) | 5-15 分钟 | 机场站点实时温度 | 免费 |
| 伊斯坦布尔 | 伊斯坦布尔机场 | 17058 | MGM (`servis.mgm.gov.tr`) | 5-15 分钟 | 机场站点实时温度 | 免费 |
| 赫尔辛基 | Vantaa | EFHK | FMI (`opendata.fmi.fi`) | 10 分钟 | 机场站点实时温度 | 免费 |
| 阿姆斯特丹 | Schiphol | EHAM | KNMI (`dataplatform.knmi.nl`) | 10 分钟 | 机场站点实时温度 | 免费（需注册） |
| 巴黎 | Le Bourget | LFPB | AROME HD (`api.open-meteo.com`) | 15 分钟 | 模型预报（非实测） | 免费 |
| 新加坡 | Changi | WSSS | Singapore MSS (`api.data.gov.sg`) | 1 分钟 | 机场站点实时温度 (S24 站) | 免费 |
| 纽约 | LaGuardia | KLGA | NOAA MADIS HFMETAR | 5 分钟 | 机场站点实时温度 | 免费 |
| 洛杉矶 | LAX | KLAX | NOAA MADIS HFMETAR | 5 分钟 | 机场站点实时温度 | 免费 |
| 芝加哥 | O'Hare | KORD | NOAA MADIS HFMETAR | 5 分钟 | 机场站点实时温度 | 免费 |
| 丹佛 | Buckley | KBKF | NOAA MADIS HFMETAR | 5 分钟 | 机场站点实时温度 | 免费 |
| 亚特兰大 | Hartsfield | KATL | NOAA MADIS HFMETAR | 5 分钟 | 机场站点实时温度 | 免费 |
| 迈阿密 | MIA | KMIA | NOAA MADIS HFMETAR | 5 分钟 | 机场站点实时温度 | 免费 |
| 旧金山 | SFO | KSFO | NOAA MADIS HFMETAR | 5 分钟 | 机场站点实时温度 | 免费 |
| 休斯顿 | Hobby | KHOU | NOAA MADIS HFMETAR | 5 分钟 | 机场站点实时温度 | 免费 |
| 达拉斯 | Love Field | KDAL | NOAA MADIS HFMETAR | 5 分钟 | 机场站点实时温度 | 免费 |
| 奥斯汀 | Bergstrom | KAUS | NOAA MADIS HFMETAR | 5 分钟 | 机场站点实时温度 | 免费 |
| 西雅图 | SeaTac | KSEA | NOAA MADIS HFMETAR | 5 分钟 | 机场站点实时温度 | 免费 |

> **Singapore MSS**: 新加坡气象局（MSS）通过 data.gov.sg 开放数据平台提供全国 15 个站点
> 的干球温度（1 分钟均值），更新频率 ~1 分钟。选取 S24 Upper Changi Road North 站
> 作为樟宜机场 (WSSS) 的实时温度锚点。数据公开免费，无需 API 密钥。
> 后端通过 `singapore_mss_sources.py` 拉取并注入 `airport_primary`。

> **NOAA MADIS HFMETAR**: 美国 11 个城市的机场高频实时数据通过 NOAA MADIS 公共档案获取。
> 数据源为 NetCDF 格式（`madis-data.ncep.noaa.gov/madisPublic1/data/LDAD/hfmetar/`），
> 每 5 分钟全量更新一次，温度保留一位小数。匿名公开访问，无需 API 密钥。
> 后端通过 `weather_sources.py` 拉取并注入 `airport_primary`，前端市场监控通过
> `resolveMonitorTemperature` 优先读取 `airport_primary.temp` 获得小数精度温度。

> **CoWIN 6087**: 香港图表默认参考站为 HKU CoWIN `6087`（保良局陈守仁小学）。
> 该源提供约 1 分钟温度序列，作为 PM 最高温市场的高频参考曲线；HKO 10 分钟数据
> 仍作为官方气象层保留。后端通过 `cowin_sources.py` 拉取并写入 `cowin_obs`。

> **AMSC AWOS / AMOS（已移除）**: 中国内地跑道城市（北京/上海/广州/成都/重庆/武汉/青岛）的 AMSC
> `getWindPlate` 跑道端点气温已于 2026-06 下线；韩国 AMOS 跑道传感器（首尔/釜山）已移除。

> **台北 CWA（已移除）**: 台北 CWA 开放数据（466920）已于 2026-06 下线（观测零匹配）；
> 台北改走 NOAA Synoptic 结算源 + METAR。

## 独立观测采集器

- Web/API 进程启动 `observation-collector` 后台线程，按源频率独立采集
- 默认频率：MADIS HFMETAR 300s、CoWIN 60s、HKO 600s、MGM 300s、JMA AMeDAS 600s
- 每次采集复用 `weather_sources.py` 现有 `_attach_*` 写入逻辑，负责写 `airport_obs_log` / `runway_obs_log` / 今日观测缓存，并通过 `/api/internal/collector-patch` 写 Redis Stream 或 SQLite event log 后广播 SSE
- 采集成功后刷新对应城市 `panel` cache；前端继续使用 HTTP snapshot + SSE patch 更新
- `observation_source_gate.py` 对 MADIS、HKO、CoWIN、MGM、JMA 等做 per-source/per-city singleflight 和 SQLite cooldown，防止 Web 请求、collector 和兜底分析同时打同一个外部源

## 前端实时同步与 SSE Patch / Redis Stream 机制

为了向用户提供接近行情盘的实况响应并降低服务器负载，系统使用 **HTTP snapshot + Server-Sent Events (SSE) Patch + 可重放事件日志** 架构。生产环境推荐 Redis Stream；本地或单进程可回退 SQLite event log。

### 1. 数据推送链路 (Data Pipeline)
1. **Observation Collector 采集端触发**：`web.observation_collector_service` 按源频率调用采集层；在 `weather_sources.py` 中，当高频实况源（如 CoWIN, HKO, MADIS 等）采集到温度更新或观测时间变更时，会调用 `_emit_temperature_patch_if_changed` 过滤重复值，并异步向 `/api/internal/collector-patch` 发送 POST 报文。
2. **标准化事件**：`realtime_patch_schema.py` 将旧 `city_patch` 或新 payload 统一成 `city_observation_patch.v1`。
3. **事件存储**：生产环境写入 Redis Stream（`stream:city_observation`）并生成全局递增 `revision`；SQLite `observation_patch_events` 保留为本地/兜底 replay。
4. **FastAPI SSE 广播**：FastAPI 后端的 `sse_router.py` 根据城市订阅集合向匹配连接推送 patch；断线重连时按 `since_revision` replay。
5. **BFF 代理流**：浏览器前端通过 BFF 建立与 `/api/events` 的持久连接，从而无需固定整图轮询。

### 2. 前端消费与刷新规则 (Frontend Freshness Rules)
- **扫描列表免轮询更新**：`use-scan-terminal-query.ts` 通过 `useSsePatchVersion` 钩子订阅全局 SSE 版本。当有任何城市产生更新时，列表将触发按需重绘，之前固定的 5 分钟 `setInterval` 定时轮询已被彻底禁用。
- **详情图表增量合并**：`LiveTemperatureThresholdChart.tsx` 使用 `useLatestPatch(city)` 钩子订阅当前选中城市的增量 Patch。当收到 Patch 时，前端会将最新温度与时间戳以增量形式直接合并（Merge）入本地的 `hourly` 状态中，避免重新加载完整的 City Detail JSON。
- **双重降级兜底 (Safe Fallback Guard)**：
  - **无 Patch 轮询兜底**：为了防止 SSE 连接断开或长时间无 patch 导致界面卡死，所有**可见图表**（即 active 槽位、compact 栅格槽位或 maximized 视图）会启动一个 60 秒的检测定时器。
  - **触发条件**：若当前可见城市在连续 **2 分钟** 内没有收到任何 SSE patch，前端将自动发起主动请求：
    1. 调用轻量级的 `/api/city/{city}/summary` 快速拉取最新实况温度。
    2. 调用 `fetchHourlyForecastForCity(city, { ignoreCache: true })` 强刷完整的城市详情数据，确保数据一致性。
- **按需加载与 Stagger 优化**：在加载城市详情时，前端会优先加载 Active 状态的图表，而处于 Background/非活动状态的图表则通过 staggered timer (按槽位索引延迟 300ms~1500ms) 异步获取，以分流请求峰值。
- **前台恢复补齐**：浏览器标签页长时间在后台时，回来后会主动强刷可见图表 full detail，避免 SSE 被浏览器挂起后曲线落后。
- **当地时间**：patch 中保留 `city_timezone` / `observed_at_utc`，前端按城市当地时间绘制横轴。

## 消息模板

```
Hong Kong 16:03

当前: 14.6°C
日高: 16.5°C（15:30）
DEB：18.2°C
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `KNMI_API_KEY` | KNMI API 密钥（阿姆斯特丹必填） | — |
| `POLYWEATHER_EVENT_STORE` | 实时事件存储，可选 `redis`/`sqlite` | `sqlite` |
| `POLYWEATHER_REDIS_URL` | Redis Stream 连接地址 | `redis://127.0.0.1:6379/0` |
| `POLYWEATHER_REDIS_STREAM_KEY` | Redis Stream key | `stream:city_observation` |
| `POLYWEATHER_REDIS_STREAM_MAXLEN` | Redis Stream 保留长度 | `50000` |
| `POLYWEATHER_REDIS_REQUIRED` | Redis 不可用时是否启动失败 | `true` |

## 未接入城市

| 城市 | 原因 |
|------|------|
| 马德里/Barajas | AEMET 注册页面失效 |
| 伦敦/Heathrow | Met Office 仅 1 小时更新 |
| 慕尼黑 | DWD 延迟 ~1 小时 |
| 米兰/华沙/莫斯科 | 无已知实时源 |


---

# 城市实时数据源总览

> 最后更新: 2026-08-01 | 51 城市

## 数据源分级

### Tier 1 — ≤1 分钟高频

| 城市 | 来源 | 频率 | 备注 |
|------|------|------|------|
| hong kong | CoWIN 6087 | ~1 min | cowin.hku.hk, 保良局陳守仁小學，前端图表默认展示 |
| hong kong | HKO 官方 CSV | ~10 min | data.weather.gov.hk（文件名虽含 1min，实际 10min 一报） |
| singapore | MSS 官方 API | ~1 min | api.data.gov.sg, 站号 S24 |

> 注：AMSC AWOS（中国跑道）已于 2026-06 移除，中国内地城市不再有 3 分钟跑道高频源。

### Tier 2 — 5 分钟高频 (MADIS)

| 城市 | 来源 | 频率 | 备注 |
|------|------|------|------|
| new york | MADIS HFMETAR (KLGA) | 5 min | madis-data.ncep.noaa.gov |
| los angeles | MADIS HFMETAR (KLAX) | 5 min | |
| san francisco | MADIS HFMETAR (KSFO) | 5 min | |
| denver | MADIS HFMETAR (KBKF) | 5 min | |
| austin | MADIS HFMETAR (KAUS) | 5 min | |
| houston | MADIS HFMETAR (KHOU) | 5 min | |
| chicago | MADIS HFMETAR (KORD) | 5 min | |
| dallas | MADIS HFMETAR (KDAL) | 5 min | |
| miami | MADIS HFMETAR (KMIA) | 5 min | |
| atlanta | MADIS HFMETAR (KATL) | 5 min | |
| seattle | MADIS HFMETAR (KSEA) | 5 min | |

### Tier 3 — 准实时国家级站网

| 城市 | 来源 | 频率 | 国家/地区 |
|------|------|------|------|
| tokyo | JMA AMeDAS (44166) | 10 min | 日本 |
| ankara | MGM (17128) | 5-15 min | 土耳其 |
| istanbul | MGM (17058) | 5-15 min | 土耳其 |
| helsinki | FMI 开放数据 | 10 min | 芬兰 |
| amsterdam | KNMI 数据平台 | 10 min | 荷兰 |
| shenzhen | HKO 官方 CSV (LFS) | ~10 min | 香港天文台流浮山自动站 |
| tel aviv | IMS Lod (225) | 实时 | 以色列 |
| paris | AEROWEB 实况 / AROME HD | 实时/15min | 法国 (AROME是15分钟临近预报) |

> 注：台北 CWA 已于 2026-06 移除（观测零匹配）；台北改走 NOAA Synoptic 结算源。

### Tier 4 — 仅 METAR（10 分钟缓存）

| 城市 | ICAO | 备注 |
|------|------|------|
| london | EGLC | Met Office 仅 1 小时更新 |
| jeddah | OEJN | NCM 数据源目前不可用 |
| moscow | UUWW | 仅 UUWW METAR 单站 |
| shenzhen | ZGSZ | 已接入 HKO 流浮山 10 分钟数据，见 Tier 3 |
| munich | EDDM | DWD 延迟约 1 小时 |
| milan | LIMC | 无已知实时源 |
| warsaw | EPWA | 含 IMGW 附近站 |
| madrid | LEMD | AEMET 注册已失效 |
| toronto | CYYZ | |
| mexico city | MMMX | |
| buenos aires | SAEZ | |
| sao paulo | SBGR | |
| panama city | MPMG | |
| kuala lumpur | WMKK | |
| manila | RPLL | |
| karachi | OPKC | |
| lucknow | VILK | |
| wellington | NZWN | |
| cape town | FACT | |

## 温度观测优先级链

`country_networks.py:_airport_primary_from_raw()` 按以下顺序解析:

1. MADIS HFMETAR（美国 11 城）
2. MGM current（安卡拉/伊斯坦布尔）
3. JMA AMeDAS current（东京）
4. FMI current（赫尔辛基）
5. KNMI current（阿姆斯特丹）
6. CoWIN 6087（香港 1min 参考站）
7. AEROWEB current（巴黎）
8. IMS current（特拉维夫）
9. NCM current（吉达）
10. Singapore MSS current（新加坡）
11. 纯 METAR（默认兜底）

## 对日内偏差修正的影响

- **Tier 1 城市**（1 分钟级）：修正权重可以更激进，数据噪声低
- **Tier 2 城市**（5 分钟级）：修正效果良好，MADIS 更新稳定
- **Tier 3 城市**（10-15 分钟级）：修正可用但滞后较大
- **Tier 4 城市**（仅 METAR）：修正效果有限，不建议依赖


## 实时事件与图表刷新逻辑

当前终端图表不是固定整图轮询，而是：

1. 首屏 / 切换城市时拉取 `/api/city/{city}/detail` 作为完整 snapshot。
2. 可见图表连接 `/api/events?cities=...&since_revision=...&replay_limit=500`。
3. 采集器产出 `city_observation_patch.v1` 后写入 Redis Stream（生产）或 SQLite event log（本地/兜底），再通过 SSE 推给浏览器。
4. 前端把 patch 追加到已有实测序列，不显示 loading 遮罩；只有可见图表 2 分钟无 patch 时才启动 60 秒兜底刷新。
5. 浏览器从后台切回前台时，前端会立即补一次 full detail，防止长时间挂页后图表落后。

频率取决于源头：

- CoWIN / MSS：源头约 1 分钟，图表按 1 分钟粒度追加。
- MADIS：源头约 5 分钟。
- HKO / JMA / FMI / KNMI：源头约 10 分钟。
- METAR-only 城市：按 METAR 可用频率和缓存 TTL，不伪装成 1 分钟实测。

所有图表横轴和 tooltip 时间均按城市当地时间展示，不按用户浏览器时区。

## 关于网站终端图表的数据曲线展示逻辑

### 1. 实测数据（默认全开，突出核心）

- **香港参考曲线**：Hong Kong 默认展示 CoWIN `6087`（保良局陈守仁小学）1 分钟参考站曲线；HKO 10 分钟实测作为官方气象层保留。
- **其他实测展示**：所有城市的 METAR 报文曲线、官方气象站实测（如 Shenzhen / Lau Fau Shan 的 HKO 自动站）均默认展示。

### 2. 核心预测数据（默认展示）

- **DEB 模型融合**：作为平台核心的智能融合预测曲线，默认始终展示给用户。DEB 是预测，不参与“实测接近峰值”的视觉预警计算。
- **DEB hourly consensus**：图表优先使用 `deb_hourly_consensus.v1` 的小时路径展示 DEB 曲线和推导“高温”窗口；如果缺失才回退旧的 hourly + DEB offset 路径。

### 3. 多模型原始数据（默认隐藏，按需自选）

- **保持整洁**：为了防止图表线缆过于杂乱，各大原始模型（ECMWF, GFS, ICON, GEM 等）的数据曲线在初次加载时**默认隐藏**。
- **特例**：仅针对巴黎（Paris），由于其 AROME HD 是高精度的 15 分钟级临近预报，极具参考价值，因此默认开启。
- **自由交互**：用户可通过图表底部的图例交互按钮，随时自由勾选、叠加或隐藏任意所需的数据曲线。

### 4. 高斯概率图层

- 概率主引擎为 DEB 正态引擎（`deb_normal`）；legacy 高斯概率保留为回退分支，不会作为时间序列曲线展示。
- 图表上只渲染概率温度带和 `mu` 参考线，帮助用户判断当前实测距概率中心和高概率区域的关系。
