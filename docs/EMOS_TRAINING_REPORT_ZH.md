# EMOS 训练报告（2026-03-20）

## 1. 报告目的

本文档用于记录当前 PolyWeather 概率校准引擎（EMOS）的训练结果、离线评估结果、线上 shadow 观测结果，以及是否具备切换为主路径的条件。

当前结论先写在前面：

- `EMOS` 已完成接入、训练、离线评估、shadow 落盘与滚动报表。
- 当前默认运行模式应继续保持 `emos_shadow`。
- 现阶段 **不建议切换到 `emos_primary`**。

## 2. 本次训练版本

- 校准版本：`emos-20260320130245`
- 训练时间：`2026-03-20T13:02:45.903772+00:00`
- 参数文件：[default.json](/E:/web/PolyWeather/artifacts/probability_calibration/default.json)
- 离线评估报告：[evaluation_report.json](/E:/web/PolyWeather/artifacts/probability_calibration/evaluation_report.json)
- 线上 shadow 报表：[shadow_report.json](/E:/web/PolyWeather/artifacts/probability_calibration/shadow_report.json)

## 3. 训练数据概况

### 3.1 数据来源

当前训练主要使用两类数据：

1. 项目历史日记录  
   文件：[daily_records.json](/E:/web/PolyWeather/data/daily_records.json)

2. 历史天气 CSV 构建出的结算标签  
   文件：[settlement_history.json](/E:/web/PolyWeather/artifacts/probability_calibration/settlement_history.json)

### 3.2 样本规模

- 总训练样本数：`105`
- 通过历史天气 CSV 补回的缺失 `actual_high`：`2`
- 历史结算标签覆盖城市数：`30`

说明：

- 当前样本已覆盖 30 个城市，但有效监督样本量仍偏小。
- 部分城市样本数只有 `2-7` 条，城市级参数容易波动。

## 4. 模型结构

### 4.1 当前实现

EMOS 属于统计后处理层，不是数值天气模型本身。当前结构位于：

- [probability_calibration.py](/E:/web/PolyWeather/src/analysis/probability_calibration.py)

当前目标是对原有概率引擎输出进行校准：

- 输入：`raw_mu`、`raw_sigma`、`DEB`、`ensemble median/spread`、`peak_status` 等特征
- 输出：校准后的 `mu / sigma / distribution`

### 4.2 当前运行模式

支持三种模式：

- `legacy`
- `emos_shadow`
- `emos_primary`

当前建议默认模式：

- `emos_shadow`

即：

- 对外仍展示 legacy 结果
- 后台并行计算 EMOS 结果
- 用于持续评估，不直接影响用户

## 5. 本次训练参数摘要

### 5.1 全局约束

本次训练已加入两类约束：

1. `sigma_constraints`
- `min_ratio = 0.85`
- `max_ratio = 1.35`
- `absolute_min = 0.25`
- `absolute_max = 3.0`

2. `selection_guardrails`
- `max_mae_increase = 0.02`
- `max_bucket_hit_drop = 0.01`
- `max_bucket_brier_increase = 0.05`

这两类约束的目的不是追求“更激进的拟合”，而是防止 EMOS 为了降低 CRPS 而把分布摊得过平，导致业务上更关键的顶桶命中和概率质量变差。

### 5.2 当前选中的 blending

本次训练产物中最终选择：

- `alpha_mu = 0.0`
- `alpha_sigma = 0.0`

含义是：

- 训练器在护栏约束下，没有找到足够安全的候选方案可以替代 legacy 主路径
- 因此当前正式选中的可用结果，本质上仍然锚定在 legacy

这是一种正确的保护行为，不是失败。说明门禁已经起作用，避免了坏校准进入主路径。

## 6. 离线评估结果

评估报告来源：

- [evaluation_report.json](/E:/web/PolyWeather/artifacts/probability_calibration/evaluation_report.json)

### 6.1 总体结果

Legacy：

- `mean_crps = 2.793938`
- `mean_mae = 2.721143`
- `bucket_hit_rate = 0.695238`

EMOS（强制 primary 评估）：

- `mean_crps = 2.650216`
- `mean_mae = 2.722829`
- `bucket_hit_rate = 0.666667`

Delta：

- `CRPS = -0.143722`
- `MAE = +0.001686`
- `bucket_hit_rate = -0.028571`

### 6.2 解读

这组结果说明：

1. `CRPS` 有改善  
   说明从“分布整体平滑度”角度看，EMOS 有一定价值。

2. `MAE` 基本持平但略差  
   不是大问题，但也不能算改善。

3. `bucket_hit_rate` 明显下降  
   这是当前最大阻塞项。对 PolyWeather 这种结算桶业务来说，顶桶命中率比单纯 CRPS 更关键。

因此，离线结论是：

- `EMOS` 有研究价值
- 但 **离线强切 primary 仍然不合格**

## 7. 线上 Shadow 观测结果

线上 shadow 报表来源：

