# PolyWeather 商业化技术升级草案

## 1. 核心目标

将 PolyWeather 从单人工具转型为支持多用户的 SaaS 产品。

## 2. 架构调整 (Architecture Upgrade)

### 2.1 用户与订阅系统 (Auth & Sub)

- **前端**: 增加 Login 模态框，支持 Telegram 一键登录。
- **后端 (FastAPI)**: 增加用户数据库 (`users` 表)，存储 `telegram_id`, `subscription_status`, `expiry_date`。
- **权限中间件**: 拦截未经授权的实时 API 请求。

### 2.2 网页功能增强 (Web Premium)

- **实时性**: 付费用户 30s 刷新一次，免费用户 15min 刷新。
- **专业视图**: 增加各模型历史 MAE (平均绝对误差) 实时排行榜，让用户知道安卡拉今天该信 MGM 还是 GFS。
- **推送配置**: 允许用户在网页端订阅特定城市的“突破预警”。

### 2.3 电报机器人深度集成 (Bot Monitization)

- **邀请管理**: 自动生成独一无二的支付链接或入群链接。
- **私人简报**: 每小时向 $1 订阅用户私聊发送其关注城市的“结算风险报告”。

## 3. 支付方案 (Payment Integration)

- **Polygon (USDC)**: 完美契合 Polymarket 生态。
- **逻辑**: 用户转账 -> Webhook 回调 -> 自动激活账户权限。

## 4. 商业化阶段

- **Phase 1 (Beta)**: 邀请制内测，验证安卡拉等重点城市的数据准确性。
- **Phase 2 (MVP)**: 上线手动支付激活模式（人工进群）。
- **Phase 3 (Full)**: 全自动 Web3 登录 + USDC 支付 + 自动入群。
