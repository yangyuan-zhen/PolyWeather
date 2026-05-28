# 模型栈与 DEB 去重规则

本文档记录 PolyWeather 当前开放模型接入、区域覆盖差异，以及 DEB 在新增模型后的计权规则。

最后更新：`2026-05-28`

## 1. 接入方式

当前多模型层通过 Open-Meteo model API 接入开放 NWP / AIFS 等预报模型，不直接下载原始 GRIB。

入口：

- `src/data_collection/nws_open_meteo_sources.py`
- `WeatherDataCollector.fetch_multi_model(...)`

返回结构继续保持向后兼容：

- `multi_model.forecasts`
- `multi_model.daily_forecasts`
- `multi_model.dates`

新增元数据：

- `multi_model.provider`
- `multi_model.model_metadata`
- `multi_model.model_keys`
- `multi_model.attribution`

Web API 会把这部分元数据挂到：

- `source_forecasts.open_meteo_multi_model`

## 2. 当前模型清单

| 显示名 | Open-Meteo key | 来源 | 层级 | 说明 |
| --- | --- | --- | --- | --- |
| ECMWF | `ecmwf_ifs025` | ECMWF | global | IFS 全球传统数值模式 |
| ECMWF AIFS | `ecmwf_aifs025_single` | ECMWF | aifs_global | ECMWF AIFS 模型；产品文案保留 AIFS 名称，避免和外部泛神经天气模型混淆 |
| GFS | `gfs_seamless` | NOAA | global | NOAA 全球参考 |
| ICON | `icon_seamless` | DWD | global | DWD ICON 全球基准 |
| ICON-EU | `icon_eu` | DWD | regional_europe | 欧洲区域高分辨率 |
| ICON-D2 | `icon_d2` | DWD | short_range_europe | 欧洲短时高分辨率 |
| GEM | `gem_seamless` | ECCC | global | 加拿大 GEM seamless |
| GDPS | `gem_global` | ECCC | global | 加拿大全球模式 |
| RDPS | `gem_regional` | ECCC | regional_north_america | 北美区域模式 |
| HRDPS | `gem_hrdps_continental` | ECCC | short_range_north_america | 北美短时高分辨率 |
| JMA | `jma_seamless` | JMA | global | 日本气象厅全球参考 |

## 3. 区域覆盖差异

同一个多模型请求会带上完整模型清单，但 Open-Meteo 只会返回覆盖当前坐标的模型字段。区域模型不覆盖时不会进入下游。

### 欧洲城市

常见模型：

- ECMWF
- ECMWF AIFS
- GFS
- ICON
- ICON-EU
- ICON-D2
- GEM / GDPS
- JMA

欧洲高分辨率重点来自 DWD ICON-EU / ICON-D2。

### 北美城市

常见模型：

- ECMWF
- ECMWF AIFS
- GFS
- ICON
- GEM / GDPS
- RDPS
- HRDPS
- JMA
- NWS

北美高分辨率重点来自 ECCC RDPS / HRDPS，NWS 继续作为美国城市官方预报参考。

### 亚洲城市

常见模型：

- ECMWF
- ECMWF AIFS
- GFS
- ICON
- GEM / GDPS
- JMA

通常不会出现：

- ICON-EU
- ICON-D2
- RDPS
- HRDPS

亚洲城市更依赖本地观测增强层，例如 JMA、AMOS（首尔/釜山）、NMC、HKO、CWA、METAR、TAF。

## 4. DEB 家族去重

DEB 不直接把所有模型按“每个模型一票”计入。新增区域模型后，如果不去重，会造成同一模型机构重复放大。

处理入口：

- `src/analysis/deb_algorithm.py`
- `_collapse_forecasts_for_deb(...)`
- `calculate_dynamic_weights(...)`

### DWD ICON 家族

归并成员：

- ICON
- ICON-EU
- ICON-D2

优先级：

```text
ICON-D2 > ICON-EU > ICON
```

### ECCC GEM 家族

归并成员：

- GEM
- GDPS
- RDPS
- HRDPS

优先级：

```text
HRDPS > RDPS > GDPS > GEM
```

### 独立保留

以下模型路径不合并：

- ECMWF IFS
- ECMWF AIFS
- GFS
- JMA
- MGM
- NWS
- HKO
- Open-Meteo

ECMWF IFS 与 ECMWF AIFS 分开保留，因为前者是传统 NWP，后者是 AIFS 模型。

## 5. DEB 权重流程

当前流程：

```text
raw current_forecasts
  -> 过滤不可用值与排除模型
  -> 按模型家族去重
  -> 历史 MAE 统计
  -> MAE 倒数权重
  -> 输出 raw blended_high
  -> recent signed-bias correction
  -> 输出 production prediction + raw_prediction + version
```

当 `weights_info` 出现 `家族去重`，表示当前输入模型数量多于 DEB 实际入模数量，系统已先折叠同家族模型。

### 5.1 DEB hourly consensus

当前图表和峰值窗口优先使用 `deb_hourly_consensus.v1`。

入口：

