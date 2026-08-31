# PolyWeather API 命名规范设计

## 目标

为对外提供的 DEB 与多模型温度预测接口建立简短、稳定、与实现解耦的公开名称和路径。

## 命名

- 产品名：`PolyWeather API`
- 当前版本：`v1`
- 预测资源：`forecasts`
- 标准入口：`GET /api/v1/forecasts`
- 城市筛选：`?cities=beijing,shanghai`

路径不包含 `DEB`，因为接口同时提供 DEB 融合结果和多模型结果，且未来可能替换或增加融合算法。

## 响应结构

标准入口将现有返回字段整理为以下稳定层级：

```json
{
  "generated_at": "...",
  "temp_symbol_default": "°C",
  "count": 1,
  "forecasts": {
    "beijing": {
      "local_date": "...",
      "local_time": "...",
      "utc_offset_seconds": 28800,
      "temp_symbol": "°C",
      "deb": {
        "prediction": 35.2,
        "weights": {},
        "quality": "..."
      },
      "daily": [],
      "models": {
        "keys": [],
        "daily": {},
        "hourly": {
          "times": [],
          "curves": {}
        }
      }
    }
  }
}
```

逐模型逐小时曲线继续保持原始温度数据，不在 API 层新增分布概率、置信区间或离散度等衍生指标。

## 兼容与迁移

- 保留 `/api/cities/deb-forecast`，避免影响已接入项目。
- 新增 `/api/v1/forecasts`，与旧接口使用相同鉴权、缓存和城市解析逻辑。
- 新项目统一使用 `/api/v1/forecasts` 和 `forecasts` 响应字段。
- 文档明确旧接口为兼容入口，不作为新接入的推荐路径。

## 验收标准

- 新入口支持现有城市参数、鉴权和缓存行为。
- 新入口返回 DEB、日报、多模型日报和逐模型逐小时曲线。
- 旧入口现有测试继续通过。
- 新旧入口均不暴露 DEB 分布概率等未约定字段。
