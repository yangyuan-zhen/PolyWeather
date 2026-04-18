# EMOS 训练与发布报告（2026-04-19）

## 1. 当前结论

- `EMOS` 工程链路已经接通：可以训练、评估、生成候选参数，并在前端以校准概率层展示。
- 生产主概率当前不应默认使用 `emos_primary`。默认建议为 `legacy`；需要观察时使用 `emos_shadow`。
- `emos_primary` 只允许在本地离线训练通过门禁、人工复核后手动灰度。
- 低配 VPS（例如 1 vCPU / 2GB RAM）不适合做 EMOS 全量训练；VPS 只负责采集、服务和加载已批准的参数文件。
- `LGBM` 当前仍不建议作为主路径，继续保持 `POLYWEATHER_LGBM_ENABLED=false`。

## 2. 最近两次训练结果

### 2.1 VPS 轻量训练：不通过

VPS 使用最近 `5000` 条 snapshot 训练的候选：

- 版本：`emos-auto-20260418204203`
- 样本数：`791`
- 结论：`hold`

| 指标 | 变化 |
| :-- | --: |
| `delta_crps` | `+0.004652` |
| `delta_mae` | `+0.102623` |
| `delta_bucket_hit_rate` | `-0.137800` |

解读：CRPS、MAE、桶命中全部弱于 legacy，因此不能晋级。

### 2.2 本地训练：通过门禁，但仍需灰度

本地电脑使用生产 SQLite 副本与最近 `50000` 条 snapshot 训练的候选：

- 版本：`emos-auto-20260418212046`
- 样本数：`847`
- 结论：`promote`

| 指标 | 变化 |
| :-- | --: |
| `delta_crps` | `-0.036170` |
| `delta_mae` | `-0.007896` |
| `delta_bucket_hit_rate` | `-0.009445` |

解读：

- CRPS 与 MAE 有改善，候选通过当前门禁。
- 桶命中率轻微下降，虽然在门禁允许范围内，但仍建议先以 `emos_shadow` 观察，再决定是否切 `emos_primary`。

## 3. 生产运行策略

推荐生产 `.env`：

```env
POLYWEATHER_PROBABILITY_ENGINE=legacy
POLYWEATHER_PROBABILITY_CALIBRATION_FILE=/var/lib/polyweather/probability_calibration/default.json
```

观察 EMOS 时：

```env
POLYWEATHER_PROBABILITY_ENGINE=emos_shadow
POLYWEATHER_PROBABILITY_CALIBRATION_FILE=/var/lib/polyweather/probability_calibration/default.json
```

只有在候选连续通过评估、前端展示稳定、业务侧确认后，才切：

```env
POLYWEATHER_PROBABILITY_ENGINE=emos_primary
POLYWEATHER_PROBABILITY_CALIBRATION_FILE=/var/lib/polyweather/probability_calibration/default.json
```

验证线上加载状态：

```bash
docker compose exec -T polyweather_web python - <<'PY'
from src.analysis.probability_calibration import load_calibration, resolve_probability_engine_mode
cal = load_calibration()
print("engine_mode =", resolve_probability_engine_mode())
print("loaded_version =", cal.get("version"))
print("sample_count =", (cal.get("metrics") or {}).get("sample_count"))
print("has_global =", bool(cal.get("global")))
PY
```

## 4. 本地训练 SOP

### 4.1 拉取生产 SQLite 副本

推荐先在 VPS 上用 SQLite 在线备份生成快照：

```bash
sqlite3 /var/lib/polyweather/polyweather.db ".backup '/var/lib/polyweather/polyweather-train-copy.db'"
```

本地 PowerShell 拉取：

```powershell
cd E:\web\PolyWeather
scp root@38.54.27.70:/var/lib/polyweather/polyweather-train-copy.db E:\web\PolyWeather\data\polyweather-prod.db
```

如果生产库写入压力很低，也可以直接拉主库副本：

```powershell
scp root@38.54.27.70:/var/lib/polyweather/polyweather.db E:\web\PolyWeather\data\polyweather-prod.db
```

### 4.2 本地训练

```powershell
cd E:\web\PolyWeather
$env:POLYWEATHER_DB_PATH="E:\web\PolyWeather\data\polyweather-prod.db"
$env:POLYWEATHER_RUNTIME_DATA_DIR="E:\web\PolyWeather\artifacts\local_runtime"
python scripts\auto_retrain_probability_calibration.py --verbose --snapshot-limit 50000
```

如果本地机器仍然较慢，可先降到：

