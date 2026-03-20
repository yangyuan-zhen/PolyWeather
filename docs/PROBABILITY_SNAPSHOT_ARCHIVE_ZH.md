# 概率训练样本归档说明（中文）

## 1. 目的

这份文档说明两件事：

1. 为什么 `EMOS` 训练不能只依赖历史实测天气
2. 未来如何持续沉淀“历史预测记录”，让概率引擎越训越稳

一句话结论：

- 历史实测天气只能补 `actual_high`
- 真正决定 `EMOS` 训练质量的是“当时那一刻的预测快照”

## 2. 什么是“历史预测记录”

对 PolyWeather 来说，一条可训练的历史预测记录，至少应该包含这些字段：

- `city`
- `timestamp`
- `date`
- `raw_mu`
- `raw_sigma`
- `deb_prediction`
- `ensemble p10 / p50 / p90`
- `multi-model forecasts`
- `max_so_far`
- `peak_status`
- `prob_snapshot`
- 当天最终 `actual_high`
- 当天最终 `settlement bucket`

这类记录的核心价值是：

- 还原“当时系统实际看到什么”
- 再对照“后来真实发生了什么”

只有这两者成对，`EMOS` 才能学习偏差。

## 3. 为什么不能只用历史天气实测

历史天气 CSV 只能告诉你：

- 当天最高温是多少
- 某小时温度是多少

但它不能告诉你：

- 当天早上 09:00 时，系统的 `mu` 是多少
- 当时的 `ensemble spread` 是多少
- 当时 `DEB` 怎么看
- 当时的 top bucket 是什么

所以：

- 历史实测天气是标签
- 历史预测记录才是训练输入

缺少后者，EMOS 只能学到很有限的东西。

## 4. 当前项目里已经有的基础

### 4.1 已有历史日记录

文件：

- [daily_records.json](/E:/web/PolyWeather/data/daily_records.json)

当前已经保存了一部分训练相关字段，例如：

- `forecasts`
- `actual_high`
- `deb_prediction`
- `mu`
- `prob_snapshot`
- `shadow_prob_snapshot`
- `probability_calibration`
- `probability_features`

这已经是“历史预测记录”的雏形。

### 4.2 已有历史天气 CSV

目录：

- [data/historical](/E:/web/PolyWeather/data/historical)

它们可以帮助补：

- `actual_high`
- `settlement history`

但不能替代预测快照归档。

## 5. 未来应该怎么存历史预测记录

推荐做法是：

### 5.1 固定时点归档

每天为每个重点城市固定存几次快照，例如：

- 当地 `09:00`
- 当地 `12:00`
- 当地 `15:00`

这样能确保每个交易日都有稳定可比样本。

### 5.2 关键变化时补充归档

除了固定时点，还应该在以下情况额外存一次：

- `max_so_far` 创新高
- `mu` 变化超过阈值
- `top bucket` 发生变化
- `shadow top bucket` 发生变化

这样能捕捉真正有训练价值的转折点。

### 5.3 建议的存储格式

建议新增一个文件，例如：

- `data/probability_training_snapshots.jsonl`

每一行保存一条 JSON 记录。

优点：

- 追加写入简单
- 后续导出训练集方便
- 不容易因为单个大 JSON 文件损坏而全盘受影响

## 6. 一条建议的快照结构

示例：

```json
{
  "city": "ankara",
  "timestamp": "2026-03-20T12:00:00+03:00",
  "date": "2026-03-20",
  "raw_mu": 15.2,
  "raw_sigma": 1.2,
  "deb_prediction": 15.4,
  "ensemble": {
    "p10": 14.8,
    "median": 15.8,
    "p90": 17.9
  },
  "multi_model": {
    "ECMWF": 15.8,
    "GFS": 14.1,
    "ICON": 15.9,
    "GEM": 16.5,
    "JMA": 14.5
  },
  "max_so_far": 15.0,
  "peak_status": "before",
  "prob_snapshot": [
    {"v": 15, "p": 0.552},
    {"v": 16, "p": 0.377}
  ],
  "shadow_prob_snapshot": [
    {"v": 15, "p": 0.324},
    {"v": 16, "p": 0.238}
  ],
  "probability_engine": "legacy",
  "probability_mode": "emos_shadow",
  "calibration_version": "emos-20260320130245"
}
```

