# EMOS + LGBM 系统说明（中文）

本文档用于完整说明 PolyWeather 当前的两条统计/机器学习链路：

- `EMOS`：概率后处理与校准链路
- `LGBM`：日最高温点预测辅助模型

重点不只是“模型怎么训练”，还包括：

- 这些模型依赖什么历史数据
- 真值和训练特征现在如何长期保存
- 为什么过去样本一直不够
- 当前线上到底运行在哪个模式
- 现在能做什么，不能做什么

本文档基于仓库当前实现与最近一轮重建结果，适合作为：

- 项目内部模型说明
- 运维与数据治理说明
- 未来继续扩展 EMOS/LGBM 的基线文档

---

## 1. 总览

PolyWeather 当前不是“用一个模型替代所有东西”，而是多层结构：

1. 多源天气采集层
2. `DEB` 业务主预测层
3. `LGBM` 轻量点预测辅助层
4. `EMOS` 概率校准层
5. 市场概率/桶命中评估层

可以简化理解为：

```text
天气源 / 观测 / 历史真值
        ↓
   DEB 主预测
        ↓
   LGBM 辅助点预测
        ↓
EMOS 对概率分布做后处理
        ↓
市场概率 / shadow / rollout 门禁
```

其中：

- `DEB` 仍然是当前业务主路径
- `LGBM` 是辅助预测源，不是主路径
- `EMOS` 是概率后处理，不是基础天气模型

---

## 2. 两条链路各自负责什么

### 2.1 EMOS 负责什么

`EMOS` 的全称通常指 Ensemble Model Output Statistics。

在本项目里，它的角色不是重新预测温度，而是：

- 把已有的预测结果做概率后处理
- 让输出分布更“可校准”
- 让桶概率和市场评估更稳定

EMOS 关注的是：

- `raw_mu`
- `raw_sigma`
- `deb_prediction`
- `ens_median`
- `ensemble_spread`
- `max_so_far_gap`
- `peak_flag`
- 最终真实 `actual_high`

它最终输出的是一套“经过校准的概率分布”，而不是单一温度值。

所以 EMOS 的核心衡量指标不是单纯 MAE，而更看重：

- `CRPS`
- `bucket_hit_rate`
- `bucket_brier`

### 2.2 LGBM 负责什么

`LGBM` 是一个轻量级的回归模型，用来预测：

- `actual_high`（日最高温）

它吃的是：

- 历史真值 lag 特征
- 多模型 forecast
- `deb_prediction`
- 当前观测特征
- 时间特征

它输出的是：

- 一个点预测 `actual_high`

然后这个点预测可以作为：

- 额外 forecast 源
- 供 DEB / 运营 / 研究参考

所以它和 EMOS 的区别非常重要：

- `LGBM`：做点预测
- `EMOS`：做概率校准

---

## 3. 当前代码结构

### 3.1 EMOS 相关

核心文件：

- [probability_calibration.py](/E:/web/PolyWeather/src/analysis/probability_calibration.py)
- [probability_rollout.py](/E:/web/PolyWeather/src/analysis/probability_rollout.py)
- [fit_probability_calibration.py](/E:/web/PolyWeather/scripts/fit_probability_calibration.py)
- [evaluate_probability_calibration.py](/E:/web/PolyWeather/scripts/evaluate_probability_calibration.py)
- [build_probability_shadow_report.py](/E:/web/PolyWeather/scripts/build_probability_shadow_report.py)
- [judge_probability_rollout.py](/E:/web/PolyWeather/scripts/judge_probability_rollout.py)

核心产物：

- [default.json](/E:/web/PolyWeather/artifacts/probability_calibration/default.json)
- [evaluation_report.json](/E:/web/PolyWeather/artifacts/probability_calibration/evaluation_report.json)
- [shadow_report.json](/E:/web/PolyWeather/artifacts/probability_calibration/shadow_report.json)
- [rollout_report.json](/E:/web/PolyWeather/artifacts/probability_calibration/rollout_report.json)
- [training_samples.json](/E:/web/PolyWeather/artifacts/probability_calibration/training_samples.json)

### 3.2 LGBM 相关

核心文件：