- `src/analysis/deb_hourly_consensus.py`
- `web/analysis_service.py`
- `src/analysis/trend_engine.py`

处理逻辑：

```text
multi_model hourly curves
  -> 按 DEB 可用模型和家族去重口径选择候选
  -> 使用 DEB 权重生成逐小时 consensus
  -> 输出 deb.hourly_consensus
  -> 图表 DEB Forecast 与 peak-window 逻辑优先读取该路径
```

关键口径：

- `deb_hourly_consensus.v1` 是预测曲线，不是实测曲线。
- 它只用于日内形状、峰值窗口和 DEB Forecast 展示；视觉预警和“接近峰值”状态必须优先读取实测/跑道/官方站点当前值与今日实测高点。
- 如果多模型小时路径缺失，系统才回退旧的 `hourly_plus_deb_offset`。

### 5.2 版本化预测与偏差校正

DEB 原始融合逻辑不推倒重写，`calculate_dynamic_weights(...)` 仍作为 raw baseline。线上生产入口使用 `calculate_deb_prediction(...)` 包装 raw baseline，并在有足够历史样本时追加城市级 recent signed-bias correction。

当前版本：

- `deb_v1_raw`：原始 DEB，最近模型误差倒数加权后的融合值。
- `deb_v1_recent_bias_corrected`：在 raw DEB 上叠加最近已结算样本的有符号偏差校正。偏差使用 shrinkage，样本少时自动收缩，避免单日异常过拟合。

API `deb` payload 会保留：

- `prediction`：当前生产使用值。
- `raw_prediction`：未经 recent-bias correction 的原始 DEB。
- `version`：生产值对应的 DEB 版本。
- `bias_adjustment` / `bias_samples`：城市级偏差校正幅度与训练样本数。
- `intraday_adjustment`：网页 full detail 中额外的日内观测路径修正，仅用于当前日实时展示。

版本化回测命令：

```bash
python scripts/backtest_deb_versions.py \
  --output-json data/deb_backtest_latest.json \
  --output-csv data/deb_backtest_latest.csv
```

本地 `data/polyweather.db` 于 2026-05-27 的回测样本显示：

| 版本 | 样本 | MAE | RMSE | Bias | 结算桶命中率 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `deb_v1_raw` | 1272 | 1.626 | 2.602 | -0.633 | 25.8% |
| `deb_v1_recent_bias_corrected` | 1272 | 1.499 | 2.542 | +0.263 | 31.4% |

该结果只证明当前历史样本上的离线表现改善；后续仍需要持续用版本化回测追踪不同城市、季节与结算源下的漂移。

## 6. 前端展示

网页的模型展示读取：

- `multi_model`
- `multi_model_daily`
- `source_forecasts.open_meteo_multi_model.model_metadata`
- `deb.hourly_consensus`

显示分组：

- 全球基准
- AIFS 模型
- 欧洲高分辨率
- 北美高分辨率

展示字段：

- 可用模型数量
- 模型分歧 spread
- 来源
- provider
- model
- resolution
- horizon

区域模型不覆盖时不显示空模型。

终端图表默认：

- 展示“全天”视图，按城市当地日 00:00-23:59 和真实观测时间绘制。
- 可选“高温”视图，窗口由 `deb_hourly_consensus.v1` 的峰值区域推导。
- DEB Forecast 使用橙色预测曲线；实测/跑道/官方站点曲线独立展示，不把 DEB 当成实测。
- legacy 高斯概率显示为水平温度带和 `mu` 参考线，不参与时间序列曲线。

### 6.1 “来源 Open-Meteo”是什么意思

前端中的 `来源 - Open-Meteo` 表示本次多模型数据通过 Open-Meteo model API 归一化接入。

它不表示：

- Open-Meteo 是单一数值模型
- Open-Meteo 生成了所有预报
- ECMWF / DWD / ECCC / NOAA / JMA 的机构来源被替换

所以模型行仍会分别展示：

- 机构：例如 ECMWF、DWD、ECCC、NOAA、JMA
- 接入接口：例如 Open-Meteo
- 模型 key：例如 `ecmwf_ifs025`、`icon_d2`、`gem_hrdps_continental`

### 6.2 模型区间、校准概率、市场参考的关系

当前前端把三层拆开展示：

- `模型区间与分歧`：解释不同模型当前给出的最高温范围和分歧，不直接等于命中概率。
- `市场参考`：只展示市场价格和错价背景，不再作为主判断，也不默认输出 BUY YES / BUY NO。

模型票数只用于解释“哪些模型支持某个档位”，不等于最终概率。最终概率应优先读取 `probabilities.engine` 对应的校准分布。

## 7. 测试覆盖

相关测试：

- `tests/test_multi_model_sources.py`
- `tests/test_deb_model_family.py`
- `tests/test_deb_evaluation_upgrade.py`

重点覆盖：

- Open-Meteo 多模型解析
- 新模型元数据输出
- 区域模型缺失时降级
- DEB 家族去重
- 历史不足时的去重等权
- 有历史 MAE 时的去重动态权重
- DEB raw/corrected 版本化评估、recent-bias correction、JSON/CSV 回测输出
