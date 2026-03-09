# PolyWeather API 接口文档 (v1.2)

本文档说明当前 PolyWeather 后端实际提供的 HTTP API。后端由 `web/app.py` 提供，前端通过 Next.js BFF 路由代理访问这些接口。

---

## 1. 基础信息

- **本地 Base URL**: `http://127.0.0.1:8000`
- **生产 Base URL**: `http://<your-vps-ip>:8000` 或绑定后的 HTTPS API 域名
- **响应格式**: JSON
- **缓存策略**:
  - 后端 `web/app.py` 内部分析缓存：默认 5 分钟（Ankara 为 60 秒）
  - 前端城市详情缓存：5 分钟 TTL + revision 校验
  - 前端手动刷新：强制 `force_refresh=true` 跳过缓存

---

## 2. 接口列表

### 2.1 获取监控城市列表

- **URL**: `/api/cities`
- **Method**: `GET`
- **用途**: 返回首页左侧监控城市与地图 marker 的基础元数据。

**响应示例**

```json
{
  "cities": [
    {
      "name": "ankara",
      "display_name": "Ankara",
      "lat": 40.1281,
      "lon": 32.9951,
      "risk_level": "medium",
      "risk_emoji": "🟠",
      "airport": "Esenboğa",
      "icao": "LTAC",
      "temp_unit": "celsius",
      "is_major": true
    }
  ]
}
```

### 2.2 获取城市实时分析

- **URL**: `/api/city/{name}`
- **Method**: `GET`
- **参数**:
  - `name`: 城市名或别名，如 `ankara`、`new-york`
  - `force_refresh` (可选): `true` 时跳过缓存
- **用途**: 右侧详情卡片、今日分析 modal、图表和周边站点的主数据接口。

**当前核心字段**

- `display_name`
- `local_time`
- `local_date`
- `temp_symbol`
- `risk`
- `current`
- `mgm`
- `mgm_nearby`
- `forecast`
- `multi_model`
- `deb`
- `ensemble`
- `probabilities`
- `trend`
- `metar_today_obs`
- `metar_recent_obs`
- `hourly`
- `hourly_next_48h`
- `source_forecasts`
- `multi_model_daily`
- `updated_at`

**说明**

- `current.raw_metar` 为 Aviation Weather 返回的原始报文字段。
- `mgm` 仅在具备官方 MGM 覆盖的城市（如 Ankara）有效。
- `mgm_nearby` 为统一周边站点字段：
  - Ankara：MGM 官方周边站
  - 其他多数城市：METAR cluster

### 2.3 获取历史对账数据

- **URL**: `/api/history/{name}`
- **Method**: `GET`
- **用途**: 历史对账弹窗与 `/deb` 指令的历史样本来源。

**响应示例**

```json
{
  "history": [
    {
      "date": "2026-03-07",
      "actual": 7.0,
      "deb": 6.5,
      "mu": 7.2,
      "mgm": 8.0
    }
  ]
}
```

**说明**

- 网页端历史图默认展示近期样本，但统计口径只使用已结算日期。
- 当天未结算样本可用于可视化趋势，不计入胜率与 MAE。

### 2.4 获取城市摘要

- **URL**: `/api/city/{name}/summary`
- **Method**: `GET`
- **用途**: 轻量级温度摘要接口，用于首屏地图温度预热与低开销列表更新。

**字段**

- `name`
- `display_name`
- `icao`
- `local_time`
- `temp_symbol`
- `current.temp`
- `current.obs_time`
- `deb.prediction`
- `risk.level`
- `risk.warning`
- `updated_at`

### 2.5 获取城市聚合详情

- **URL**: `/api/city/{name}/detail`
- **Method**: `GET`
- **用途**: 面向后续商业化聚合视图的单请求聚合接口。

**当前结构**

- `overview`
- `official`
- `timeseries`
- `models`
- `probabilities`
- `market_scan`
- `risk`
- `ai_analysis`

**说明**

- 当前生产前端主链路仍以 `/api/city/{name}` + `/api/history/{name}` 为主。
- `/api/city/{name}/detail` 已提供聚合结构，供后续产品层扩展接入。

---

## 3. 核心对象定义

### 3.1 风险等级

- `low`: 低风险，模型与实测整体较一致
- `medium`: 中风险，存在一定分歧或站点偏置
- `high`: 高风险，模型冲突较大或盘面波动价值高

### 3.2 DEB

`DEB` 是 PolyWeather 的动态融合预测层，不是简单平均值。它会综合：

- 多模型预测值
- 近期表现
- 城市级偏差特征
- 实况修正上下文

### 3.3 μ

`μ` 表示当前结算概率分布中心（动态期望值），会随模型分歧与实况变化而更新。  
它不应直接按固定 forecast 口径做静态历史对账。

---

## 4. 数据源与第三方 API

### 4.1 主观测源

- **Aviation Weather / METAR**
  - 全球机场主观测源
  - 同时提供结构化字段与原始 METAR 报文

### 4.2 Ankara 专属源

- **Turkish MGM**
  - Ankara 官方增强层
  - 含 `Ankara (Bölge/Center)` 与周边站点

### 4.3 预测源

- **Open-Meteo**
- **weather.gov**（美国城市）
- **Meteoblue**（部分城市）
- **多模型集成**: ECMWF / GFS / ICON / GEM / JMA

---

## 5. 当前口径说明

- 地图 marker 显示当前温度（首屏通过 `summary` 预热）。
- 点击城市后打开右侧详情卡片，保持当前布局与样式不变。
- “今日日内分析”在 modal 中展示：
  - 今日温度走势（含 METAR 实测点）
  - 结算概率分布
  - 多模型预报
  - 今日日内结构信号（规则引擎）
  - AI 深度分析 + 0-2 小时临近判断
- modal 打开时地图停止动画；点击空白地图仅关闭右侧卡片，不重置视角。

---

## 6. 常见问题

- **接口 500**
  - 先检查 `polyweather_web` 是否启动成功
  - 再看 `docker-compose logs -f polyweather_web`

- **METAR 看起来慢几分钟**
  - 常见原因是上游发布延迟，不一定是本地轮询问题
  - 建议同时查看：
    - `current.obs_time`
    - `current.report_time`
    - `current.receipt_time`

- **网页显示旧内容**
  - 先确认 Vercel 已部署最新版本
  - 再强刷浏览器缓存
  - 如为详情数据，确认是否命中前端 5 分钟 TTL

---

**最后更新**: 2026-03-09