- [lgbm_daily_high.py](/E:/web/PolyWeather/src/models/lgbm_daily_high.py)
- [lgbm_features.py](/E:/web/PolyWeather/src/models/lgbm_features.py)
- [train_lgbm_daily_high.py](/E:/web/PolyWeather/scripts/train_lgbm_daily_high.py)
- [report_lgbm_daily_high.py](/E:/web/PolyWeather/scripts/report_lgbm_daily_high.py)

核心产物：

- [lgbm_daily_high.txt](/E:/web/PolyWeather/artifacts/models/lgbm_daily_high.txt)
- [lgbm_daily_high_schema.json](/E:/web/PolyWeather/artifacts/models/lgbm_daily_high_schema.json)

---

## 4. 为什么之前样本总是上不去

这件事是理解当前状态的关键。

过去项目里有一个结构性问题：

- `daily_records_store` 同时承担了
  - 运行态缓存
  - 历史训练数据来源

但运行态层会把 `daily_records` 硬裁成最近 14 天。

这意味着：

- 对线上运行来说没问题
- 对训练来说，历史监督样本会不断被删掉

结果就是：

- 城市越来越多
- 训练历史反而越来越稀
- `LGBM` 很容易只有二十几条样本
- `EMOS` 也只能靠有限 snapshot/daily_record 拼起来

这不是“模型太差”，而是“数据主存设计不对”。

---

## 5. 这次历史真值治理做了什么

现在已经把“运行态缓存”和“长期训练主存”拆开了。

### 5.1 `daily_records_store`

继续保留，但只作为：

- 最近 14 天运行态缓存

它不再承担长期训练历史职责。

### 5.2 `truth_records_store`

新增永久真值表，作为长期训练真值主存。

当前核心字段包括：

- `city`
- `target_date`
- `actual_high`
- `settlement_source`
- `settlement_station_code`
- `settlement_station_label`
- `truth_version`
- `updated_by`
- `updated_at`
- `source_payload_json`
- `is_final`

这张表的意义是：

- 长期保存监督真值
- 不再被 14 天缓存裁剪
- 真值来源变得可追溯

### 5.3 `truth_revisions_store`

新增真值修订审计表。

它记录：

- 老值是什么
- 新值是什么
- 来源怎么变了
- 谁改的
- 为什么改
- 什么时候改

所以现在回填不会再是“静默覆盖”。

### 5.4 `training_feature_records_store`

新增长期训练特征表。

它长期留存：

- forecasts
- deb_prediction
- mu
- probability_features
- prob_snapshot
- shadow_prob_snapshot
- calibration 摘要

它的作用是：

- 从现在开始，不再继续丢失历史训练特征
- 让未来 EMOS/LGBM 样本自然累积

---

## 6. 训练数据现在怎么来

### 6.1 EMOS 训练样本

EMOS 训练不只是需要真值，还要有“当时那一刻的预测快照”。

所以一条 EMOS 样本，本质上需要两部分：

1. 历史预测特征
2. 对应日期最终真值

当前导出的 EMOS 样本里，核心字段包括：

- `city`
- `date`
- `actual_high`
- `raw_mu`
- `raw_sigma`
- `deb_prediction`
- `ens_median`
- `ensemble_spread`
- `max_so_far_gap`
- `peak_flag`
- `sample_source`
- `settlement_source`
- `settlement_station_code`
- `truth_version`
- `truth_updated_by`
- `truth_updated_at`

也就是说，EMOS 训练样本现在已经带了真值 provenance。

### 6.2 LGBM 训练样本

LGBM 训练样本会优先从：

1. 永久真值表取监督目标
2. 长期训练特征表取历史特征
3. 再回退到必要的运行态/快照补充

当前 LGBM 样本会用到：

- 历史 `actual_high` lag
- 历史均值/趋势
- 多模型 forecast
- `deb_prediction`
- 当前观测
- 时间特征

---

## 7. Wunderground 历史回填为什么重要

这次治理里一个重点是：

- `Taipei`
- `Shenzhen`

这两个城市已经切到了市场指定的 `Wunderground` 结算口径。

之前的问题是：

- 城市注册表已经写成 `wunderground`
- 但历史回填链路还没有真正支持按指定历史日期抓 WU 历史页

所以过去它们的 `actual_high` 可能：