- [shadow_report.json](/E:/web/PolyWeather/artifacts/probability_calibration/shadow_report.json)

### 7.1 总体结果

- `samples = 103`
- `legacy_mean_mae = 1.839223`
- `shadow_mean_mae = 1.851931`
- `delta_mae = +0.012708`

- `legacy_bucket_hit_rate = 0.669903`
- `shadow_bucket_hit_rate = 0.679612`
- `delta_bucket_hit_rate = +0.009709`

- `legacy_bucket_brier = 0.462814`
- `shadow_bucket_brier = 0.756649`
- `delta_bucket_brier = +0.293835`

### 7.2 解读

线上 shadow 结果和离线强制 primary 结果不完全相同，这是正常的。原因是：

- `shadow_report` 反映的是历史记录中实际落盘的 shadow 输出
- `evaluation_report` 反映的是离线脚本在强制 `emos_primary` 下重新计算的效果

当前线上 shadow 的含义是：

1. 顶桶命中率略有提升  
   `+0.97%`

2. 但 `MAE` 轻微变差  
   虽然幅度不大，但没有形成明确优势

3. `bucket_brier` 明显更差  
   说明 shadow 分布仍然偏“摊平”，概率质量不足

这是当前最重要的信号：

- EMOS 在“顶桶命中”上偶尔能赢
- 但在“概率质量”上还不够好

## 8. 城市级观察

从当前城市级结果看，EMOS 并不是“全城市统一改善”，而是明显分化：

### 8.1 相对改善较明显的城市

- `London`
- `Hong Kong`
- `Tokyo`
- `New York`

这些城市在部分指标上看到一定改善，说明当前校准特征在这些城市上更有效。

### 8.2 风险较高的城市

- `Atlanta`
- `Miami`
- `Chicago`
- `Dallas`
- `Seattle`

这些城市常见现象是：

- 顶桶命中没有显著提高
- 或 `bucket_brier` 明显恶化
- 或者 `MAE` 出现不必要抬升

这说明当前 EMOS 还没有形成稳定的全局校准能力，城市间异质性很强。

## 9. 当前判断

### 9.1 能不能上线为主路径

当前答案：

- **不能**

原因：

1. 离线强制 primary 时，`bucket_hit_rate` 下降
2. 线上 shadow 时，`bucket_brier` 明显变差
3. 样本量依然偏小，城市样本不均衡
4. 城市级表现分化明显

### 9.2 当前应该怎么运行

当前最合理的运行方式：

1. 保持 `emos_shadow`
2. 继续落盘 `shadow_prob_snapshot`
3. 继续维护滚动报表
4. 不修改机器人和网页的正式对外概率展示

## 10. 已完成的工程能力

目前已经具备以下能力：

1. 可离线训练  
   脚本：[fit_probability_calibration.py](/E:/web/PolyWeather/scripts/fit_probability_calibration.py)

2. 可离线评估  
   脚本：[evaluate_probability_calibration.py](/E:/web/PolyWeather/scripts/evaluate_probability_calibration.py)

3. 可导出训练样本  
   脚本：[export_probability_training_dataset.py](/E:/web/PolyWeather/scripts/export_probability_training_dataset.py)

4. 可历史回填 shadow 结果  
   脚本：[backfill_probability_shadow_history.py](/E:/web/PolyWeather/scripts/backfill_probability_shadow_history.py)

5. 可生成滚动 shadow 报表  
   脚本：[build_probability_shadow_report.py](/E:/web/PolyWeather/scripts/build_probability_shadow_report.py)

6. CI 已接入  
   包含 `ruff / pytest / frontend build / docker build workflow`

## 11. 下一步建议

### 11.1 必做

1. 扩大监督样本量  
   重点不是继续堆原始天气 CSV，而是补更多带 forecast snapshot 的历史样本。

2. 继续按版本沉淀训练报告  
   每次重训后都更新本报告或新增版本报告，避免只看单次结果。

3. 保持 `shadow` 连续观测  
   至少持续一段时间观察滚动指标是否稳定。

### 11.2 再做

1. 细分城市组建模  
   比如按气候区、结算规则、温度单位分组，而不是完全全局一套参数。

2. 优化训练目标  
   目前已经把 `bucket_brier` 纳入目标，但仍需进一步靠近 PolyWeather 的业务目标。

3. 补更严格的切换门槛  
   只有在同时满足以下条件时，才考虑切 `emos_primary`：
- `CRPS` 下降
- `MAE` 不上升
- `bucket_hit_rate` 不下降
- `bucket_brier` 不上升

## 12. 结论

当前 EMOS 状态可以概括为：

- 工程上：已经完整接入，具备训练、评估、shadow 观测能力
- 模型上：有一定价值，但还不稳定
- 产品上：适合继续做 shadow，不适合切主路径

最终结论：

- **继续使用 `emos_shadow`**
- **暂不切 `emos_primary`**
- **继续积累样本并按版本跟踪训练结果**
