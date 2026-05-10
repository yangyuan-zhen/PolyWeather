# PolyWeather 数据链路架构审查

> 审查日期：2026-06 | 视角：系统架构师 | 范围：完整数据采集→分析→API→前端状态

## 一、数据架构总览

```
外部数据源                   Python 后端                         Next.js 前端
===========                  ==========                          ===========
                                                    
Open-Meteo (预报+多模型) ─┐                                      
METAR/TAF (航空气象)     ─┤                                      
NWS (美国) / MGM (土耳其) ─┤                                      
JMA/KMA/NMC/HKO/CWA     ─┤                                      
Wunderground / NOAA      ─┤                                      
Polymarket Gamma/CLOB    ─┤                                      
                              ├─ WeatherDataCollector            ├─ dashboard-client.ts
                              │   (内存缓存 + SQLite磁盘缓存)      │   (请求去重 + sessionStorage)
                              │                                  │
                              ├─ _analyze()                      ├─ useDashboardStore
                              │   ├─ DEB 融合 (11模型加权)        │   (单React Context)
                              │   ├─ LGBM 预测                   │
                              │   ├─ EMOS 概率校准               ├─ ScanTerminalDashboard
                              │   └─ 趋势引擎                    │   (地图 + 决策卡 + 简报)
                              │                                  │
                              ├─ scan_terminal_service.py        ├─ 扫描终端查询
                              │   ├─ ThreadPoolExecutor(4)       │   (每10分钟轮询)
                              │   └─ AI 增强层 (DeepSeek)        │
                              │                                  │
                              └─ FastAPI routes                  └─ API代理 (Next.js rewrites)
                                  (36个端点)
```

---

## 二、数据采集层

### 2.1 源端（14个外部源）

| 源 | 类型 | 覆盖 | TTL |
|------|------|---------|------|
| Open-Meteo | 预报 + 多模型集合 | 全球 | 300s |
| METAR | 机场观测 | 全球 ICAO | 60s |
| TAF | 机场预报 | 全球 ICAO | 600s |
| NWS | 国家预报 | 美国 | 按请求 |
| MGM | 国家官方 | 土耳其 | 300s |
| ECMWF/GFS/ICON/GEM/JMA | 多模型 NWP | 全球 | 300s |
| HKO/CWA/NOAA/KMA/NMC | 结算观测 | 特定国家 | 300s |
| Wunderground | 个人气象站 | 全球备用 | 按请求 |
| Polymarket Gamma | 市场发现 | 所有温度市场 | 60s |
| Polymarket CLOB | 订单簿 | 匹配市场 | 30s |

### 2.2 采集架构

**优点：**
- `WeatherDataCollector` 使用 mixin 组合，清晰隔离每个源的实现
- 429 限流回退会冷却整个源，而不是逐个请求重试
- 内存缓存 + SQLite 磁盘缓存双写，重启后不丢失

**问题：**

| # | 问题 | 影响 |
|---|------|------|
| 1 | **无限流控制** — `POLYWEATHER_HTTP_RETRY_COUNT` 默认 0，意味着大部分源从不重试 | 单次网络抖动就丢失数据 |
| 2 | **无源端健康状态** — 无法知道是 Open-Meteo 挂了还是这个城市的数据就是空 | 调试困难，用户看到空数据不知道原因 |
| 3 | **METAR TTL 60s 太激进** — 机场 METAR 通常每小时发一次，60s 内再次请求没有意义 | 浪费带宽和外站配额 |

---

## 三、分析层

### 3.1 DEB 动态集成混合

**`deb_algorithm.py`** 用过去 7 天 MAE 计算 11 模型的动态权重。

**优点：**
- 自适应加权，表现差的模型自动降权
- 回退链完善：无历史 → 等权 → 少于2模型 → 返回 None

**问题：**

| # | 问题 |
|---|------|
| 4 | **LGBM 喂回 DEB 造成循环** — `_analyze()` 第 2057-2076 行：LGBM 预测值被当作另一个"模型"加入 `current_forecasts`，然后 DEB 重新计算权重。LGBM 本身就是用 DEB + 原始模型训练的，现在 DEB 又把 LGBM 输出作为输入，形成循环依赖 |
| 5 | **DEB 历史数据源不一致** — 同时从 `daily_records.json` 和 SQLite `daily_records_store` 读取，可能因为迁移时间差导致 MAE 计算用的历史数据版本不同 |

### 3.2 概率校准

**`probability_calibration.py`** 用 EMOS 线性回归校准 raw distribution。

**问题：**

| # | 问题 |
|---|------|
| 6 | **校准系数是静态 JSON 文件** — 需要手动运行训练脚本才会更新。如果数据分布变化（例如季节变化），旧系数会持续产生偏差，直到有人记得跑 `fit_probability_calibration.py` |
| 7 | **blend_alpha 网格搜索每次拟合都重新跑** — 0-1 的 0.05 步长搜索（400 次评估），没有缓存或增量优化 |

---

## 四、API 与缓存层

### 4.1 三层缓存

