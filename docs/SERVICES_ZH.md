# 外部服务依赖总览

最后更新：`2026-05-23`

项目调用了 20 个外部服务，按状态分为三类。

## 核心（必须有，挂了服务不可用）

| 服务                   | 用途                  | 状态 |
| ---------------------- | --------------------- | ---- |
| Open-Meteo             | 52 城天气预报         | ✅   |
| AviationWeather (NOAA) | METAR/TAF 航空观测    | ✅   |
| MADIS (NOAA)           | 美国 5 分钟高频观测   | ✅   |
| Supabase               | 用户认证 + 订阅       | ✅   |
| Telegram Bot API       | Bot 消息 + 群成员检查 | ✅   |
| KNMI                   | Amsterdam 10 分钟观测 | ✅   |## 国家气象源（特定城市必须）

| 服务                 | 城市                  | 状态        |
| -------------------- | --------------------- | ----------- |
| JMA (日本)           | Tokyo                 | ✅          |
| KMA + AMOS (韩国)    | Seoul, Busan          | ✅          |
| AMSC AWOS (中国)     | 北京/上海/广州等 6 城 | ✅          |
| MGM (土耳其)         | Ankara, Istanbul      | ✅          |
| FMI (芬兰)           | Helsinki              | ✅          |
| HKO (香港)           | Hong Kong             | ✅          |
| CWA (台湾)           | Taipei                | ✅          |
| NMC (中国)           | 国内城市 fallback     | ✅          |
| Singapore MSS        | Singapore             | ✅          |
| IMGW (波兰)          | Warsaw                | ⚠️ 未配 key |
| Russia pogodaiklimat | Moscow                | ❌ 已移除   |

## 可选 / 已禁用

| 服务           | 用途          | 状态        |
| -------------- | ------------- | ----------- |
| OpenWeatherMap | 天气 fallback | ⚠️ 未配 key |
| VisualCrossing | 历史天气      | ⚠️ 未配 key |
| Meteoblue      | 天气预报      | ❌ 已移除   |
| SynopticData   | 美国站点观测  | ⚠️ 未配 key |

## AI / 其他

| 服务              | 用途             | 状态        |
| ----------------- | ---------------- | ----------- |
| MiMo (xiaomimimo) | 城市分析 AI 评论 | ✅ 当前使用 |
| DeepSeek          | AI fallback      | - 备用      |
| Groq              | AI commentary    | ❌ 已移除   |
| Polygon RPC       | 链上支付         | ✅          |
| WalletConnect     | 前端钱包连接     | ⚠️ 未配 key |

## 合计

15 个在用，3 个可选/未配置，3 个已移除。
