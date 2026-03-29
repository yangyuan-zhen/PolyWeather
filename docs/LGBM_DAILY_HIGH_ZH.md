# LightGBM 日最高温模型（中文）

## 1. 目标

这套 `LightGBM` 模型是给 PolyWeather 增加一个轻量级的统计学习预测源。

它的定位不是替代：

- `DEB`
- `EMOS`
- `ECMWF / GFS / GEM / JMA / ICON / Open-Meteo / MGM / NWS`

而是作为一个新的点预测源：

`现有模型 + 观测特征 -> LGBM -> 并入 current_forecasts -> DEB -> EMOS`

第一版只做：

- `D0` 当日最高温预测

不做：

- `D1-D3`
- 小时级曲线
- 概率分布
- 独立结算源

## 2. 适用场景

这条链路是为低资源 VPS 准备的。

当前项目线上环境只有 `2GB RAM` 时，不适合引入 `TimesFM` 这类大模型，但适合用 `LightGBM` 做轻量推理。

当前方案是：

1. 训练离线完成
2. 训练产物直接提交到仓库
3. VPS 线上只加载模型文件并推理
4. VPS 不训练，不起额外服务

## 3. 文件结构

核心文件如下：

- 运行时推理：
  - [src/models/lgbm_daily_high.py](/E:/web/PolyWeather/src/models/lgbm_daily_high.py)
- 特征构建：
  - [src/models/lgbm_features.py](/E:/web/PolyWeather/src/models/lgbm_features.py)
- 训练脚本：
  - [scripts/train_lgbm_daily_high.py](/E:/web/PolyWeather/scripts/train_lgbm_daily_high.py)
- 训练报告脚本：
  - [scripts/report_lgbm_daily_high.py](/E:/web/PolyWeather/scripts/report_lgbm_daily_high.py)
- 模型文件：
  - [artifacts/models/lgbm_daily_high.txt](/E:/web/PolyWeather/artifacts/models/lgbm_daily_high.txt)
- 模型 schema / 指标：
  - [artifacts/models/lgbm_daily_high_schema.json](/E:/web/PolyWeather/artifacts/models/lgbm_daily_high_schema.json)

接入链路位置：

- Web API 聚合：
  - [web/analysis_service.py](/E:/web/PolyWeather/web/analysis_service.py)
- 共享趋势引擎：
  - [src/analysis/trend_engine.py](/E:/web/PolyWeather/src/analysis/trend_engine.py)

## 4. 特征说明

第一版特征固定为以下几组。

### 4.1 历史日高温特征

- `actual_high_lag_1`
- `actual_high_lag_2`
- `actual_high_lag_3`
- `actual_high_lag_7`
- `actual_high_mean_7`
- `actual_high_mean_14`
- `actual_high_trend_3`

### 4.2 当天模型特征

- `Open-Meteo`
- `ECMWF`
- `GFS`
- `GEM`
- `JMA`
- `ICON`
- `MGM`
- `NWS`
- `deb_prediction`
- `model_median`
- `model_spread`

### 4.3 当前观测特征

- `current_temp`
- `max_so_far`
- `humidity`
- `wind_speed_kt`
- `visibility_mi`

### 4.4 时间与状态特征

- `local_hour`
- `month`
- `weekday`
- `peak_status_code`

其中：

- `before = 0`
- `in_window = 1`
- `past = 2`

## 5. 训练数据来源

训练数据主要来自两份运行时历史文件：

- [data/daily_records.json](/E:/web/PolyWeather/data/daily_records.json)
- [data/probability_training_snapshots.jsonl](/E:/web/PolyWeather/data/probability_training_snapshots.jsonl)

作用分工：

- `daily_records.json`
  - 提供 `actual_high`
  - 提供当天各模型 forecast
  - 提供历史 `deb_prediction`

- `probability_training_snapshots.jsonl`
  - 提供 `max_so_far`
  - 提供 `peak_status`
  - 提供观测特征快照

为后续重训，概率快照归档现在还会额外写入：

- `current_temp`
- `humidity`
- `wind_speed_kt`
- `visibility_mi`
- `local_hour`

对应代码：

- [src/analysis/probability_snapshot_archive.py](/E:/web/PolyWeather/src/analysis/probability_snapshot_archive.py)

## 6. 训练流程

训练脚本：

```bash
./venv/Scripts/python.exe scripts/train_lgbm_daily_high.py
```

训练流程如下：

