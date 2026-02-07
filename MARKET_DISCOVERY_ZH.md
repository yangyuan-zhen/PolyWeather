# Polymarket 天气市场搜寻技术文档

本文档详细说明了 PolyWeather 如何在 Polymarket 上自动识别、筛选并跟踪天气相关市场的技术实现逻辑。

## 1. 数据来源

我们跳过了复杂的官方 SDK，直接与 **Polymarket Gamma API** 交互。这是 Polymarket 的官方元数据层，负责所有市场的发现与展示。

- **Base URL:** `https://gamma-api.polymarket.com`
- **Endpoint:** `/markets`

## 2. 搜寻策略

由于 Polymarket 同时挂载数千个预测市场，系统采用多层搜索方案以确保不会遗漏任何城市的分段合约。

### 2.1 关键词三重搜索

程序并非只搜索一个词，而是并发执行三个搜索模式：

1.  `"highest temperature"`: 匹配大多数天气问题的核心描述。
2.  `"temperature in"`: 针对特定地区市场的宽泛搜索。
3.  `"daily weather"`: 针对某些命名不规范市场的兜底搜索。

### 2.3 优先级与排序

为了确保能搜到**最新**发布的合约（例如 2026年2月9日 的市场），我们应用了特定的 API 排序参数：

- `order=id` & `ascending=false`: 优先扫描最新创建的市场 ID。
- `active=true` & `closed=false`: 过滤掉已结算或已关闭的无效合约。

## 3. 过滤与解析逻辑

系统在获取 API 返回的列表后，会进行二次深度筛选：

### 3.1 文本校验

检查市场的 `question`（问题描述）和 `slug`（URL 路径）：

- **模式匹配:** 必须包含 `"highest temperature in"` 或 `"highest-temperature-in"`。
- **城市提取:** 逻辑会自动识别问题中的城市名（如 芝加哥、伦敦 等）。

### 3.2 负风险（Negative Risk）市场处理

Polymarket 的天气市场通常以 **Negative Risk** 分组形式存在（一个事件下包含多个互斥的区间，如“70°F以上”和“68-69°F”）。

**技术挑战:** 在 API 的列表视图中，这类市场的 `activeTokenId` 字段经常返回 `null`。
**我们的解决方案:**

1.  检查 `clobTokenIds` 字段。
2.  如果该字段是 JSON 字符串（Gamma API 的常见返回格式），则将其解析为 Python 列表。
3.  如果 `activeTokenId` 缺失，我们将列表中的第一个 Token ID 视为 **"YES" Token**。
4.  这使系统能够绕过元数据同步延迟，直接在 CLOB 层面抓取实时买入/卖出价格。

## 4. 市场规范化结构

每个搜寻到的分段都会被规范化为以下结构，供决策引擎（Decision Engine）使用：

- `condition_id`: 用于结果判定的 UMA 条件 ID。
- `active_token_id`: 我们需要监控并买入的特定 ERC1155 Token ID。
- `group_id`: 即 `negRiskMarketID`。这让机器人知道哪些不同的温度区间是属于同一个城市的，从而进行跨区间套利或对冲分析。
- `slug`: 市场的唯一路径名，用于在 Telegram 预警中生成直接跳转链接。

## 5. 频率与缓存机制

- **搜寻频率:** 系统每 **5 分钟** 重新扫描一次新城市和新日期。
- **缓存策略:** 搜寻到的市场会存入内存缓存（`_weather_markets_cache`），以减轻 API 压力并避免触发现速限制。

---

_创建日期: 2026-02-07_
_PolyWeather 系统技术文档_
