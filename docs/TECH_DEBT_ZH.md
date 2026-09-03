# 技术债与工程待办（v1.9.0）

最后更新：`2026-08-01`

目标：在收费上线后，优先保证状态一致性、支付可靠性、可观测性和概率引擎发布可控。

## 1. 债务快照

当前估计：**97% 稳定 / 3% 技术债**。前端设计系统债务已在 v1.6.0 全面消除，监控栈已在 v1.9.0 收敛为轻量链路。

```mermaid
flowchart TD
    A["技术债"]

    subgraph P["支付与订阅"]
        P1["合约 V2 升级（SafeERC20 / Pausable）"]
        P2["退款工单完整流程"]
    end

    subgraph E["权限与运营"]
        E1["前后端/Bot 权限矩阵回归"]
        E2["积分来源明细前端展示"]
    end

    subgraph O["可观测性"]
        O1["VPS 侧自建 /metrics 抓取与告警（可选）"]
    end

    A --> P
    A --> E
    A --> O
```

## 2. 近期已关闭

- **前端设计系统工程债务（2026-05-10）**：消除 !important 滥用（134→49）、统一断点体系（18→10）、数百处硬编码颜色迁移至 CSS 变量、修复 accent-green 蓝色 Bug、添加 ARIA 无障碍属性、去重 @keyframes、移除死代码（1,697 行）。详见 `docs/reviews/frontend-ui-design-review.md`。
- 支付主链路已上线（intent -> submit -> confirm）。
- 支付自动补单已上线（Event Loop + Confirm Loop，循环参数可配置）。
- 支付事件重放脚本已补齐。
- 支付运行态 API 与 SQLite 审计事件已补齐。
- 钱包绑定支持浏览器钱包 + WalletConnect。
- 账户中心与 Pro 权限展示链路打通。
- 运行态状态/缓存与核心离线训练、评估、回填链路已完成 SQLite 主路径收口。
- 轻量可观测性已上线（`/healthz`、`/api/system/status`、`/api/system/cache-status`、`/api/system/priority-warm`、`/metrics` + `scripts/check_ops_health.py`）。
- **DEB 正态概率引擎（2026-08-01）**：`deb_normal` 取代 legacy 高斯分桶成为主概率路径，legacy 保留为回退分支。
- **训练结算服务（2026-08-01）**：`training_settlement` 服务（6h 周期、回看 10 天）与领域仓库重构（`src/database/repos/`）。
- **数据源清理（2026-08-01）**：移除 Wunderground、台北 CWA、AMSC AWOS、NMC/CMA；深圳改挂流浮山 HKO（LFS）；结算源收敛为 NOAA Synoptic（11 城）+ HKO（2 城）+ IMGW（可选）；TAF 唯一来源 NOAA AviationWeather。
- **监控栈收敛（2026-08-01）**：移除 Prometheus / Alertmanager / Alert Relay / Grafana 四组件与 `monitoring/` 目录，监控收敛为 FastAPI 轻量端点 + 巡检脚本。

## 2.5 观测可靠性专项已关闭（2026-09）

- 统一数据质量层：`src/data_collection/data_quality.py`（`evaluate_observation`/`guard_observation`），`status` 六态 `fresh/delayed/stale/invalid/source_error/fallback`，`API/collector/前端` 共用同一口径；`_observation_block` 不再写死 `fresh`
- 异常保护：时间戳倒退/未来/越界/跳变/重复/NaN 在 `observation_repo` 落库前拦截并 `warning` 留痕；`canonical` 候选过滤非有限温度；`collector` 按 `record` 与按 `city` 双层隔离
- 健康快照：`GET /api/system/data-quality`（`web/services/data_quality_api.py`）输出 `51` 城 `source/station/age/status/fallback/last_error`，`Ops/系统状态` 页新增数据质量卡片；巡检 `scripts/check_data_quality.py` 只读，`exit 0/1/2`
- 机器可读映射：`config/city_datasource_map.json` 由 `scripts/generate_city_datasource_map.py` 从 `CITY_REGISTRY` 生成（`51` 城）
- 冲突修正：`FAHRENHEIT_CITIES 6→11` 与 `registry.use_fahrenheit` 对齐；`SETTLEMENT_SOURCE_LABELS` 补 `IMS/NCM/AEROWEB`；`DATA_SOURCES` 去深圳 Tier4 重复行并澄清巴黎 AROME 非实测

## 3. 高优先级技术债

| 项目 | 影响 | 建议动作 |
| :-- | :-- | :-- |
| 退款与售后链路 | 商业闭环不完整 | 基于现有 `/api/ops/refunds` 端点补齐工单状态机与前端入口 |

## 4. 中优先级技术债

| 项目 | 影响 | 建议动作 |
| :-- | :-- | :-- |
| 积分发放可解释性 | 用户理解成本高 | 输出积分来源明细前端展示（后台人工补发/反馈奖励/积分抵扣消费） |
| 支付合约 V2 升级 | 当前仍是最小可用合约 | 升级到 SafeERC20 + Pausable + plan 绑定 |
| 支付失败文案标准化 | 转化率受影响 | 建立错误码 -> 文案映射表 |

## 5. 低优先级技术债

| 项目 | 影响 | 建议动作 |
| :-- | :-- | :-- |
| 前端离线缓存能力 | 非核心 | 评估 Service Worker + IndexedDB |
| 冷启动波动 | 首屏抖动 | 热点城市预热（`/api/system/priority-warm` 已提供手动触发入口） |
| VPS 侧指标抓取 | 轻量端点已够用 | 如需趋势面板，可在 VPS 自建 Prometheus 抓取 `/metrics`（后端无需改动） |

## 6. 下阶段里程碑

1. 评估并推进支付合约 V2 升级。
2. 补齐退款工单状态机与前端入口。
3. 积分来源明细前端展示。
