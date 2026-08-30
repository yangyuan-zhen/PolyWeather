# PolyWeather Agent Instructions

## 沟通

- 默认用中文回复。直接说在做什么、查到什么、下一步。
- 每个具体任务用独立 Thread，避免旧上下文污染新任务。

## 项目结构

```
E:\web\PolyWeather
├── web/                 # FastAPI 后端 (app.py → create_app)
├── src/                 # Python 核心库 (analysis, data_collection, bot, database, payments)
├── tests/               # pytest (74 个文件)
├── frontend/            # Next.js 15 + React 19 + TypeScript
├── scripts/             # 运维/工具脚本 (Python)
├── deploy.sh            # VPS 部署脚本
├── docker-compose.yml   # 7 服务: web, frontend, bot, collector, warmer, training_settlement, redis
├── bot_listener.py      # Telegram 机器人入口
├── run.py               # 机器人启动脚本 (调用 bot_listener.py)
├── pyproject.toml       # ruff 配置: E/F rules, line-length=88, py311
├── pytest.ini           # testpaths = tests
└── .github/workflows/ci.yml
```

## 关键命令

```bash
# 后端
ruff check .                    # lint
ruff format .                   # 格式化
python -m pytest                # 跑全部测试
python -m pytest tests/test_xxx.py  # 单个测试文件
uvicorn web.app:app --reload --host 0.0.0.0 --port 8000  # 开发服务器
python bot_listener.py          # Telegram 机器人

# 前端 (cd frontend)
npm run dev                     # 开发服务器 :3000 (含 sync server chunks)
npm run build                   # 生产构建
npm run typecheck               # tsc --noEmit
npm run test:business           # Playwright 业务状态测试 (19 个)
npm run lint                    # next lint

# Docker
docker compose down && docker compose up -d --build
```

## 重要约定

- **提交信息只用中文**，不要以 `@` 开头
- 依赖管理: `npm` (前端), pip + `requirements.lock` (Python, 通过 uv 生成)
- Python 3.11, ruff 仅启用 E/F 规则 (忽略 E501)
- TypeScript strict 模式, 路径别名 `@/` → `frontend/`
- CSS 变量 `var(--color-*)`，禁止 `!important`（Leaflet 地图覆写除外）
- SQLite WAL 模式 + `busy_timeout=5000`（`db_manager.py`）
- 本地开发设置 `POLYWEATHER_EVENT_STORE=sqlite` 避免依赖 Redis

## 架构要点

- Docker Compose 多服务: `web` (FastAPI :8000), `frontend` (Next.js :3000), `bot` (Telegram), `collector` (观测采集), `warmer` (缓存预热), `training_settlement` (训练结算：轮转分析 + 真值回填)
- 前端 → Nginx (反代) → Cloudflare
- SSE 实时事件: 生产用 Redis Stream, 本地可切 SQLite
- 付费墙: middleware.ts (服务端) + `ProductAccessRequired` (客户端)
- `config/` + `web/schemas/` + `web/services/` 存放共享配置和载荷构建
- DEB 训练：`train_deb_lead_stats` 按 `lead 0/1/2 × 温段 <=32/33-36/>=37` 分池，`lead` 与首快照 `deb_prediction` 均取 `intraday_path_snapshots_store` 的 `MIN(id)`（`00-08h` 所见），`temp_sigmas` 阈值 `MIN_SIGMA_SAMPLES=15` 且跨 `lead` 回退 + `pooled` 下限防过度自信；`ProbabilitySnapshot` 由 `web/analysis_service._archive_probability_snapshot` 在 `full` 分析时落库
- DB 运维：`SQLite WAL` + `busy_timeout=5000`；生产 `2GB` 库若 `PRAGMA integrity_check` 报 `Rowid out of order` 用 `REINDEX runway_obs_log/payment_audit_events`（比 `VACUUM` 轻），`intraday` 丢 `0.34%` 由 `load_earliest_deb_prediction` 批容错兜住；评估脚本 `scripts/assess_db_integrity.py` 只读 `44s` 输出 `COUNT`/`扫描` 对比

## 重要脚本

- `scripts/analyze_deb_lead_bias.py` 首快照 vs 末快照 `MAE 1.6x / sigma 1.67x` 配对分析
- `scripts/assess_db_integrity.py` 只读评估 `44s`：各表 `COUNT(*)` vs `rowid` 扫描与坏页定位
- `scripts/verify_deb_fix_sigma.py` 只读验证 `BEFORE/AFTER` 的 `lead/temp sigmas`
- `scripts/rebuild_db_from_malformed.py` 从 `prod` 备份 + `id 5000` 批跳坏页重建（仅 `intraday 0.34%` 丢行时无需停机重建）

## 试用与定价

- 新用户试用 `7 天`（`SIGNUP_TRIAL_DAYS=7`，`claim_signup_trial` 用 `interval 7 days`），`lead` 计算 `max(0, target - today_UTC)` 使线上 `lead 0` 为主流量

## 已下线

- 天气扫描终端 `web/scan_terminal_*` / `routers/scan` / `services/scan_api` 及其前端 `ScanTerminalDashboard` 已整块下线，`/terminal` 为离线占位；`deploy.sh` 已移除 `wait_for_scan_terminal_snapshot` 健康检查

## 测试注意
