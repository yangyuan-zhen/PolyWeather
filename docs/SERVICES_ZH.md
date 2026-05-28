# 外部服务依赖总览

最后更新：`2026-05-28`

项目调用外部天气、鉴权、支付和实时事件服务。原则是：核心链路必须有明确健康检查；可选数据源不可拖垮已可用城市；实时事件层可从 Redis Stream 降级到 SQLite event log。

## 核心（必须有，挂了服务不可用）

| 服务 | 用途 | 状态 |
| --- | --- | --- |
| Open-Meteo | 51 城天气预报、多模型小时曲线、DEB hourly consensus 输入 | ✅ |
| AviationWeather (NOAA) | METAR / TAF 航空观测 | ✅ |
| MADIS (NOAA) | 美国机场 5 分钟高频观测 | ✅ |
| Supabase | 用户认证、订阅状态、会员恢复 | ✅ |
| Telegram Bot API | Bot 消息、群成员检查、双语跑道推送 | ✅ |
| Redis | `city_observation_patch.v1` Stream、SSE replay、多 worker fanout | ✅ |
| SQLite | 运行态数据库、支付审计、实时事件 fallback | ✅ |

## 国家气象源（特定城市必须）

| 服务 | 城市 | 状态 |
| --- | --- | --- |
| JMA AMeDAS | Tokyo | ✅ |
| AMOS (韩国) | Seoul, Busan 跑道传感器 | ✅ |
| AMSC AWOS (中国) | 北京、上海、广州、成都、重庆、武汉、青岛跑道端点气温 | ✅ |
| MGM (土耳其) | Ankara, Istanbul | ✅ |
| FMI (芬兰) | Helsinki | ✅ |
| KNMI (荷兰) | Amsterdam | ✅（需 key） |
| CoWIN 6087 (香港) | Hong Kong 1 分钟参考站 | ✅ |
| HKO (香港) | Hong Kong / Shenzhen / Lau Fau Shan 10 分钟官方气象层 | ✅ |
| CWA (台湾) | Taipei | ✅ |
| Singapore MSS | Singapore | ✅ |
| IMS Lod (以色列) | Tel Aviv | ✅ |
| AEROWEB / AROME HD | Paris | ✅ |
| NMC (中国) | 国内城市 fallback | ✅ |
| IMGW (波兰) | Warsaw | ⚠️ 未配 key |

## 可选 / 已禁用

| 服务 | 用途 | 状态 |
| --- | --- | --- |
| OpenWeatherMap | 天气 fallback | ⚠️ 未配 key |
| VisualCrossing | 历史天气 | ⚠️ 未配 key |
| SynopticData | 美国站点观测 | ⚠️ 未配 key |
| Meteoblue | 天气预报 | ❌ 已移除 |
| Russia pogodaiklimat | Moscow 历史源 | ❌ 已移除 |
| Groq | AI commentary | ❌ 已移除 |

## AI / 支付 / 前端

| 服务 | 用途 | 状态 |
| --- | --- | --- |
| MiMo (xiaomimimo) | 城市分析 AI 评论 | ✅ 当前使用 |
| DeepSeek | AI fallback | 备用 |
| Polygon RPC | 链上支付、自动确认 | ✅ |
| WalletConnect | 前端钱包连接 | ⚠️ 未配 key 时钱包入口降级 |

## 运维口径

- 生产实时事件推荐：`POLYWEATHER_EVENT_STORE=redis` + `POLYWEATHER_REDIS_URL=redis://polyweather_redis:6379/0`。
- 本地或单进程兜底：`POLYWEATHER_EVENT_STORE=sqlite`。
- Redis 只负责短窗口 replay 与多 worker fanout，不是长期天气历史库。
- DEB hourly consensus 依赖 Open-Meteo 多模型小时曲线；若上游限流，图表应保留已有 snapshot 和实测 patch，不把缺失模型误报为实测缺失。
