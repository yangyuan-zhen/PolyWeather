# 模型栈与 DEB 去重规则

本文档记录 PolyWeather 当前开放模型接入、区域覆盖差异，以及 DEB 在新增模型后的计权规则。

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
| ECMWF AIFS | `ecmwf_aifs025_single` | ECMWF | aifs_global | ECMWF AIFS 模型 |
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

亚洲城市更依赖本地观测增强层，例如 JMA、KMA、NMC、HKO、CWA、METAR、TAF。

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
- LGBM
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
  -> 输出 blended_high + weights_info
```

当 `weights_info` 出现 `家族去重`，表示当前输入模型数量多于 DEB 实际入模数量，系统已先折叠同家族模型。

## 6. 前端展示

网页的模型展示读取：

- `multi_model`
- `multi_model_daily`
- `source_forecasts.open_meteo_multi_model.model_metadata`

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

## 7. 测试覆盖

相关测试：

- `tests/test_multi_model_sources.py`
- `tests/test_deb_model_family.py`
- `tests/test_lgbm_features.py`

重点覆盖：

- Open-Meteo 多模型解析
- 新模型元数据输出
- 区域模型缺失时降级
- DEB 家族去重
- 历史不足时的去重等权
- 有历史 MAE 时的去重动态权重
