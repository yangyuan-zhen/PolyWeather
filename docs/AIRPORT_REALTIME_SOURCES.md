# 机场高频实时数据源

## 已接入城市

| 城市 | 机场 | ICAO/站点 | 数据源 | 频率 | 类型 | 费用 |
|------|------|-----------|--------|------|------|------|
| 首尔 | 仁川国际 | RKSI | AMOS (`global.amo.go.kr`) | 1 分钟 | 跑道对温度（2对） | 免费 |
| 釜山 | 金海国际 | RKPK | AMOS (`global.amo.go.kr`) | 1 分钟 | 跑道对温度（1对） | 免费 |
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

## 推送机制

- 每城按原生频率独立推送，不捆绑
- 首尔/釜山 60s，其余 600s
- 循环轮询 60s 以匹配最快频率
- 仅当当前温度距 DEB 预测最高 ≤3°C 时推送
- 确认过峰值后自动停止

## 前端实时同步与 SSE Patch 机制

为了向用户提供秒级实况响应并降低服务器负载，系统已从定时轮询架构全面迁移至 **Server-Sent Events (SSE) 增量更新（SSE Patch）** 架构。

### 1. 数据推送链路 (Data Pipeline)
1. **Collector 采集端触发**：在 `weather_sources.py` 中，当高频实况源（如 AMOS, CoWIN, MADIS 等）采集到温度更新或观测时间变更时，会调用 `_emit_temperature_patch_if_changed` 过滤重复值，并异步向 `/api/internal/collector-patch` 发送 POST 报文。
2. **FastAPI SSE 广播**：FastAPI 后端的 `sse_router.py` 接收到 Patch 后，将其推入 `sse_manager` 进行全局广播，事件被包装为 `city_patch` 增量包，包含自增的全局 `revision` 和最新的 `changes`。
3. **BFF 代理流**：浏览器前端通过 BFF (Next.js rewrites) 建立与 `/api/events` 的持久连接，从而无需定时轮询。

### 2. 前端消费与刷新规则 (Frontend Freshness Rules)
- **扫描列表免轮询更新**：`use-scan-terminal-query.ts` 通过 `useSsePatchVersion` 钩子订阅全局 SSE 版本。当有任何城市产生更新时，列表将触发按需重绘，之前固定的 5 分钟 `setInterval` 定时轮询已被彻底禁用。
- **详情图表增量合并**：`LiveTemperatureThresholdChart.tsx` 使用 `useLatestPatch(city)` 钩子订阅当前选中城市的增量 Patch。当收到 Patch 时，前端会将最新温度与时间戳以增量形式直接合并（Merge）入本地的 `hourly` 状态中，避免重新加载完整的 City Detail JSON。
- **双重降级兜底 (Safe Fallback Guard)**：
  - **无 Patch 轮询兜底**：为了防止 SSE 连接断开或长时间无 patch 导致界面卡死，所有**可见图表**（即 active 槽位、compact 栅格槽位或 maximized 视图）会启动一个 60 秒的检测定时器。
  - **触发条件**：若当前可见城市在连续 **2 分钟** 内没有收到任何 SSE patch，前端将自动发起主动请求：
    1. 调用轻量级的 `/api/city/{city}/summary` 快速拉取最新实况温度。
    2. 调用 `fetchHourlyForecastForCity(city, { ignoreCache: true })` 强刷完整的城市详情数据，确保数据一致性。
- **按需加载与 Stagger 优化**：在加载城市详情时，前端会优先加载 Active 状态的图表，而处于 Background/非活动状态的图表则通过 staggered timer (按槽位索引延迟 300ms~1500ms) 异步获取，以分流请求峰值。

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

## 未接入城市

| 城市 | 原因 |
|------|------|
| 马德里/Barajas | AEMET 注册页面失效 |
| 伦敦/Heathrow | Met Office 仅 1 小时更新 |
| 慕尼黑 | DWD 延迟 ~1 小时 |
| 米兰/华沙/莫斯科 | 无已知实时源 |
