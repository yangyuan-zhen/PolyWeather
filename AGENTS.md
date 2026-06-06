# PolyWeather Agent Instructions

## 语言和沟通

- 默认用中文回复用户。
- 直接说明正在做什么、查到了什么、下一步是什么；不要写空泛客套话。
- 如果用户要求“提交推送”“部署”“看日志”，必须在本地验证后再提交、推送，并检查 GitHub Actions 或线上状态。
- 不要把多个不相关任务混在一个结论里；遇到新方向时，建议用户在同一个 Project 下开新 Thread。

## 项目和线程使用

- 一个 Project 对应 PolyWeather 这个共享代码库和长期方向。
- 每个具体任务使用一条独立 Thread / Chat，例如：
  - 落地页与产品包装
  - 观测数据采集与 SSE patch
  - Telegram 推送
  - 付款与会员
  - 部署、CI、服务器状态
- 同一个 Project 下的 Thread 共享文件夹和 `AGENTS.md`，但上下文分开，避免旧问题影响新任务判断。

## 代码工作原则

- 先读现有代码和配置，再改动；优先沿用项目已有模式。
- 使用 `rg` / `rg --files` 查找文件和文本。
- 手动编辑文件使用 `apply_patch`。
- 不要回滚用户或其他 agent 已经做过的无关改动。
- 只改和当前任务直接相关的文件，避免顺手重构。
- 新增复杂逻辑时补充聚焦测试；窄改动保持验证范围匹配风险。

## 前端约定

- 前端位于 `frontend/`，使用 Next.js、React、TypeScript。
- UI 修改必须关注移动端响应式、文本不重叠、按钮和标签不溢出。
- 图表、终端、详情面板等工作界面应保持信息密度和可扫描性，避免营销式装饰。
- 常用验证：
  - `cd frontend && npm run test:business`
  - `cd frontend && npm run typecheck`
  - 必要时启动本地预览并用浏览器检查桌面和移动视口；检查完关闭本地端口。

## 后端和数据约定

- Python 代码主要位于 `src/`、`web/`、`tests/`。
- 观测数据刷新应以数据源原生频率为准，避免 Web、collector、Telegram 同时强刷同一外部源。
- Telegram 默认只读最新缓存/DB；除非完全没有缓存，才允许兜底刷新。
- 对外部源调用要考虑 singleflight、冷却、缓存和失败降级，避免 502/408 或 Supabase/磁盘 IO 压力。
- 常用验证：
  - `python -m ruff check .`
  - `python -m pytest`

## CI、提交和部署

- `main` push 会触发 `.github/workflows/ci.yml`：
  - `python-quality`
  - `frontend-quality`
  - `build-and-push`
  - `deploy`
- 提交前至少运行和改动相关的验证；推送前确认 `git status --short`。
- 推送后检查 GitHub Actions 最新 run；如果失败，先定位失败 job 和 step，再修改。
- 线上 smoke check 优先检查：
  - `https://api.polyweather.top/healthz`
  - `https://polyweather.top/`
  - 相关页面或 API 路径

## 产品方向备忘

- PolyWeather 当前重点不是售卖 API。
- 核心差异化是结算源优先、实时观测源、跑道/城市细粒度温度、SSE patch、Telegram 缓存读取和面向交易/预测市场的解释能力。
- 公开包装、教育内容、图表变量完整度和付费分层可以加强，但不要把产品定位改成通用天气 API。

## Memory 说明

- `AGENTS.md` 是项目内显式规则，跟随仓库和 Project。
- Memory 是用户账号级偏好设置，agent 不能代替用户开启。
- 建议在 Codex / ChatGPT 设置中开启 Memory，并保存长期偏好，例如：
  - PolyWeather 项目默认中文回复。
  - 每个任务开独立 Thread。
  - 修改后优先验证、提交、推送并检查部署状态。
  - 不要主动把 PolyWeather 包装成 API 售卖产品。
