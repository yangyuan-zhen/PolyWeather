# 城市实时数据源总览

> 最后更新: 2026-05-26 | 51 城市

## 数据源分级

### Tier 1 — ≤1 分钟高频

| 城市 | 来源 | 频率 | 备注 |
|------|------|------|------|
| seoul | AMOS 跑道传感器 (RKSI) | ~1 min | global.amo.go.kr, 站号 113 |
| busan | AMOS 跑道传感器 (RKPK) | ~1 min | global.amo.go.kr, 站号 153 |
| hong kong | CoWIN 6087 | ~1 min | cowin.hku.hk, 保良局陳守仁小學，前端图表默认展示 |
| hong kong | HKO 官方 CSV | ~10 min | data.weather.gov.hk（文件名虽含 1min，实际 10min 一报） |
| singapore | MSS 官方 API | ~1 min | api.data.gov.sg, 站号 S24 |
| beijing | AMSC AWOS (ZBAA) | ~1 min | 中国 |
| shanghai | AMSC AWOS (ZSPD) | ~1 min | 中国 |
| guangzhou | AMSC AWOS (ZGGG) | ~1 min | 中国 |
| chengdu | AMSC AWOS (ZUUU) | ~1 min | 中国 |
| chongqing | AMSC AWOS (ZUCK) | ~1 min | 中国 |
| wuhan | AMSC AWOS (ZHHH) | ~1 min | 中国 |
| qingdao | AMSC AWOS (ZSQD) | ~1 min | 中国 |

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
| taipei | CWA 开放数据 (466920) | ~10 min | 台湾 |
| tel aviv | IMS Lod (225) | 实时 | 以色列 |
| paris | AEROWEB 实况 / AROME HD | 实时/15min | 法国 (AROME是15分钟临近预报) |

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
| jakarta | WIHH | |
| manila | RPLL | |
| karachi | OPKC | |
| lucknow | VILK | |
| wellington | NZWN | |
| cape town | FACT | |

## 高频推送覆盖

31 个城市在 `HIGH_FREQ_AIRPORT_CITIES`（Telegram 推送循环）:
所有 Tier 1-3 城市 + shenzhen

19 个城市在 `HIGH_FREQ_AIRPORT_ANALYSIS_CITIES`（日内分析）:
seoul, busan, hong kong, lau fau shan, singapore, beijing, shanghai,
guangzhou, chengdu, chongqing, wuhan, qingdao, shenzhen, tokyo,
ankara, istanbul, helsinki, amsterdam, paris

## 温度观测优先级链

`country_networks.py:_airport_primary_from_raw()` 按以下顺序解析:

1. MADIS HFMETAR（美国 11 城）
2. AMOS 跑道传感器（首尔/釜山）
3. MGM current（安卡拉/伊斯坦布尔）
4. JMA AMeDAS current（东京）
5. FMI current（赫尔辛基）
6. KNMI current（阿姆斯特丹）
7. CoWIN 6087（香港 1min 参考站）
8. AEROWEB current（巴黎）
9. IMS current（特拉维夫）
10. NCM current（吉达）
11. Singapore MSS current（新加坡）
12. 纯 METAR（默认兜底）

## 对日内偏差修正的影响

- **Tier 1 城市**（1 分钟级）：修正权重可以更激进，数据噪声低
- **Tier 2 城市**（5 分钟级）：修正效果良好，MADIS 更新稳定
- **Tier 3 城市**（10-15 分钟级）：修正可用但滞后较大
- **Tier 4 城市**（仅 METAR）：修正效果有限，不建议依赖


## 关于网站终端图表的数据曲线展示逻辑

### 1. 实测数据（默认全开，突出核心）

- **跑道全量展示**：北京、上海、广州、成都、重庆、武汉、首尔等城市的跑道实测数据，默认全量开启，无需手动勾选。
- **结算跑道高亮**：系统内置了各大机场的官方结算跑道映射。命中的跑道将被**重点强调**（加粗的青色实线 #009688，线宽 2.8），并标记为“[跑道号] 结算跑道”。具体的跑道映射如下：
  - 北京：19/01
  - 上海：17L/35R
  - 广州：02L/20R
  - 成都：02L/20R
  - 重庆：20R/02L
  - 武汉：04/22
  - 青岛：16/34
  - 首尔：15R/33L
- **辅助跑道弱化**：同一机场下的其他非结算跑道，也会同时展示，但采用较细的虚线（线宽 1.2）以作陪衬区分。
- **其他实测展示**：所有城市的 METAR 报文曲线、官方气象站实测（如 Hong Kong / Lau Fau Shan 的香港天文台曲线）均默认展示。

### 2. 核心预测数据（默认展示）

- **DEB 模型融合**：作为平台核心的高精度智能融合预测曲线，默认始终展示给用户。

### 3. 多模型原始数据（默认隐藏，按需自选）

- **保持整洁**：为了防止图表线缆过于杂乱，各大原始模型（ECMWF, GFS, ICON, GEM 等）的数据曲线在初次加载时**默认隐藏**。
- **特例**：仅针对巴黎（Paris），由于其 AROME HD 是高精度的 15 分钟级临近预报，极具参考价值，因此默认开启。
- **自由交互**：用户可通过图表底部的图例交互按钮，随时自由勾选、叠加或隐藏任意所需的数据曲线。