- 没有被正确回填
- 或者被错误来源污染

现在已经补了正式历史回填函数：

- [wunderground_sources.py](/E:/web/PolyWeather/src/data_collection/wunderground_sources.py)

它会：

1. 按 `city + target_date` 拼出对应历史页
2. 解析该日观测序列
3. 取当日最高温
4. 按市场规则做整度结算
5. 写入永久真值表
6. 记录来源与审计信息

这一步对 `Taipei/Shenzhen` 尤其关键，因为它们不是 NOAA/HKO 口径。

---

## 8. 当前线上/离线运行模式

### 8.1 概率引擎模式

当前项目仍然应该保持：

- `emos_shadow`

而不是：

- `emos_primary`

原因不是工程没接好，而是门禁还没过。

### 8.2 LGBM 角色

当前 `LGBM` 仍然只能算：

- 辅助预测源
- 研究/观测链路

不适合替代 `DEB` 主路径。

---

## 9. 当前最新状态

以下状态来自最近一轮恢复、回填和重训产物。

### 9.1 永久真值

当前永久真值表已恢复到长期历史：

- `truth_records_store`
  - 最早：`2023-01-01`
  - 最晚：`2026-04-02`
  - 行数：约 `35138`
  - 城市数：`30`

运行态缓存仍然只有近 14 天：

- `daily_records_store`
  - 仍然是近两周范围

这说明：

- 长期真值主存已经从运行态缓存里分离出来了

### 9.2 真值修订

当前已有 revision 审计记录：

- `truth_revisions_store`
  - 行数：`2`

这说明审计链路已经在工作。

### 9.3 Wunderground 回填

`Taipei` 与 `Shenzhen` 已按 WU 历史页完成回填。

当前这两城已经补到：

- `2026-04-02`

### 9.4 长期训练特征

当前 `training_feature_records_store` 已经接通，但历史上真正留存下来的特征仍然很少。

这意味着：

- 从现在开始不会继续丢
- 但过去没留下的那部分特征，不会凭空恢复

这也是为什么：

- 真值恢复了
- `EMOS` 样本量却没有同步大幅增长

---

## 10. 当前 EMOS 结果怎么理解

最近一轮离线评估大致是：

- `sample_count = 54`
- `delta_crps ≈ -0.0867`
- `delta_mae = 0`
- `delta_bucket_hit_rate = 0`

这说明：

- 从 `CRPS` 看，EMOS 有改善
- 但从 `MAE` 和 `top bucket hit` 看，没有明显进步

shadow 报告里更关键的问题是：

- `shadow sample_count = 48`
- `delta_bucket_brier` 仍然明显偏坏

所以 rollout 结论仍然是：

- `hold`

这不是“EMOS 无效”，而是：

- 它还没有稳定到能切主路径

### 10.1 当前阻塞点

主要阻塞仍然是：

- 样本数不够
- shadow bucket brier 退化

也就是说，当前 EMOS 状态可以总结成：

- 工程链路完整
- 数据治理大幅改善
- 发布门禁仍未通过

---

## 11. 当前 LGBM 结果怎么理解

最近一轮 LGBM 训练后，样本数已经从以前更少的状态提升到：

- `sample_count = 54`
- `train_count = 42`
- `validation_count = 12`

验证集指标大致为：

- `lgbm_mae = 1.349`
- `deb_mae = 0.875`

这说明：

- LGBM 比以前样本更充足了
- 但在验证集上仍然不如 DEB

所以当前它的定位仍然应该是：

- 辅助参考
- 不替代 DEB

---

## 12. 为什么现在 EMOS 没有像 LGBM 那样明显涨样本

这点很容易误解。

答案不是“恢复失败”，而是两条链路对数据要求不一样。

### 12.1 LGBM

LGBM 更依赖：

- 长期真值
- 基础 forecast 特征

这部分通过：

- `truth_records_store`
- `training_feature_records_store`

已经改善很多。

### 12.2 EMOS

EMOS 更依赖：

- 某一时刻的概率快照/分布特征

如果过去那些 snapshot 没有长期保存下来，那么即使今天把真值补齐了：

- 也无法凭空重建完整 EMOS 样本

所以当前现实是：