```
Layer 1: 进程内内存 dict  (TTL 30s ~ 1800s)
   ↓ 过期
Layer 2: SQLite 持久化缓存 (TTL 1800s)
   ↓ 过期
Layer 3: 重新计算 + 后台异步刷新
```

**优点：**
- 过期但存在时返回陈旧数据并触发后台刷新，用户不会等待
- 后台刷新有分布式锁（`cache_refresh_locks`），多进程不会重复计算

**问题：**

| # | 问题 |
|---|------|
| 8 | **扫描终端 TTL 仅 30s** — `SCAN_TERMINAL_PAYLOAD_TTL_SEC` 默认 30s。60 个城市的并行分析每 30s 就会触发一次完整重建。考虑到单个 `_analyze()` 耗时 2-8s，`ThreadPoolExecutor(4)` 跑 60 个城市至少需要 (60/4)*3s ≈ 45s，永远赶不上缓存过期速度 |
| 9 | **无 ETag / 304 支持** — 所有城市详情 API 都返回完整 JSON body，即使数据没变化。前端每次都重新解析整个 30-150KB 的 payload |
| 10 | **缓存键过粗** — 分析缓存键是 `city::mode`，但 mode 只有 `summary/panel/market/nearby/full`。如果只是温度微调了 0.1 度，整个缓存也失效，触发完整重算 |

---

## 五、前端状态管理

### 5.1 当前架构

单个 React Context (`useDashboardStore`) 持有所有状态：
- `cityDetailsByName` — 每个城市 30-150KB 的完整分析结果
- `cities` — 城市列表
- `proAccess` — 订阅状态
- `loadingState` — 7 个加载标志

**问题：**

| # | 问题 | 严重度 |
|---|------|------|
| 11 | **sessionStorage 炸弹** — `cityDetailsByName` 整 Map 序列化到 sessionStorage（30min TTL）。如果缓存了 20 个城市的 detail，可能超过 **3-10 MB**。`JSON.stringify` / `JSON.parse` 在主线程上阻塞 | 🔴 |
| 12 | **单 Context 全量重渲染** — Context value 任何字段变化，所有消费者都重渲染。`cityDetailsByName` 每次 `mergeCityDetail` 都创建新对象引用，触发整个组件树更新 | 🔴 |
| 13 | **无选择器（selector）** — 组件不能只订阅 `cityDetailsByName["beijing"]`，必须接收整个 Context value 然后自己过滤 | 🟡 |
| 14 | **CityDetail 深度渐进合并可能丢字段** — `mergeCityDetail` 保留当前版本的 `multi_model` 和 `forecast`，但如果后端某次返回了空数组，旧值会被保留而不是更新 | 🟡 |

### 5.2 数据加载策略

**优点：**
- 请求去重（pending-Promise Map）
- 自动轮询（扫描终端每 10 分钟）
- Pro 状态 localStorage 缓存（避免每次刷新都等 API）

**问题：**

| # | 问题 |
|---|------|
| 15 | **扫描终端 10 分钟轮询 + 35s 超时** — 如果后端慢，轮询间隔小于响应时间，会堆积 pending 请求 |
| 16 | **每次选城市都独立请求 `getCityDetail`** — 即使扫描终端已经有了这个城市的完整数据（`ScanOpportunityRow` 包含 170+ 字段），Open detail panel 时还是要单独调 API |

---

## 六、数据流瓶颈总结

| 瓶颈 | 位置 | 影响 |
|------|------|------|
| sessionStorage 大对象序列化 | 前端 store | 主线程阻塞，Tab 切换卡顿 |
| 单 Context 全量重渲染 | 前端 store | 每次城市切换触发数百个组件更新 |
| 扫描终端 TTL 赶不上重算速度 | 后端缓存 | CPU 空转，缓存命中率低 |
| LGBM 循环喂入 DEB | 分析层 | 权重失真 |
| 无 ETag / 增量更新 | API 层 | 重复传输相同数据 |
| 静态校准系数 | 模型层 | 数据分布变化时概率偏差 |

---

## 七、建议优先级

### P0 — 立即修复

1. **sessionStorage 限制** — 只缓存最近 3 个城市的 detail，或改用 IndexedDB
2. **扫描终端 TTL** — 从 30s 提高到 120s，匹配实际重算耗时

### P1 — 短期

3. **Context 拆分** — 将 `cityDetailsByName` 移到独立的 Context，或用 `useSyncExternalStore` + 选择器
4. **ETag 支持** — API 返回 `ETag` header，客户端发 `If-None-Match`，匹配时返回 304
5. **LGBM 循环修复** — LGBM 预测值不再作为 DEB 输入，只作为独立参考展示

### P2 — 中期

6. **自动校准再训练** — 当最近 7 天 CRPS 漂移超过阈值时触发自动重新拟合
7. **客户端缓存库** — 引入 TanStack Query 或 SWR，替代手动的 sessionStorage + pending-Promise
8. **CityDetail 重用时复用扫描终端数据** — 扫描终端已拉取的数据不要再单独请求
