# 外部监控与告警说明

最后更新：`2026-04-10`

## 1. 目标

在现有轻量可观测性基础上，把 PolyWeather 补成最小可用的外部监控链路：

- Prometheus 抓取 `/metrics`
- Alertmanager 根据规则聚合告警
- Relay 把告警推到运营频道
- Grafana 展示趋势面板
- 巡检脚本补健康检查

## 2. 组件

本仓库现在内置 4 个监控组件：

- `polyweather_prometheus`
- `polyweather_alertmanager`
- `polyweather_alert_relay`
- `polyweather_grafana`

对应配置目录：

- [monitoring/prometheus/prometheus.yml](../monitoring/prometheus/prometheus.yml)
- [monitoring/prometheus/alerts.yml](../monitoring/prometheus/alerts.yml)
- [monitoring/alertmanager/alertmanager.yml](../monitoring/alertmanager/alertmanager.yml)
- [monitoring/grafana/dashboards/polyweather-overview.json](../monitoring/grafana/dashboards/polyweather-overview.json)

## 3. 启动

```bash
docker compose --profile monitoring up -d polyweather_prometheus polyweather_alertmanager polyweather_alert_relay polyweather_grafana
```

默认端口：

- Prometheus: `9090`
- Alertmanager: `9093`
- Grafana: `3001`
- Alert relay: `9099`

## 4. 环境变量

在 [.env.example](../.env.example) 里新增了这些配置：

```env
POLYWEATHER_PROMETHEUS_PORT=9090
POLYWEATHER_ALERTMANAGER_PORT=9093
POLYWEATHER_ALERT_RELAY_PORT=9099
POLYWEATHER_GRAFANA_PORT=3001
POLYWEATHER_GRAFANA_ADMIN_USER=admin
POLYWEATHER_GRAFANA_ADMIN_PASSWORD=polyweather
POLYWEATHER_MONITORING_ALERT_CHAT_IDS=
```

说明：

- `POLYWEATHER_MONITORING_ALERT_CHAT_IDS` 为空时，relay 会自动回退到：
  - `TELEGRAM_CHAT_IDS`
  - `TELEGRAM_CHAT_ID`
- 告警发送仍复用现有 `TELEGRAM_BOT_TOKEN`

## 5. 当前告警规则

当前默认规则：

- `PolyWeatherWebDown`
- `PolyWeatherHttp5xxBurst`
- `PolyWeatherHighSourceErrorRate`
- `PolyWeatherOpenMeteoCooldownLoop`
- `PolyWeatherSlowHttpAverage`

规则文件：

- [monitoring/prometheus/alerts.yml](../monitoring/prometheus/alerts.yml)

## 6. 当前 Grafana 面板

预置了一个最小仪表板：

- `PolyWeather Overview`

包含这些图：

- HTTP Requests by Status
- HTTP Latency
- Source Requests by Outcome
- Source Error Rate (15m)

## 7. 巡检脚本

手动巡检：

```bash
python scripts/check_ops_health.py --base-url http://127.0.0.1:8000
```

这个脚本会检查：

- `/healthz`
- `/api/system/status`
- `/metrics`

任何一项失败都会非零退出，适合挂到 crontab 或 systemd timer。

## 8. 当前内置运行态观测

除了 Prometheus / Grafana 这套外部监控，当前后端还内置了更贴业务的只读运行态：

- `/api/system/status`
- `/ops`

目前已覆盖：

- `prewarm` worker 是否启用、线程 / heartbeat 是否活着
- 最近一轮 prewarm 的：
  - `cycle_count`
  - `success_count / failure_count`
  - `last_started_at / last_finished_at`
  - `last_summary_ok / last_detail_ok / last_market_ok`
- 缓存桶条目数：
  - `api_cache`
  - `metar`
  - `taf`
  - `nmc`
  - `settlement`
  - `open_meteo forecast / ensemble / multi-model`
- `summary` 分析缓存命中率：
  - `total_requests`
  - `cache_hits / cache_misses`
  - `hit_rate / miss_rate`

这意味着：

- 外部监控负责“服务活没活、错误有没有暴增”
- `/ops` 和 `/api/system/status` 负责“预热有没有真的跑、缓存有没有真的被打热”

## 9. 备注

这套监控现在已经具备：

- 外部抓取
- 告警规则
- Telegram 推送
- 趋势面板
- 巡检脚本

但它仍是“最小可用版”，还没有覆盖：

- 节点级 CPU / 内存 / 磁盘
- 数据库体积趋势
- 更细粒度支付指标
- 按城市/来源拆分的业务 SLA
