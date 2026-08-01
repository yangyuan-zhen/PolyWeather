# WeatherNext 2 接入说明

PolyWeather 已新增 WeatherNext 2 的内部接入层，当前定位是“概率底座”和“DEB 参考模型”，不是公开 API。

## 已落地

- `src.data_collection.weathernext2_sources`
  - 将 64 成员最高温预报聚合成 Polymarket 口径概率桶。
  - 摄氏城市按单温度选项，例如 `33°C`。
  - 华氏城市按两度市场选项，例如 `94-95°F`。
  - 支持从 hourly 成员序列按城市当地日期切出今日最高温。
- `WeatherDataCollector.fetch_weathernext2_probability`
  - 默认关闭，不影响现有生产采集。
  - `WEATHERNEXT2_ENABLED=1` 后启用。
  - 优先读取 worker 生成的 `/app/data/weathernext2_city_highs.json`，再降级读取 fixture。
  - 若存在 LightGBM 校准模型，会对 raw 成员分布做 quantile residual 校准后再生成市场桶概率。
- `web.weathernext2_worker`
  - 独立低频 worker，不在 API/Telegram 请求中训练或访问 GCS。
  - 从 GCS Zarr 对城市经纬度最近格点取 2m temperature hourly ensemble。
  - 按城市当地日期切今日最高温，写入离线 JSON 产物。
  - 使用 `training_feature_records_store` + `truth_records_store` 训练 LightGBM q10/q50/q90 residual calibrator。
- `trend_engine`
  - 若 `weather_data["weathernext2"]` 存在，`distribution_full` 使用 WeatherNext 2 概率桶，`probability_engine=weathernext2`。
  - WeatherNext 2 ensemble median/mean 会作为 `WeatherNext 2` 进入 `current_forecasts`，供 DEB 融合参考。

## 环境变量

```bash
WEATHERNEXT2_ENABLED=1
WEATHERNEXT2_BACKEND=gcs_zarr
WEATHERNEXT2_DATA_ROOT=/app/data/weathernext2
WEATHERNEXT2_CITY_HIGHS_PATH=/app/data/weathernext2_city_highs.json
WEATHERNEXT2_MODEL_DIR=/app/data/models/weathernext2_calibrator
WEATHERNEXT2_WORKER_INTERVAL_SEC=21600
WEATHERNEXT2_CACHE_TTL_SEC=21600
WEATHERNEXT2_GCS_ZARR_URI=gs://weathernext/weathernext_2_0_0/zarr
WEATHERNEXT2_MEAN_GCS_ZARR_URI=gs://weathernext/weathernext_2_0_0_mean/zarr
GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/gcp-sa.json
```

Google 官方说明中 WeatherNext 2 GCS Zarr 路径为 `gs://weathernext/weathernext_2_0_0/zarr`，访问前需要 WeatherNext Data Request 权限。缺 GCP 凭据或无访问权限时，worker 会失败退出本轮，不覆盖旧产物；Web/API 仍按现有数据源运行。

## Artifact / Fixture 格式

```json
{
  "schema_version": 1,
  "source": "weathernext2",
  "backend": "gcs_zarr",
  "generated_at": "2026-07-01T10:00:00+00:00",
  "cities": {
    "houston": {
      "target_date": "2026-06-29",
      "source_run": "2026-06-29T00:00:00Z",
      "member_highs": {
        "member_00": 94.1,
        "member_01": 94.8,
        "member_02": 95.2,
        "member_03": 96.7
      },
      "summary": {
        "members": 4,
        "median": 95.0
      },
      "buckets": []
    }
  }
}
```

也可以提供 hourly 成员序列：

```json
{
  "shanghai": {
    "target_date": "2026-06-29",
    "timezone_offset_seconds": 28800,
    "utc_times": ["2026-06-28T16:00:00Z", "2026-06-29T06:00:00Z"],
    "member_hourly": {
      "member_00": [31.2, 33.0],
      "member_01": [30.8, 32.6]
    }
  }
}
```

## 后续真实拉取

Google 官方 WeatherNext 2 数据源包括 GCS Zarr、BigQuery、Earth Engine 和 Vertex AI。当前第一版已经按独立离线 job 落地：

- 每 6 小时拉取最近一次 WeatherNext 2 run。
- 对 51 个城市插值到机场/结算点。
- 切城市当地日期今日最高温。
- 写入 `/app/data/weathernext2_city_highs.json` 或数据库表。
- Web/API 只读本地结果，避免实时请求 Google 数据集影响响应时间。

后续可以评估 BigQuery 后端作为替代路径，但不应让 API 请求直接依赖外部 WeatherNext 数据集。
