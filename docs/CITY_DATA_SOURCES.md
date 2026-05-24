# 城市实时数据源总览

> 最后更新: 2026-05-25 | 51 城市

## 数据源分级

### Tier 1 — ≤1 分钟高频

| 城市 | 来源 | 频率 | 备注 |
|------|------|------|------|
| seoul | AMOS 跑道传感器 (RKSI) | ~1 min | global.amo.go.kr, 站号 113 |
| busan | AMOS 跑道传感器 (RKPK) | ~1 min | global.amo.go.kr, 站号 153 |
| hong kong | HKO 官方 CSV | ~1 min | data.weather.gov.hk, 4 路 CSV |
| lau fau shan | HKO 官方 CSV | ~1 min | 同上，站号 LFS |
| singapore | MSS 官方 API | ~1 min | api.data.gov.sg, 站号 S24 |

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
| beijing | AMSC AWOS (ZBAA) | 准实时 | 中国 |
| shanghai | AMSC AWOS (ZSPD) | 准实时 | 中国 |
| guangzhou | AMSC AWOS (ZGGG) | 准实时 | 中国 |
| chengdu | AMSC AWOS (ZUUU) | 准实时 | 中国 |
| chongqing | AMSC AWOS (ZUCK) | 准实时 | 中国 |
| wuhan | AMSC AWOS (ZHHH) | 准实时 | 中国 |
| qingdao | AMSC AWOS (ZSQD) | 准实时 | 中国 |
| tokyo | JMA AMeDAS (44166) | 10 min | 日本 |
| ankara | MGM (17128) | 5-15 min | 土耳其 |
| istanbul | MGM (17058) | 5-15 min | 土耳其 |
| helsinki | FMI 开放数据 | 10 min | 芬兰 |
| amsterdam | KNMI 数据平台 | 10 min | 荷兰 |
| taipei | CWA 开放数据 (466920) | ~10 min | 台湾 |
| tel aviv | IMS Lod (225) | 实时 | 以色列 |
| jeddah | NCM 官方 | 实时 | 沙特 |
| paris | AEROWEB 实况 / AROME HD 15min | 实时/15min | 法国 |

### Tier 4 — 仅 METAR（10 分钟缓存）

| 城市 | ICAO | 备注 |
|------|------|------|
| london | EGLC | Met Office 仅 1 小时更新 |
| moscow | UUWW | 俄罗斯 METAR 集群 + NOAA WRH 结算 |
| shenzhen | ZGSZ | 唯一无 AMSC AWOS 的中国城市 |
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
