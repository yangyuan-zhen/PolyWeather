# PolyWeather API 接口文档 (v1.0)

本文档详细介绍了 PolyWeather 后端提供的 RESTful API 接口。该后端基于 FastAPI 构建，主要为前端地图和终端面板提供实时天气分析、模型预测及历史对账数据。

---

## 1. 基础信息

- **Base URL**: `http://127.0.0.1:8000` (本地) 或 `https://your-vps-ip:8000` (服务器)
- **数据格式**: JSON
- **速率限制**: 默认无限制，建议前端缓存时间 5 分钟。

---

## 2. 接口列表

### 2.1 获取城市列表

返回所有受监控的城市及其基础坐标和风险等级。

- **URL**: `/api/cities`
- **Method**: `GET`
- **返回示例**:

```json
{
  "cities": [
    {
      "name": "ankara",
      "display_name": "Ankara",
      "lat": 39.93,
      "lon": 32.85,
      "risk_level": "medium",
      "risk_emoji": "🟡",
      "airport": "Esenboga",
      "icao": "LTAC",
      "temp_unit": "celsius",
      "is_major": true
    }
  ]
}
```

### 2.2 获取城市详情分析

获取指定城市的实时实测数据、多模型预测对比、DEB 算法预测以及 AI 决策建议。

- **URL**: `/api/city/{name}`
- **Method**: `GET`
- **参数**:
  - `name` (string): 城市名称或别名（不区分大小写，如 `ankara`, `ldn`）。
  - `force_refresh` (bool, optional): 是否强制跳过缓存刷新数据。默认 `false`。
- **返回示例**:

```json
{
  "name": "ankara",
  "display_name": "Ankara",
  "lat": 39.93,
  "lon": 32.85,
  "temp_symbol": "°C",
  "local_time": "2024-03-08 10:30:00",
  "risk": {
    "level": "medium",
    "warning": "模型分歧较大",
    "icao": "LTAC"
  },
  "current": {
    "temp": 12.5,
    "max_so_far": 14.2,
    "obs_time": "10:20",
    "wx_desc": "Cloudy"
  },
  "multi_model": {
    "ECMWF": 15.1,
    "GFS": 14.8,
    "MGM": 15.5
  },
  "deb": {
    "prediction": 15.2
  },
  "ai_analysis": "当前模型一致性较好，建议参考 DEB 预测值..."
}
```

### 2.3 获取历史对账数据

获取指定城市的过去几天内的预测值与真实最高温的对比记录，用于评估模型准确率。

- **URL**: `/api/history/{name}`
- **Method**: `GET`
- **参数**:
  - `name` (string): 城市名称。
- **返回示例**:

```json
{
  "history": [
    {
      "date": "2024-03-07",
      "actual": 14.0,
      "deb": 14.2,
      "mu": 14.1,
      "mgm": 14.5
    }
  ]
}
```

---

## 3. 核心对象定义

### 3.1 风险等级 (Risk Level)

- `low` (🟢): 预测一致，波动小。
- `medium` (🟡): 存在轻微模型分歧或数据延迟。
- `high` (🔴): 模型严重打架，市场风险极高。

### 3.2 预测模型 (Models)

- `ECMWF`: 欧洲中期天气预报中心（全球最准）。
- `GFS`: 美国全球预测系统。
- `MGM`: 土耳其国家气象局（针对特定城市非常精准）。
- `DEB`: PolyWeather 独家加权融合算法成果。

---

## 4. 数据来源与第三方 API

系统通过多源聚合链路确保数据的真实性与前瞻性，以下是目前集成的核心数据源：

### 4.1 核心实测数据 (Settlement Data)

- **NOAA Aviation Weather (METAR)**: 全球机场官方航空气象报文，也是 Polymarket 官方结算参考源。
- **Iowa Mesonet (IEM)**: 提供 1-5 分钟级别的超高频 ASOS/METAR 实时观测，是高频交易对账的核心源。
- **MGM (土耳其国家气象局)**: 提供土耳其境内（如安卡拉）最精细的本地观测站数据。

### 4.2 模型预测数据 (Forecast Data)

- **Open-Meteo**: 聚合 ECMWF (欧洲中期)、GFS (美国)、ICON (德国) 等全球顶级大型数值预报模型。
- **Meteoblue**: 针对地形复杂的城市提供高精度修正预测（需 API Key）。
- **NWS (美国气象局)**: 美国本土城市的官方权威预报。

### 4.3 智能化分析

- **Groq API**: 驱动 AI 态势感知引擎，基于多源数据生成实时中文交易分析报告（需 API Key）。

---

## 5. 常见问题

- **404 Error**: 检查城市名是否拼写正确，或是否在支持列表中。
- **500 Error**: 后端与气象数据源（如 METAR）同步失败，通常 1 分钟后会自动恢复。
- **数据延迟**: METAR 实测数据通常每 30-60 分钟更新一次。