```powershell
python scripts\auto_retrain_probability_calibration.py --verbose --snapshot-limit 20000
```

训练报告：

```powershell
Get-Content E:\web\PolyWeather\artifacts\local_runtime\probability_calibration\auto_retrain_report.json
```

候选目录：

```text
E:\web\PolyWeather\artifacts\local_runtime\probability_calibration\candidates\<version>\
```

### 4.3 晋级判断

只有报告满足以下条件时，候选才可进入部署流程：

```json
"ready_for_promotion": true
```

同时人工检查：

- `delta_crps <= 0`
- `delta_mae <= 0.05`
- `delta_bucket_hit_rate >= -0.05`
- 城市级结果没有出现关键城市大幅退化
- 前端概率分布没有明显过度摊平或异常偏桶

## 5. 部署通过的候选

把本地候选上传到 VPS：

```powershell
scp E:\web\PolyWeather\artifacts\local_runtime\probability_calibration\candidates\<version>\default.json root@38.54.27.70:/var/lib/polyweather/probability_calibration/default.json
```

VPS 上优先设置为 `emos_shadow`：

```env
POLYWEATHER_PROBABILITY_ENGINE=emos_shadow
POLYWEATHER_PROBABILITY_CALIBRATION_FILE=/var/lib/polyweather/probability_calibration/default.json
```

重启：

```bash
cd /root/PolyWeather
docker compose up -d polyweather_web
```

观察稳定后再考虑 `emos_primary`。

## 6. VPS 定时训练策略

当前策略：**不在 VPS 上做 EMOS 定时训练**。

原因：

- 生产 SQLite 的 `probability_training_snapshots_store` 会持续增长。
- 低配 VPS 全量扫描会造成 CPU/IO 飙升，严重时影响 SSH 和线上服务。
- VPS 训练用较小 `--snapshot-limit` 虽然安全，但训练效果可能弱于本地。

如果曾经加过 cron，应删除：

```bash
crontab -l | grep -v 'auto_retrain_probability_calibration.py' | crontab -
```

确认：

```bash
crontab -l
```

## 7. 自动重训脚本说明

脚本：

```text
python scripts\auto_retrain_probability_calibration.py
```

默认行为：

- 生成新的 EMOS candidate。
- 对 candidate 跑离线评估。
- 写入候选目录和门禁报告。
- 不覆盖线上 `default.json`。

重要参数：

- `--verbose`：输出训练/评估进度。
- `--snapshot-limit N`：只使用最近 N 条 snapshot。
- `--promote-if-passed`：门禁通过后覆盖目标参数文件。
- `--run-tests`：晋级前跑测试。

当前不建议在 VPS 使用 `--promote-if-passed`。本地训练通过后，仍优先人工上传并使用 `emos_shadow`。

## 8. 门禁阈值

默认阈值：

- `POLYWEATHER_EMOS_AUTO_MIN_SAMPLES=50`
- `POLYWEATHER_EMOS_AUTO_MAX_DELTA_CRPS=0`
- `POLYWEATHER_EMOS_AUTO_MAX_DELTA_MAE=0.05`
- `POLYWEATHER_EMOS_AUTO_MIN_DELTA_BUCKET_HIT_RATE=-0.05`

解释：

- `CRPS` 不允许比 legacy 更差。
- `MAE` 最多允许轻微退化 `0.05`。
- `bucket_hit_rate` 是业务参考指标，但对结算边界敏感，不单独作为唯一判断。

## 9. 前端说明

今日日内分析中的概率区展示的是当前生产概率引擎输出：

- `legacy`：展示现有动态概率。
- `emos_shadow`：用户主概率仍为 legacy，EMOS 仅用于对照和评估。
- `emos_primary`：用户主概率使用 EMOS 校准分布。

对外文案应避免暗示“EMOS 一定更准”。推荐解释为：

> EMOS 是 PolyWeather 基于 DEB 路径、多模型集合、METAR 实测进度和历史误差结构生成的统计校准概率，不是外部天气模型，也不是直接 API 结果。

## 10. 已验证

本地训练链路已验证：

```text
python scripts\auto_retrain_probability_calibration.py --verbose --snapshot-limit 50000
```

测试链路已验证：

```text
python -m pytest tests\test_auto_retrain_probability_calibration.py tests\test_probability_calibration.py tests\test_probability_rollout.py
```

当前工程结论：

**EMOS 可以继续本地训练与 shadow 观察，但生产主概率不应因为“机制接好”而默认切到 `emos_primary`。**
