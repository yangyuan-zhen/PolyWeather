# 机场高频实时数据源

最后更新：`2026-05-28`

## 已接入城市

| 城市 | 机场 | ICAO/站点 | 数据源 | 频率 | 类型 | 费用 |
|------|------|-----------|--------|------|------|------|
| 首尔 | 仁川国际 | RKSI | AMOS (`global.amo.go.kr`) | 1 分钟 | 跑道对温度（2对） | 免费 |
| 釜山 | 金海国际 | RKPK | AMOS (`global.amo.go.kr`) | 1 分钟 | 跑道对温度（1对） | 免费 |
| 香港 | CoWIN 6087 | 6087 | CoWIN (`cowin.hku.hk`) | 1 分钟 | 参考站温度（保良局陈守仁小学） | 免费 |
| 香港 | HKO | HKO | HKO 官方 CSV (`data.weather.gov.hk`) | 10 分钟 | 官方气象站温度 | 免费 |
| 台北 | 松山/中央气象署 | 466920 | CWA 开放数据 | 10 分钟 | 官方站点温度 | 免费 |
| 北京 | 首都机场 | ZBAA | AMSC AWOS | 3 分钟 | 跑道端点气温 | 免费 |
| 上海 | 浦东机场 | ZSPD | AMSC AWOS | 3 分钟 | 跑道端点气温 | 免费 |
| 广州 | 白云机场 | ZGGG | AMSC AWOS | 3 分钟 | 跑道端点气温 | 免费 |
| 成都 | 双流机场 | ZUUU | AMSC AWOS | 3 分钟 | 跑道端点气温 | 免费 |
| 重庆 | 江北机场 | ZUCK | AMSC AWOS | 3 分钟 | 跑道端点气温 | 免费 |
| 武汉 | 天河机场 | ZHHH | AMSC AWOS | 3 分钟 | 跑道端点气温 | 免费 |
| 青岛 | 胶东机场 | ZSQD | AMSC AWOS | 3 分钟 | 跑道端点气温 | 免费 |
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

> **AMSC AWOS**: 中国内地跑道城市读取 AMSC `getWindPlate` 中的 `TDZ_TEMP` /
> `MID_TEMP` / `END_TEMP`。这些字段是跑道观测位置气温，不是道面温度。
> 结算跑道展示使用配置的结算端点；辅助跑道只作为背景曲线。

## 独立观测采集器

- Web/API 进程启动 `observation-collector` 后台线程，按源频率独立采集，不依赖 Telegram 推送循环
- 默认频率：AMOS 60s、AMSC AWOS 180s、MADIS HFMETAR 300s、CoWIN 60s、HKO 600s
- 每次采集复用 `weather_sources.py` 现有 `_attach_*` 写入逻辑，负责写 `airport_obs_log` / `runway_obs_log` / 今日观测缓存，并通过 `/api/internal/collector-patch` 写 Redis Stream 或 SQLite event log 后广播 SSE
- 采集成功后刷新对应城市 `panel` cache；前端继续使用 HTTP snapshot + SSE patch，不需要依赖 Telegram 触发更新
- `observation_source_gate.py` 对 AMSC、AMOS、MADIS、HKO、CoWIN 做 per-source/per-city singleflight 和 SQLite cooldown，防止 Web 请求、collector 和兜底分析同时打同一个外部源

## Telegram 推送机制

- 每城按原生频率独立推送，不捆绑
- 首尔/釜山 60s，中国 AMSC 城市 180s，其余 600s
- 循环轮询 60s 以匹配最快频率
- Telegram 推送优先读取网站侧 `full`/`panel` 城市缓存；缓存缺失时只做非强制 `panel` 分析兜底，不触发 `force_refresh_observations_only`
- 仅当当前温度距 DEB 预测最高 ≤3°C 时推送
- 确认过峰值后自动停止

## 前端实时同步与 SSE Patch / Redis Stream 机制

为了向用户提供接近行情盘的实况响应并降低服务器负载，系统使用 **HTTP snapshot + Server-Sent Events (SSE) Patch + 可重放事件日志** 架构。生产环境推荐 Redis Stream；本地或单进程可回退 SQLite event log。

### 1. 数据推送链路 (Data Pipeline)
1. **Observation Collector 采集端触发**：`web.observation_collector_service` 按源频率调用采集层；在 `weather_sources.py` 中，当高频实况源（如 AMOS, AMSC, CoWIN, HKO, MADIS 等）采集到温度更新或观测时间变更时，会调用 `_emit_temperature_patch_if_changed` 过滤重复值，并异步向 `/api/internal/collector-patch` 发送 POST 报文。
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
Seoul / Incheon 16:03

15L/33R 14.6°C
15R/33L 15.2°C
今日DEB预报最高：18.2°C
今日实测最高：16.5°C（15:30）
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TELEGRAM_PUSH_LANGUAGE` | Telegram 自动推送的全局语言，可选 `both`/`en`/`zh` | `both` |
| `TELEGRAM_AIRPORT_PUSH_ENABLED` | 启用机场推送 | `true` |
| `TELEGRAM_AIRPORT_PUSH_INTERVAL_SEC` | 循环轮询间隔 | `60` |
| `TELEGRAM_AIRPORT_PUSH_LANGUAGE` | 机场推送语言覆盖，可选 `both`/`en`/`zh` | `both` |
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
