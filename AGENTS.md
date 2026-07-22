# PolyWeather Agent Instructions

## 沟通

- 默认用中文回复。直接说在做什么、查到什么、下一步。
- 每个具体任务用独立 Thread，避免旧上下文污染新任务。

## 项目结构

```
E:\web\PolyWeather
├── web/                 # FastAPI 后端 (app.py → create_app)
├── src/                 # Python 核心库 (analysis, data_collection, bot, database, payments)
├── tests/               # pytest (85 个文件)
├── frontend/            # Next.js 15 + React 19 + TypeScript
├── scripts/             # 运维/工具脚本 (Python)
├── deploy.sh            # VPS 部署脚本
├── docker-compose.yml   # 6+ 服务: web, frontend, bot, collector, warmer, training, weathernext2
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

- Docker Compose 多服务: `web` (FastAPI :8000), `frontend` (Next.js :3000), `bot` (Telegram), `collector` (观测采集), `warmer` (缓存预热), `training_settlement` (训练结算), `weathernext2_worker` (GCP WeatherNext2)
- 前端 → Nginx (反代) → Cloudflare
- SSE 实时事件: 生产用 Redis Stream, 本地可切 SQLite
- 付费墙: middleware.ts (服务端) + `ProductAccessRequired` (客户端)
- `config/` + `web/schemas/` + `web/services/` 存放共享配置和载荷构建

## 测试注意

- `python -m pytest` 跑全部（确保 requirements-dev.lock 已装）
- 前端测试仅 `npm run test:business`（非 Jest/Vitest）
- 配置文件参考 `docs/CONFIGURATION_ZH.md` 和 `.env.example`

## CI/CD

`main` push 触发: `python-quality` → `frontend-quality` → `build-and-push` (GHCR) → `deploy` (VPS via SSH)
推送后检查 GitHub Actions 状态 + smoke test: `api.polyweather.top/healthz` + `polyweather.top/`
