# 机场高频数据接入市场监控频道方案

## 背景

### 现有数据

| 城市 | 机场 | ICAO/站点 | 数据源 | 刷新频率 | 缓存 TTL | 数据字段 |
|------|------|-----------|--------|---------|----------|---------|
| 首尔 | 仁川国际 | RKSI | AMOS (`global.amo.go.kr`) | 1 分钟 | 60s | 温度/露点/风速/气压/能见度/RVR/跑道对温度/METAR/TAF |
| 釜山 | 金海国际 | RKPK | AMOS (`global.amo.go.kr`) | 1 分钟 | 60s | 同上 |
| 东京 | 羽田 | RJTT | JMA AMeDAS (`jma.go.jp`) | 10 分钟 | 120s | 10 分钟温度观测 |
| 安卡拉 | Esenboğa | 17128 | MGM (`servis.mgm.gov.tr`) | ~10 分钟 | 无独立缓存 | 温度/风速/气压/湿度/降水 |

### 现有 Telegram 推送系统

- **循环**: `start_trade_alert_push_loop`，默认每 30 分钟跑一轮
- **覆盖城市**: `TELEGRAM_ALERT_CITIES`（默认全部 51 城）
- **4 条规则**: Ankara Center DEB 命中、动量突变(30min 斜率 > 0.8°C)、预报突破、暖平流
- **门禁**: 严重度/触发数/冷却期 多层过滤
- **消息**: 中英双语，包含触发类型、实况温度

### 问题

四座机场城市的实时数据已就绪，但现有推送系统 30 分钟一轮对所有城市一视同仁。1-10 分钟级高频数据在接近交易高峰期时，温度变化可能比 30 分钟窗口更快，需要更灵敏的监控。

---

## 方案设计

### 核心思路

在现有 30 分钟主循环之上叠加高频通道，对四座机场城市用 10 分钟间隔独立检测温度急变。温度波动达到阈值时推送告警，包含当前温度 + DEB 预测最高温。不做市场分析、不输出 AI 建议、不约定时快照。

### 1. 高频机场城市快速通道

在现有 30 分钟主循环之外，为 `{seoul, busan, tokyo, ankara}` 单独跑一个 10 分钟间隔的子循环，每个城市独立检测温度急变。

**配置（写死在代码中）**:
```python
HIGH_FREQ_AIRPORT_CITIES = {"seoul", "busan", "tokyo", "ankara"}
HIGH_FREQ_PUSH_INTERVAL_SEC = 600        # 10 分钟
HIGH_FREQ_MOMENTUM_THRESHOLD_C = 0.5     # 比默认 0.8°C 更灵敏
HIGH_FREQ_COOLDOWN_SEC = 7200            # 同一城市冷却 2 小时
```

**逻辑**:
- 主循环 30 分钟照常跑全部城市（不变）
- 每 10 分钟对四座机场城市各检查一次温度急变
- 高频轮次仅检查 `airport_rapid_temp_change` 一条规则
- 各城市独立冷却，触发后 2 小时内同一城市不再重复推送
- **最高温已锁定则跳过**：当日最高已过且持续下降，不再推送

### 2. 机场观测积累与趋势检测

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

**写入**: 在 AMOS/JMA/MGM 成功获取数据后自动调用 `append_airport_obs()` 写入。自动清理 2 小时前的旧数据。

**读取**: `get_airport_obs_recent(icao, minutes=30)` 返回最近 N 分钟观测列表，用于计算温度变化斜率。

### 3. 温度突变即时告警

基于积累的观测日志，新增告警规则 `airport_rapid_temp_change`。每条告警 per-city 独立推送。

| 参数 | 值 | 说明 |
|------|-----|------|
| 滑动窗口 | 20 分钟 | 取最近 20 分钟内的观测 |
| 最少样本 | 3 条 | 确保有足够数据点 |
| 触发阈值 | > 0.5°C/10min | 比默认 0.8°C/30min 更灵敏 |
| 冷却期 | 2 小时 | 同城市两次推送最小间隔 |
| 锁定跳过 | 最高温已锁定 | 当日最高已过且持续下降，不推送 |

**告警消息示例**:
```
🚨 首尔/仁川 温度急变 🔥

跑道温度 14.9°C → 16.5°C (+1.6°C / 15min)
风 14kt
DEB 预测今日最高 18.2°C  |  差距 +1.7°C
```

---

## 改动文件清单

| 优先级 | 文件 | 改动 |
|--------|------|------|
| 1 | `src/database/db_manager.py` | 新增 `airport_obs_log` 表、`append_airport_obs()`、`get_airport_obs_recent()` |
| 2 | `src/data_collection/weather_sources.py` | AMOS/JMA/MGM 成功后调用 `append_airport_obs()` 写日志 |
| 3 | `src/analysis/market_alert_engine.py` | 新增 `airport_rapid_temp_change` 规则 |
| 4 | `src/utils/telegram_push.py` | 10 分钟高频子循环、温度急变告警推送、最高温锁定跳过 |
| 5 | `src/bot/runtime_coordinator.py` | 注册机场高频推送循环 |

---

## 实施顺序

1. **Phase 1 — DB 层**: `airport_obs_log` 表 + 读写方法
2. **Phase 2 — 采集层**: AMOS/JMA/MGM 成功后自动写日志，部署观察 1-2 天确认数据积累正常
3. **Phase 3 — 告警引擎**: `airport_rapid_temp_change` 规则 + 单元测试
4. **Phase 4 — 推送层**: 高频快速通道，直接推送市场监控频道
5. **Phase 5 — 调参**: 观察 3-7 天调整阈值

---

## 风险与注意事项

- **AMOS/JMA/MGM 站点可用性**: 各数据源可能偶发性不可用，需容错处理
- **告警频率控制**: 高频循环可能产生过多告警，需要严格的冷却期和去重机制
- **数据库体积**: `airport_obs_log` 每 1-10 分钟写入 4 条记录，2 小时约 48-480 条，自动清理后体积可控
- **安卡拉 MGM 刷新频率**: `servis.mgm.gov.tr` 实际更新间隔待确认，暂按 ~10 分钟预估
