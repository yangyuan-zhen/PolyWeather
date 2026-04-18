# EMOS 训练报告（2026-04-19）

## 1. 当前结论

- `EMOS` 已切为默认主概率路径：`emos_primary`。
- 本次切换只影响概率分布校准层，不改变 `DEB`、多模型预报、METAR 结算口径、订阅权限或缓存路由。
- 线上回滚开关保留：`POLYWEATHER_PROBABILITY_ENGINE=emos_shadow` 或 `legacy`。
- `LGBM` 本轮重新训练后仍不建议上线，继续保持 `POLYWEATHER_LGBM_ENABLED=false`。

## 2. 本次 EMOS 版本

- 校准版本：`emos-20260418192717`
- 训练时间：`2026-04-18T19:27:17Z`
- 样本数：`74`
- 参数文件：[default.json](/E:/web/PolyWeather/artifacts/probability_calibration/default.json)
- 离线评估报告：[evaluation_report.json](/E:/web/PolyWeather/artifacts/probability_calibration/evaluation_report.json)

## 3. 离线评估摘要

本次评估对比 legacy 概率和强制 EMOS primary 概率：

| 指标 | Legacy | EMOS | 变化 |
| :-- | --: | --: | --: |
| CRPS | `3.474108` | `3.331240` | `-0.142868` |
| MAE | `3.679324` | `3.622584` | `-0.056741` |
| Bucket hit rate | `0.500000` | `0.500000` | `0.000000` |

解读：

- `CRPS` 改善，说明整体概率分布质量更好。
- `MAE` 小幅改善，不再出现上一版“误差持平或略差”的问题。
- `bucket_hit_rate` 持平，没有牺牲结算桶命中率。

因此本轮可以先把 EMOS 作为主概率路径上线，但仍需要线上持续观察。

## 4. LGBM 本轮结果

本轮 LGBM 训练完成，但验证集表现不足：

| 指标 | Validation |
| :-- | --: |
| LGBM MAE | `5.867` |
| DEB MAE | `1.825` |
| Best-single MAE | `0.567` |
| Median MAE | `1.700` |

结论：

- LGBM 当前样本量和泛化质量不足。
- 不能替代“校准模型概率”板块。
- 线上继续关闭：`POLYWEATHER_LGBM_ENABLED=false`。
- 可以保留模型文件用于离线跟踪，不进入前端主路径。

## 5. 上线方式

默认代码路径已改为：

```text
POLYWEATHER_PROBABILITY_ENGINE=emos_primary
```

未设置环境变量时，系统默认走 `emos_primary`。

显式回滚方式：

```text
POLYWEATHER_PROBABILITY_ENGINE=emos_shadow
```

或：

```text
POLYWEATHER_PROBABILITY_ENGINE=legacy
```

`.env.example` 已同步暴露该配置项。

## 6. 前端表现

今日日内分析中的“校准模型概率”会优先展示 EMOS 校准后的温度桶分布。

用户看到的含义应该是：

- 这是经过历史误差校准后的概率分布；
- 不是简单模型投票；
- 不直接等于最终结算概率；
- 仍应结合 METAR 实测、峰值窗口、失效条件和模型层分歧。

## 7. 监控要求

上线后持续关注：

- `CRPS`
- `MAE`
- `bucket_hit_rate`
- 城市级样本分布
- 概率是否过度摊平
- 高温/低温尾部桶是否系统性低估

如果连续回归显示 EMOS 退化，应先切回 `emos_shadow`，保留 shadow 观测，再决定是否回退到 `legacy`。

## 8. 自动重训

已新增自动重训编排脚本：

```text
python scripts\auto_retrain_probability_calibration.py
```

默认行为：

- 生成一个新的 EMOS candidate。
- 对 candidate 跑离线评估。
- 写入候选目录和门禁报告。
- 不覆盖线上 [default.json](/E:/web/PolyWeather/artifacts/probability_calibration/default.json)。

候选产物默认写入：

```text
/var/lib/polyweather/probability_calibration/candidates/<version>/
```

最新自动训练报告默认写入：

```text
/var/lib/polyweather/probability_calibration/auto_retrain_report.json
```

允许门禁通过后自动发布：

```text
python scripts\auto_retrain_probability_calibration.py --promote-if-passed --run-tests
```

门禁默认阈值：

- `POLYWEATHER_EMOS_AUTO_MIN_SAMPLES=50`
- `POLYWEATHER_EMOS_AUTO_MAX_DELTA_CRPS=0`
- `POLYWEATHER_EMOS_AUTO_MAX_DELTA_MAE=0.05`
- `POLYWEATHER_EMOS_AUTO_MIN_DELTA_BUCKET_HIT_RATE=-0.05`

说明：

- `CRPS` 不允许比 legacy 更差。
- `MAE` 最多允许轻微退化 `0.05`。
- `bucket_hit_rate` 只做软门槛，因为它对结算边界过于敏感。
- 如果发布，会先备份旧版 `default.json`。

Docker 手动触发：

```text
docker compose exec -T polyweather_web python scripts/auto_retrain_probability_calibration.py --verbose
```

查看最新报告：

```text
docker compose exec -T polyweather_web cat /var/lib/polyweather/probability_calibration/auto_retrain_report.json
```

Docker 允许门禁发布：

```text
docker compose exec -T polyweather_web python scripts/auto_retrain_probability_calibration.py --verbose --promote-if-passed --run-tests
```

如果线上 SQLite 的 `probability_training_snapshots_store` 已经很大，可以先限制最近 N 条快照：

```text
docker compose exec -T polyweather_web python scripts/auto_retrain_probability_calibration.py --verbose --snapshot-limit 20000
```

也可以放到 `.env`：

```text
POLYWEATHER_EMOS_TRAINING_SNAPSHOT_LIMIT=20000
```

如果希望自动发布不需要重建镜像，需要在 `.env` 中指定可写参数文件：

```text
POLYWEATHER_PROBABILITY_CALIBRATION_FILE=/var/lib/polyweather/probability_calibration/default.json
```

首次启用该路径前，先用当前镜像内置参数初始化一次：

```text
docker compose exec -T polyweather_web mkdir -p /var/lib/polyweather/probability_calibration
docker compose exec -T polyweather_web cp /app/artifacts/probability_calibration/default.json /var/lib/polyweather/probability_calibration/default.json
```

建议后续挂到宿主机 `cron` 或 systemd timer：

```text
0 3 * * * cd /root/PolyWeather && docker compose exec -T polyweather_web python scripts/auto_retrain_probability_calibration.py --promote-if-passed --run-tests
```

## 9. 已验证

本次上线前已执行：

```text
python scripts\fit_probability_calibration.py
python scripts\evaluate_probability_calibration.py
python scripts\train_lgbm_daily_high.py
python scripts\report_lgbm_daily_high.py
python -m pytest tests\test_probability_calibration.py tests\test_probability_rollout.py tests\test_lgbm_daily_high.py tests\test_lgbm_features.py
```

代码切换后补充执行：

```text
python -m pytest tests\test_probability_calibration.py tests\test_probability_rollout.py
```

结果：通过。
