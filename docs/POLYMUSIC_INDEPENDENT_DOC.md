# 🎵 PolyMusic: 音乐市场量化分析系统 - 独立开发文档

## 1. 项目定位

PolyMusic 是一个独立的量化分析系统，旨在通过聚合 **流媒体实测数据 (Spotify/Apple Music)**、**社交媒体前置信号 (TikTok/YouTube)** 和 **行业动态 (Awards/Releases)**，为音乐相关的预测市场提供精准的决策分析。

---

## 2. 核心架构设计

### A. 数据采集层 (The Data Feed)

- **Spotify Scanner**:
  - 每日定时抓取 Global & US Top 200 榜单。
  - 提取字段：Track Name, Artist, Daily Streams, Position, Previous Position.
- **Viral Tracker (前哨信号)**:
  - 监控 TikTok 热门音频趋势图，追踪 BGM 使用量增幅 (Acceleration)。
  - 监控 YouTube Trending 榜单。
- **Contextual Hub (行业动态)**:
  - 重大活动日历：超级碗、格莱美、科切拉音乐节、主流艺人回归预热。

### B. 分析引擎 (The Trend Engine)

- **Accumulation Solver (积分缺口分析)**:
  - 专门针对“周榜”市场。根据当前已消耗的天数，计算出各候选人要反超第一名所需的每日平均流值及其标准差。
- **Decay Controller (热度半衰期计算)**:
  - 为突发热点（如夺金表演、空降 MV）建立衰减曲线记录。判断当前的高流值是“单日冲击”还是“长期阶跃”。
- **Consensus Tracker**:
  - 对比 Kworb, Billboard 预测与 Polymarket 赔率的偏差 (MAE)。

### C. AI 决策层 (Groq LLaMA 3.3 70B)

- **Prompt 逻辑框架**:
  - **P0 (Event Trigger)**: 是否有头部艺人突然在 Instagram/Twitter 进行大规模预热或空降。
  - **P1 (Viral Drift)**: 该歌曲的传播是否已由于某个非音乐事件（体育、电影、社交媒体挑战）出现斜率阶跃。
  - **P2 (Consistency Check)**: 预测市场的价格波动是否与目前观察到的流值增长率相匹配。

---

## 3. 技术栈建议

- **Backend**: Python 3.11+ (FastAPI)
- **Database**: SQLite (存储每日流值与历史 MAE)
- **AI Engine**: Groq SDK (LLaMA 3.3 70B)
- **Crawler**: Requests / BeautifulSoup / Selenium (用于绕过部分动态频率限制)

---

## 4. 目录结构预览 (Independent Project)

```text
PolyMusic/
├── src/
│   ├── data/            # 爬虫与数据采集
│   │   ├── spotify.py
│   │   ├── tiktok.py
│   │   └── billboard.py
│   ├── analysis/        # 核心算法
│   │   ├── accumulation.py
│   │   └── decay_model.py
│   └── ai/              # AI 决策管线
│       └── prompt_engine.py
├── data/                # 本地存储 (JSON/SQLite)
├── web/                 # 可视化面板 (类似于 PolyWeather Map)
├── bot_listener.py      # Telegram 交互入口
└── requirements.txt
```

---

## 5. 核心博弈指标 (KPIs)

- **Stream Gap (流值缺口)**：反超所需最低日均流值。
- **Momentum Coefficient (动能系数)**：流值增长的二阶导数。
- **Price Inaccuracy (定价误差)**：Polymarket 赔率与量化结果的期望偏差。

---

## 6. 下一步动作

1. 初始化项目结构。
2. 优先攻克 Spotify 每日 Top 200 的数据持久化（通过爬虫或自动化工具）。
3. 建立第一个周榜计算模型，并在本周五（3月6日结算日）进行实战对账。

---

_Document created for independent project initialization on 2026-03-04_