- 真值问题已经大幅改善
- 未来特征不会再继续丢
- 但过去缺失的 EMOS 快照历史仍然限制样本增长

---

## 13. 当前最重要的工程判断

### 13.1 已经完成的

这些现在可以认为已经完成：

- 真值主存从运行态缓存里拆出
- 真值 provenance 落库
- revision 审计表落地
- Wunderground 历史回填接通
- `Taipei/Shenzhen` 真值口径修正
- 长期训练特征表接通
- `/ops` 已能可视化 truth / feature / EMOS / LGBM 覆盖情况

### 13.2 还没完成的

这些仍然是后续重点：

- EMOS 样本继续自然积累
- shadow bucket brier 稳定下来
- LGBM 验证效果超过 DEB
- 让更多城市开始持续积累训练特征

---

## 14. 运维怎么看当前状态

现在最直接的入口是：

- `/ops`

这页已经能看到：

- 历史真值主表统计
- 真值来源分布
- 真值修订数量
- 长期训练特征统计
- `Taipei/Shenzhen` 的 WU 回填状态
- 城市覆盖缺口
- 模型城市覆盖
- 城市覆盖矩阵

因此，运维现在可以快速回答：

- 哪些城市真值已经长期化
- 哪些城市还没有特征积累
- 哪些城市已经能支撑 EMOS/LGBM
- 哪些城市目前仍然只能主要依赖 DEB

---

## 15. 推荐工作流

### 15.1 日常

1. 查看 `/ops`
2. 看 `truth / feature / EMOS / LGBM` 覆盖有没有继续增长
3. 看 `Taipei/Shenzhen` 的 WU 行数是否继续更新
4. 看 rollout 仍然是 `hold` 还是有改善

### 15.2 周期性重训

建议周期性执行：

```bash
./venv/Scripts/python.exe scripts/export_probability_training_dataset.py
./venv/Scripts/python.exe scripts/fit_probability_calibration.py
./venv/Scripts/python.exe scripts/evaluate_probability_calibration.py
./venv/Scripts/python.exe scripts/build_probability_shadow_report.py
./venv/Scripts/python.exe scripts/judge_probability_rollout.py
./venv/Scripts/python.exe scripts/train_lgbm_daily_high.py
```

### 15.3 真值恢复/补数

当有新的历史真值补数或回填需要时：

```bash
./venv/Scripts/python.exe scripts/restore_training_truth_history.py
./venv/Scripts/python.exe scripts/restore_training_feature_history.py
./venv/Scripts/python.exe scripts/backfill_recent_daily_actuals_from_metar.py --cities taipei shenzhen --lookback-days 14
```

说明：

- 脚本名里虽然还保留 `from_metar`
- 但当前实现已经会按 `settlement_source` 自动分发
- `wunderground` 会走 WU 历史回填分支

---

## 16. 当前最务实的结论

如果只用一句话概括当前状态：

**EMOS 和 LGBM 的工程基础已经补齐，但数据积累还在恢复期；当前最正确的策略仍然是继续以 `DEB` 为主路径，让长期真值和训练特征继续沉淀，再观察 EMOS/LGBM 是否自然变强。**

更具体一点：

- `EMOS`
  - 已接好
  - 可训练
  - 可评估
  - 可 shadow
  - 但暂时不能切主路径

- `LGBM`
  - 已接好
  - 样本比以前更多
  - 但验证集还不如 DEB
  - 目前只能做辅助参考

- 数据层
  - 这次治理的真正价值，是防止未来继续丢历史
  - 这对两条模型链路都比继续“微调参数”更关键

---

## 17. 相关文档

若需要看更细分的历史说明，可继续参考：

- [EMOS_TRAINING_REPORT_ZH.md](/E:/web/PolyWeather/docs/EMOS_TRAINING_REPORT_ZH.md)
- [LGBM_DAILY_HIGH_ZH.md](/E:/web/PolyWeather/docs/LGBM_DAILY_HIGH_ZH.md)
- [PROBABILITY_SNAPSHOT_ARCHIVE_ZH.md](/E:/web/PolyWeather/docs/PROBABILITY_SNAPSHOT_ARCHIVE_ZH.md)
- [deep-research-report.md](/E:/web/PolyWeather/docs/deep-research-report.md)

