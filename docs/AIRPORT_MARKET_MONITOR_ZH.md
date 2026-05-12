# 机场高频数据接入市场监控频道方案

## 背景

### 现有数据

| 城市 | 机场 | ICAO | 数据源 | 刷新频率 | 缓存 TTL | 数据字段 |
|------|------|------|--------|---------|----------|---------|
| 首尔 | 仁川国际 | RKSI | AMOS (`global.amo.go.kr`) | 1 分钟 | 60s | 温度/露点/风速/气压/能见度/RVR/跑道对温度/METAR/TAF |
| 釜山 | 金海国际 | RKPK | AMOS (`global.amo.go.kr`) | 1 分钟 | 60s | 同上 |
| 东京 | 羽田 | RJTT | JMA AMeDAS (`jma.go.jp`) | 10 分钟 | 120s | 10 分钟温度观测（当前仅提取 temp） |

### 现有 Telegram 推送系统

- **循环**: `start_trade_alert_push_loop`，默认每 30 分钟跑一轮
- **覆盖城市**: `TELEGRAM_ALERT_CITIES`（默认全部 51 城）
- **4 条规则**: Ankara Center DEB 命中、动量突变(30min 斜率 > 0.8°C)、预报突破、暖平流
- **门禁**: 严重度/触发数/冷却期 多层过滤
- **消息**: 中英双语，包含触发类型、实况温度

### 问题

高频机场数据已就绪，但现有推送系统 30 分钟一轮对所有城市一视同仁。首尔/釜山 1 分钟级 AMOS 和东京 10 分钟级 JMA 接近交易高峰期时，温度变化可能比 30 分钟窗口更快，需要更灵敏的监控。

同时，DEB 每日最高温预测是结算的核心参照，将机场实时温度与 DEB 预测并排对比，可以快速发现实际温度偏离预测的程度。

---

## 方案设计

### 核心思路

**在现有 30 分钟主循环之上叠加高频通道**，对三大机场城市用更短间隔推送"实时温度 + DEB 预测最高温"快报。不做市场分析、不输出 AI 建议，只报温度数据本身。

### 1. 高频机场城市快速通道

在现有 30 分钟主循环之外，为 `{seoul, busan, tokyo}` 单独跑一个 10 分钟间隔的子循环，仅检查温度动量突变。

**配置（写死在代码中）**:
```python
HIGH_FREQ_AIRPORT_CITIES = {"seoul", "busan", "tokyo"}
HIGH_FREQ_PUSH_INTERVAL_SEC = 600        # 10 分钟
HIGH_FREQ_MOMENTUM_THRESHOLD_C = 0.5     # 比默认 0.8°C 更灵敏
HIGH_FREQ_COOLDOWN_SEC = 7200            # 同一城市冷却 2 小时
```

**逻辑**:
- 主循环 30 分钟照常跑全部城市（不变）
- 每 10 分钟额外跑一轮高频城市子集
- 高频轮次仅检查温度动量突变一条规则
- 高频告警独立冷却期 2 小时
- **最高温已锁定则跳过**：当日最高温已出现且之后持续下降，不再推送

### 2. 机场观测积累与趋势检测

**问题**: 当前 AMOS/JMA 每次只返回最新一条观测，无法计算温度斜率做动量检测。

**新增数据库表**: `airport_obs_log`
```sql
CREATE TABLE IF NOT EXISTS airport_obs_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    icao TEXT NOT NULL,
    city TEXT NOT NULL,
    temp_c REAL,
    wind_kt REAL,
    pressure_hpa REAL,
    obs_time TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_airport_obs_log_icao_time
    ON airport_obs_log(icao, created_at DESC);
```

**写入**: 在 AMOS/JMA 成功获取数据后自动调用 `append_airport_obs()` 写入。自动清理 2 小时前的旧数据。

**读取**: `get_airport_obs_recent(icao, minutes=30)` 返回最近 N 分钟观测列表，用于计算温度变化斜率。

### 3. 温度突变即时告警

基于积累的观测日志，新增告警规则 `airport_rapid_temp_change`。

| 参数 | 值 | 说明 |
|------|-----|------|
| 滑动窗口 | 20 分钟 | 取最近 20 分钟内的观测 |
| 最少样本 | 3 条 | 确保有足够数据点 |
| 触发阈值 | > 0.5°C/10min | 高频通道专用，比默认 0.8°C 更灵敏 |
| 锁定跳过 | 最高温已锁定 | 当日最高已过且持续下降，不推送 |

**告警消息示例**:
```
🚨 首尔/仁川 温度急变

跑道中位数 14.9°C → 16.5°C (+1.6°C / 15min)
风 220° 14kt 暖平流增强
DEB 预测今日最高 18.2°C  |  目前距预测差 1.7°C
```

### 4. 机场实况快照摘要（含 DEB 预测）

每隔 30 分钟，向市场监控频道推送三座机场的"当前温度 + DEB 预测最高温"摘要。

**推送时段**: 仅各城市当地 08:00-20:00（避免半夜噪音）

**锁定跳过**: 如该城市当日最高温已锁定，跳过该城市不推送（三城中仍有未锁定的则正常推送其余）

**消息格式**:
```
🛫 机场实况 14:30 CST

🇰🇷 首尔/仁川 RKSI
跑道中位数 14.9°C  ·  DEB 预测最高 18.2°C
风 220° 14kt  |  QNH 1015.2 hPa  |  能见度 ≥10km

🇰🇷 釜山/金海 RKPK
跑道中位数 13.8°C  ·  DEB 预测最高 16.5°C
风 180° 8kt

🇯🇵 东京/羽田 RJTT
当前 12.4°C (14:20 JST)  ·  DEB 预测最高 15.1°C
```

---

## 改动文件清单

| 优先级 | 文件 | 改动 |
|--------|------|------|
| 1 | `src/database/db_manager.py` | 新增 `airport_obs_log` 表、`append_airport_obs()`、`get_airport_obs_recent()` |
| 2 | `src/data_collection/amos_station_sources.py` | 成功获取后调用 `append_airport_obs()` 写日志 |
| 3 | `src/data_collection/jma_amedas_sources.py` | 成功获取后调用 `append_airport_obs()` 写日志，可选扩展提取更多字段（风速/气压） |
| 4 | `src/analysis/market_alert_engine.py` | 新增 `airport_rapid_temp_change` 规则 |
| 5 | `src/utils/telegram_push.py` | 高频快速通道子循环、机场快照推送（含 DEB 预测）、温度急变告警集成 |

---

## 实施顺序

1. **Phase 1 — DB 层**: `airport_obs_log` 表 + 读写方法
2. **Phase 2 — 采集层**: AMOS/JMA 成功后自动写日志，部署观察 1-2 天确认数据积累正常
3. **Phase 3 — 告警引擎**: `airport_rapid_temp_change` 规则 + 单元测试
4. **Phase 4 — 推送层**: 高频快速通道 + 机场快照 + DEB 预测，直接推送市场监控频道
5. **Phase 5 — 调参**: 观察 3-7 天调整阈值

---

## 风险与注意事项

- **AMOS/JMA 站点可用性**: `global.amo.go.kr` 和 `jma.go.jp` 可能偶发性不可用，需容错处理
- **告警频率控制**: 高频循环可能产生过多告警，需要严格的冷却期和去重机制
- **数据库体积**: `airport_obs_log` 每 1-10 分钟写入 3 条记录，2 小时约 36-360 条，自动清理后体积可控
- **东京 JMA 数据完整性**: 当前只提取 temp，风速/气压需要额外解析（JMA JSON 中有 `wind` 和 `pressure` 数组但未使用）
