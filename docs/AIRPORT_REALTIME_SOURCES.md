# 机场高频实时数据源

## 已接入城市

| 城市 | 机场 | ICAO/站点 | 数据源 | 频率 | 类型 | 费用 |
|------|------|-----------|--------|------|------|------|
| 首尔 | 仁川国际 | RKSI | AMOS (`global.amo.go.kr`) | 1 分钟 | 跑道对温度（2对） | 免费 |
| 釜山 | 金海国际 | RKPK | AMOS (`global.amo.go.kr`) | 1 分钟 | 跑道对温度（1对） | 免费 |
| 东京 | 羽田 | RJTT | JMA AMeDAS (`jma.go.jp`) | 10 分钟 | 机场站点实时温度 | 免费 |
| 安卡拉 | Esenboğa | 17128 | MGM (`servis.mgm.gov.tr`) | 5-15 分钟 | 机场站点实时温度 | 免费 |
| 伊斯坦布尔 | 伊斯坦布尔机场 | 17058 | MGM (`servis.mgm.gov.tr`) | 5-15 分钟 | 机场站点实时温度 | 免费 |
| 赫尔辛基 | Vantaa | EFHK | FMI (`opendata.fmi.fi`) | 10 分钟 | 机场站点实时温度 | 免费 |
| 阿姆斯特丹 | Schiphol | EHAM | KNMI (`dataplatform.knmi.nl`) | 10 分钟 | 机场站点实时温度 | 免费（需注册） |
| 巴黎 | Le Bourget | LFPB | AROME HD (`api.open-meteo.com`) | 15 分钟 | 模型预报（非实测） | 免费 |

## 推送机制

- 每城按原生频率独立推送，不捆绑
- 首尔/釜山 60s，其余 600s
- 循环轮询 60s 以匹配最快频率
- 仅当当前温度距 DEB 预测最高 ≤3°C 时推送
- 确认过峰值后自动停止

## 前端市场监控 freshness 契约

后端城市详情接口会在 `current.freshness` / `airport_current.freshness` 返回源感知更新时间信息，前端市场监控不再用统一的 `obs_age_min` 判断所有城市。

关键字段：

```json
{
  "source_code": "amos",
  "source_label": "AMOS",
  "observed_at": "2026-05-14T11:59:10+00:00",
  "observed_at_local": "20:59",
  "native_update_interval_sec": 60,
  "expected_next_update_at": "2026-05-14T12:00:10+00:00",
  "freshness_status": "fresh",
  "freshness_reason": "within_native_fresh_window",
  "age_sec": 50
}
```

前端刷新规则：

- 首次进入市场监控：强制刷新全部城市，绕过 30 分钟前端缓存。
- 定时轮询：仍以 60s tick 检查，但只刷新已到 `expected_next_update_at`、`delayed`、`stale` 或缺失的城市。
- BFF 代理：`force_refresh=true` 时使用 `no-store`，避免 Next fetch revalidate 缓存吞掉强刷。
- 展示：卡片 tooltip 显示源端名称、原生更新间隔和当前 freshness 状态。

## 消息模板

```
Seoul / Incheon 16:03

15L/33R 14.6°C
15R/33L 15.2°C
今日DEB预报最高：18.2°C
今日实测最高：16.5°C（15:30）
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TELEGRAM_AIRPORT_PUSH_ENABLED` | 启用机场推送 | `true` |
| `TELEGRAM_AIRPORT_PUSH_INTERVAL_SEC` | 循环轮询间隔 | `60` |
| `KNMI_API_KEY` | KNMI API 密钥（阿姆斯特丹必填） | — |

## 未接入城市

| 城市 | 原因 |
|------|------|
| 马德里/Barajas | AEMET 注册页面失效 |
| 伦敦/Heathrow | Met Office 仅 1 小时更新 |
| 慕尼黑 | DWD 延迟 ~1 小时 |
| 米兰/华沙/莫斯科 | 无已知实时源 |