1. 从历史文件构造监督样本
2. 目标值固定为 `actual_high`
3. 按日期做简单的时间顺序切分
4. 最后约 20% 做验证集
5. 先训练并评估验证集
6. 再用全量样本训练最终模型
7. 输出模型文件和 schema 文件

输出产物：

- [artifacts/models/lgbm_daily_high.txt](/E:/web/PolyWeather/artifacts/models/lgbm_daily_high.txt)
- [artifacts/models/lgbm_daily_high_schema.json](/E:/web/PolyWeather/artifacts/models/lgbm_daily_high_schema.json)

## 7. 如何看训练结果

查看训练报告：

```bash
./venv/Scripts/python.exe scripts/report_lgbm_daily_high.py
```

这个脚本会读取 schema，并打印：

- `Sample Count`
- `Train Count`
- `Valid Count`
- `LGBM MAE`
- `DEB MAE`
- `Best Single MAE`
- `Median MAE`
- `Winner`

当前这版训练结果是：

- `sample_count = 29`
- `validation_count = 12`
- `validation.lgbm_mae = 2.975`
- `validation.deb_mae = 2.267`
- `validation.best_single_mae = 1.167`

这说明：

- 当前 `LGBM` 链路已经可用
- 但现阶段验证集表现还没有超过 `DEB`
- 所以默认配置仍建议保持关闭

## 8. 线上运行逻辑

运行时推理逻辑不是“直接替代 DEB”，而是：

1. 先收集现有模型 forecast
2. 先算一版基线 `DEB`
3. 把这版 `DEB` 当作 `LGBM` 的一个输入特征
4. 输出 `LGBM` 点预测
5. 把 `LGBM` 注入 `current_forecasts`
6. 重新计算最终 `DEB`

这样做的原因是：

- `LGBM` 需要吃到 `deb_prediction` 特征
- 但最终 `DEB` 又要把 `LGBM` 当成一个新的输入模型

## 9. 环境变量

示例配置见：

- [.env.example](/E:/web/PolyWeather/.env.example)

相关变量：

```env
POLYWEATHER_LGBM_ENABLED=false
POLYWEATHER_LGBM_MODEL_PATH=/app/artifacts/models/lgbm_daily_high.txt
POLYWEATHER_LGBM_SCHEMA_PATH=/app/artifacts/models/lgbm_daily_high_schema.json
POLYWEATHER_LGBM_MIN_HISTORY_POINTS=3
```

说明：

- `POLYWEATHER_LGBM_ENABLED`
  - 是否启用运行时推理
- `POLYWEATHER_LGBM_MODEL_PATH`
  - 模型文件路径
- `POLYWEATHER_LGBM_SCHEMA_PATH`
  - schema 文件路径
- `POLYWEATHER_LGBM_MIN_HISTORY_POINTS`
  - 某城市最低历史样本门槛

默认是 `3`，原因不是最理想，而是当前整体样本仍然偏少。

如果门槛设太高，很多城市现在根本不会触发 `LGBM`。

## 10. VPS 部署建议

如果你的 VPS 只有 `2GB RAM`：

- 可以跑这套 `LightGBM`
- 不要在 VPS 上训练
- 不要起额外模型服务

推荐方式：

1. 在本地或开发环境训练
2. 提交模型产物
3. VPS 拉代码
4. 开启 `POLYWEATHER_LGBM_ENABLED=true`
5. 重启主服务

不推荐：

- 在 VPS 上跑训练脚本
- 把 `LightGBM` 当成长任务服务单独部署
- 同时引入大模型推理

## 11. 当前结论

这条链路已经完成了：

- 离线训练
- 模型产物固化
- 运行时懒加载
- Web / 共享分析链路注入
- 前端模型类型兼容

但当前样本量仍偏少，所以建议运营策略是：

1. 先继续积累历史 `actual_high`
2. 继续积累概率快照观测字段
3. 定期重训
4. 只有当验证集 `MAE` 持续接近或优于 `DEB` 时，再考虑默认线上开启

## 12. 常用命令

### 训练

```bash
./venv/Scripts/python.exe scripts/train_lgbm_daily_high.py
```

### 查看训练报告

```bash
./venv/Scripts/python.exe scripts/report_lgbm_daily_high.py
```

### 本地测试

```bash
./venv/Scripts/python.exe -m pytest tests/test_lgbm_features.py tests/test_lgbm_daily_high.py
```

### 编译检查

```bash
./venv/Scripts/python.exe -m compileall src web scripts tests
```
