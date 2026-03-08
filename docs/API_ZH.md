# PolyWeather API 接口文档 (v1.1)

本文档说明当前 PolyWeather 后端实际提供的 HTTP API。后端由 `web/app.py` 提供，前端网页通过 Next.js BFF 代理访问这些接口。

---

## 1. 基础信息

- **本地 Base URL**: `http://127.0.0.1:8000`
- **生产 Base URL**: `http://<your-vps-ip>:8000` 或绑定后的 HTTPS API 域名
- **响应格式**: JSON
- **缓存策略**:
  - `/api/cities`: 5 分钟
  - `/api/city/{name}`: 30 秒
  - `/api/history/{name}`: 15 分钟
  - `/api/city/{name}/summary`: 30 秒
  - `/api/city/{name}/detail`: 30 秒

---

## 2. 接口列表

### 2.1 获取监控城市列表

- **URL**: `/api/cities`
- **Method**: `GET`
- **用途**: 返回首页左侧监控城市与世界地图 marker 的基础元数据。

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
      "risk_emoji": "🟡",
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
- **用途**: 首页右侧详情面板与地图数据的主接口。

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
- `updated_at`

**说明**

- `current.raw_metar` 现在直接透出 Aviation Weather API 返回的原始 METAR 报文。
- `mgm` 只对 Ankara 这类确实有 Turkish MGM 覆盖的城市有值。
- `mgm_nearby` 当前是一个复用字段：
  - Ankara: Turkish MGM 周边站
  - 多数其他城市: AviationWeather METAR cluster

### 2.3 获取历史对账数据

- **URL**: `/api/history/{name}`
- **Method**: `GET`
- **用途**: 历史准确率对账弹窗与机器人 `/deb` 命令的数据基础。

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

- 网页端历史对账只统计 **近 15 天已结算样本**
- 当天未结算样本可以画在图里，但不计入胜率与 MAE

### 2.4 获取城市摘要

- **URL**: `/api/city/{name}/summary`
- **Method**: `GET`
- **用途**: 轻量摘要接口，适合未来做 hover 预取或低开销列表更新。

**字段**

- `name`
- `display_name`
- `icao`
- `local_time`
- `temp_symbol`
- `current.temp`
- `deb.prediction`
- `risk.level`
- `risk.warning`
- `updated_at`

### 2.5 获取城市聚合详情

- **URL**: `/api/city/{name}/detail`
- **Method**: `GET`
- **用途**: 面向未来的单请求聚合详情接口，便于把 `city + summary + history + future analysis` 整合到一个载荷中。

**当前结构**

- `overview`
- `official`
- `timeseries`
- `models`
- `probabilities`
- `future`

**说明**

- 当前首页 legacy 布局还主要使用 `/api/city/{name}` 和 `/api/history/{name}`
- `/api/city/{name}/detail` 已用于后续更完整详情态的聚合设计

---

## 3. 核心对象定义

### 3.1 风险等级

- `low`: 低风险，模型与实测较一致
- `medium`: 中风险，存在一定分歧或本地站点偏置
- `high`: 高风险，模型冲突大或盘面博弈价值高

### 3.2 DEB

`DEB` 是 PolyWeather 的动态融合预测层，不是简单平均值。它会结合：

- 多模型预测值
- 近期表现
- 实况修正
- 城市级偏置

### 3.3 μ

`μ` 代表当前结算分布中心，是一个**动态期望值**，会随着模型、实况、趋势变化而变化。  
它不应直接与固定 forecast 用同一口径做静态历史对账。

---

## 4. 数据源与第三方 API

### 4.1 主观测源

- **Aviation Weather / METAR**
  - 当前全球机场主观测源
  - 同时提供结构化字段与 `rawOb`

### 4.2 Ankara 专属源

- **Turkish MGM**
  - Ankara 主官方增强层
  - 包括 `Ankara (Bölge/Center)` 与周边站点

### 4.3 预测源

- **Open-Meteo**
- **weather.gov**（美国城市）
- **Meteoblue**（部分城市）
- **多模型集合**: ECMWF / GFS / ICON / GEM / JMA

---

## 5. 当前口径说明

- 首页地图主 marker 显示 **当前温度**
- 右侧详情面板展示当前实测、DEB、结算概率、多模型、多日预报
- 未来日期分析模态框：
  - 显示温度走势、结算概率分布、多模型预报、未来 6-48 小时趋势、未来 0-2 小时临近判断
  - 已移除独立“冷锋 / 暖锋判断”模块

---

## 6. 常见问题

- **接口 500**
  - 先检查 `polyweather_web` 是否启动成功
  - 再看 `docker-compose logs -f polyweather_web`

- **METAR 看起来慢几分钟**
  - 通常是官方链路入库/发布延迟，不一定是本地轮询慢
  - 请同时看：
    - `current.obs_time`
    - `current.report_time`
    - `current.receipt_time`

- **网页显示旧内容**
  - 先确认 Vercel 已部署新版本
  - 再强刷浏览器缓存

---

**最后更新**: 2026-03-09
