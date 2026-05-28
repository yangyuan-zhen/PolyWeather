# PolyWeather 数据链路架构审查

> 审查日期：2026-06 | 视角：系统架构师 | 范围：完整数据采集→分析→API→前端状态
> 
> **修复状态：9/9 已完成；最后校准：2026-05-28**

## 一、数据架构总览

```
外部数据源                   Python 后端                         Next.js 前端
===========                  ==========                          ===========

Open-Meteo (预报+多模型) ─┐
METAR/TAF (航空气象)     ─┤
NWS (美国) / MGM (土耳其) ─┤
JMA/AMOS/AMSC/HKO/CWA    ─┤
CoWIN / MADIS / NOAA     ─┤
                              ├─ WeatherDataCollector            ├─ dashboard-client.ts
                              │   (内存缓存 + SQLite磁盘缓存)      │   (ETag浏览器缓存 + SWR)
                              │                                  │
                              ├─ _analyze()                      ├─ useDashboardStore
                              │   ├─ DEB 融合 (11模型加权)        │   (双Context拆分)
                              │   └─ 趋势引擎                    │   (扫描数据预加载)
                              │                                  │
                              ├─ scan_terminal_service.py        ├─ 扫描终端查询
                              │   ├─ ThreadPoolExecutor(4)       │   (120s TTL)
                              │   └─ AI 增强层 (DeepSeek)        │
                              │                                  │
                              ├─ FastAPI routes                  └─ API代理 (Next.js rewrites)
                              │   (HTTP snapshot + ETag 304)
                              │
                              └─ SSE /api/events
                                  (Redis Stream / SQLite replay)
```

## 二、数据采集层

### 源端（14个外部源）

| 源 | 类型 | 覆盖 | TTL |
|------|------|---------|------|
| Open-Meteo | 预报 + 多模型集合 | 全球 | 300s |
| METAR | 机场观测 | 全球 ICAO | 60s |
| TAF | 机场预报 | 全球 ICAO | 600s |
| NWS | 国家预报 | 美国 | 按请求 |
| MGM | 国家官方 | 土耳其 | 300s |
| ECMWF/GFS/ICON/GEM/JMA | 多模型 NWP | 全球 | 300s |
| HKO/CWA/NOAA/AMOS/AMSC/CoWIN | 结算/参考观测 | 特定国家 | 60s-600s |
| Redis Stream | 实时事件 replay / 多 worker fanout | 后端内部 | event-driven |

### 待改进

| # | 问题 | 优先级 |
|---|------|------|
| 1 | 无源端健康状态检测 | 🟡 |
| 2 | METAR TTL 60s 过于激进（机场每小时发一次） | 🟡 |
| 3 | 无请求重试（`POLYWEATHER_HTTP_RETRY_COUNT` 默认 0） | 🟡 |

## 三、分析层

### DEB 动态集成混合

自适应加权：11 模型按过去 7 天 MAE 动态分配权重。回退链完善。


### 概率校准


**已修复：校准漂移检测** — `check_calibration_drift()` 对比最近 CRPS 与基线，漂移 >15% 时告警，集成在 `/api/system/status` 的 `probability.drift` 字段。

| # | 问题 | 优先级 |
|---|------|------|
| 4 | 校准系数静态 JSON 文件，数据分布变化需手动重新训练 | 🟡 |

## 四、API 与缓存层

**已修复：ETag 304** — 后端 `_etag_middleware` 对 GET /api/* 自动返回 ETag (MD5)，支持 `If-None-Match`，匹配返回 304 + `Cache-Control: private, max-age=30`。

**已修复：TTL 匹配** — `SCAN_TERMINAL_PAYLOAD_TTL_SEC` 30s → 120s，匹配 ThreadPoolExecutor(4)×60 城的实际重算耗时。

**已实现：SSE 增量推送（SSE Patch）与可重放事件日志** — 引入 FastAPI SSE 广播通道 (`/api/events`)。数据采集端更新时自动向 `/api/internal/collector-patch` 推送最新温度；后端标准化为 `city_observation_patch.v1`，写入 Redis Stream（生产）或 SQLite event log（兜底）后再广播。前端扫描终端订阅该流，不再执行固定的 5 分钟定时轮询，而是根据 Patch 变化即时更新列表；当前选中图表基于 `useLatestPatch` 实现 1 分钟级温度的增量合并与实时曲线绘制。

| # | 问题 | 优先级 |
|---|------|------|
| 5 | 缓存键过粗（city::mode），微小变化也触发完整重算 | 🟡 |

## 五、前端状态管理

**已修复：sessionStorage 限制** — 只保留最近 3 个城市的详情，避免 3-10MB JSON 序列化阻塞主线程。

**已修复：Context 拆分** — `CityDetailsContext` 独立管理 `cityDetailsByName` 变更，新增 `useCityDetails` hook。只读详情数据的组件不因其他状态变化而重渲染。

**已修复：Stale-while-revalidate** — `ensureCityDetail` 过期缓存立即返回 + 后台异步刷新，用户不再看到 loading spinner。

**已修复：扫描数据复用** — `preloadCityFromRow()` 从扫描终端行预填充城市详情缓存，选城市后详情面板立即显示。

**已实现：SSE 订阅、replay 与 2 分钟无 Patch 兜底机制** — 引入 `useLatestPatch` 与 `useSsePatchVersion` 管理实况数据的准实时合并。若长连接中断，前端使用 `since_revision` replay 缺失事件；若 2 分钟内未收到任何增量 Patch，可见图表自动触发 60s 降级轮询（从 `/api/city/{city}/summary` 获取最新实况，并以 ignoreCache 强刷 full detail）。浏览器后台恢复时会主动刷新可见图表 full detail。

## 六、待办

| # | 问题 | 优先级 | 说明 |
|---|------|------|------|
| 1 | 校准系数需手动重新训练 | 🟡 | 漂移检测已有，但自动触发重训练需要 GPU/算力资源 |
| 2 | 缓存键过粗 — `city::mode` 粒度 | 🟢 | 微小温度变化触发完整重算，可考虑内容 hash 键 |

> 注：原审查中 METAR TTL 60s 实际为 600s（误诊）；扫描终端轮询已有 `AbortController` + `requestSeq` 保护（误诊）。