当天结束后，再由后处理脚本回填：

- `actual_high`
- `settlement_bucket`

## 7. 现阶段你可以执行的命令

### 7.1 回填历史天气 CSV

```bash
python scripts/backfill_historical_weather.py
```

作用：

- 补全 30 城市历史天气时序 CSV

### 7.2 从历史 CSV 构建日级结算标签

```bash
python scripts/build_settlement_history_from_csv.py
```

作用：

- 生成 [settlement_history.json](/E:/web/PolyWeather/artifacts/probability_calibration/settlement_history.json)

### 7.3 导出当前训练样本

```bash
python scripts/export_probability_training_dataset.py
```

作用：

- 生成 [training_samples.json](/E:/web/PolyWeather/artifacts/probability_calibration/training_samples.json)

### 7.4 重训 EMOS

```bash
python scripts/fit_probability_calibration.py
```

作用：

- 生成新的 [default.json](/E:/web/PolyWeather/artifacts/probability_calibration/default.json)

### 7.5 离线评估训练效果

```bash
python scripts/evaluate_probability_calibration.py
```

作用：

- 生成 [evaluation_report.json](/E:/web/PolyWeather/artifacts/probability_calibration/evaluation_report.json)

### 7.6 回填 shadow 结果到历史记录

```bash
python scripts/backfill_probability_shadow_history.py
```

作用：

- 把 `shadow_prob_snapshot` 和 `probability_calibration` 回填到 [daily_records.json](/E:/web/PolyWeather/data/daily_records.json)

### 7.7 生成线上 shadow 滚动报表

```bash
python scripts/build_probability_shadow_report.py
```

作用：

- 生成 [shadow_report.json](/E:/web/PolyWeather/artifacts/probability_calibration/shadow_report.json)

## 8. 推荐的一整套重训流程

如果过了十天、半个月，想重新训练一次，建议按这个顺序执行：

```bash
python scripts/build_settlement_history_from_csv.py
python scripts/export_probability_training_dataset.py
python scripts/fit_probability_calibration.py
python scripts/evaluate_probability_calibration.py
python scripts/backfill_probability_shadow_history.py
python scripts/build_probability_shadow_report.py
```

如果历史天气 CSV 还没补全，再先执行：

```bash
python scripts/backfill_historical_weather.py
```

## 9. 怎么判断这次训练有没有进步

重训后，不要只看一个指标。

至少看这 4 个：

1. `CRPS`
- 越低越好

2. `MAE`
- 越低越好
- 至少不要明显变差

3. `Bucket Hit Rate`
- 越高越好
- 这是业务上非常关键的指标

4. `Bucket Brier`
- 越低越好
- 反映概率分布质量

只有同时满足下面条件，才可以说训练效果真的进步：

- `CRPS` 下降
- `MAE` 不上升
- `Bucket Hit Rate` 不下降
- `Bucket Brier` 不上升

## 10. 当前最重要的现实判断

过去的“完整历史预测记录”通常没法完全补出来，除非：

1. 你之前就存过
2. 你接入了支持 forecast archive 的商业数据源

所以现实里最重要的不是“把过去全补齐”，而是：

- 从现在开始系统化归档
- 每天稳定沉淀可训练样本
- 定期离线重训

## 11. 推荐的下一步

最值得做的改造是：

1. 新增 `probability_training_snapshots.jsonl`
2. 每次分析时自动追加一条快照
3. 当天结束后自动回填 `actual_high`
4. 每 1-2 周重新训练一次

## 12. 总结

如果只记住一句话，就记这个：

**EMOS 要想越训越好，关键不是多下载一点历史天气，而是持续保存“当时系统看到的预测快照”。**
