# 市场监控频道 — Rust 独立网页版

## 架构

```
浏览器 http://VPS:3001
    │
    ▼
Rust 独立进程 (Axum + Askama + HTMX)
    │ 直接读 SQLite
    ▼
polyweather.db  ← Python 采集管道写入
    └ airport_obs_log 表
    └ deb_predictions 表（今日最高实测）
```

零 Python 依赖。Rust 直接从 SQLite 拿温度数据，自给自足。

## 技术选型

| 层 | 库 | 理由 |
|---|---|---|
| HTTP 服务 | **Axum** 0.8 | Tokio 生态，类型安全路由 |
| 模板引擎 | **Askama** 0.12 | 编译期检查模板，零运行时开销 |
| SQLite | **rusqlite** | 读 airport_obs_log 拿温度趋势 |
| 自动更新 | **HTMX** | 一个 `<script>` 标签，`hx-get` + `hx-trigger` 轮询 |
| 样式 | 手写 CSS | 暗色主题，无框架依赖 |

编译出来 ~10MB 二进制，内存 < 25MB。

## 展示字段（精简）

| 字段 | 来源 | 说明 |
|------|------|------|
| 城市名 + 机场名 | config 写死 | 11 个城市固定映射 |
| 当地时间 | 后台实时计算 | UTC + 时区偏移 |
| 当前温度 | `airport_obs_log` 最近一条 | 大字显示 |
| 今日实测最高 | DB 或配置文件 | 日常刷新 |
| 趋势 | 最近 6 条 obs 线性拟合 | 升 ↑ / 降 ↓ / 平 → |
| 跑道温度 | 首尔/釜山 AMOS 数据 | 有多条跑道时展示 |
| 新高温标记 | 当前 >= 今日最高 + 0.3 | 蓝紫色角标 |

## 页面布局

一屏扫完 11 城。

```
┌──────────────────────────────────────────────────────────────────┐
│  🔥 市场监控                                  刷新 14:30:00     │
├──────────────────────────────────────────────────────────────────┤
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│ │ 首尔 / Incheon   │ │ 东京 / Haneda    │ │ 釜山 / Gimhae    │  │
│ │   13:30 KST      │ │   14:30 JST      │ │   14:30 KST      │  │
│ │                  │ │                  │ │                  │  │
│ │    28.5°C        │ │    31.2°C  ◆新高 │ │    25.8°C   ↓    │  │
│ │ 今日最高 29.1°C  │ │ 今日最高 31.2°C  │ │ 今日最高 26.5°C  │  │
│ │       ↑          │ │       ↑          │ │                  │  │
│ │                  │ │                  │ │                  │  │
│ │ 18L/36R  28.5°C  │ │                  │ │ 18L/36R  25.8°C  │  │
│ │ 18R/36L  27.9°C  │ │                  │ │ 18R/36L  25.1°C  │  │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘  │
│                                                                  │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│ │ 安卡拉 / Esenboğa│ │赫尔辛基 / Vantaa │ │阿姆斯特丹/Schiphol│  │
│ │   ...            │ │   ...            │ │   ...            │  │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘  │
│                                                                  │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│ │伊斯坦布尔/Airport│ │ 巴黎 /Le Bourget │ │ 香港 / Observatory│  │
│ │   ...            │ │   ...            │ │   ...            │  │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘  │
│                                                                  │
│ ┌──────────────────┐ ┌──────────────────┐                       │
│ │ 流浮山/LauFauShan│ │ 台北 / Songshan  │                       │
│ │   ...            │ │   ...            │                       │
│ └──────────────────┘ └──────────────────┘                       │
└──────────────────────────────────────────────────────────────────┘
```

### 单张卡片

```
┌──────────────────────────────┐
│  首尔  / Incheon             │  ← 城市名 / 机场名
│  13:30 KST                   │  ← 当地时间
│                              │
│          28.5°C              │  ← 大字当前温度
│                              │
│  今日最高 29.1°C    ↑        │  ← 最高温 + 趋势箭头
│                              │
│  ── 跑道 ──                  │  ← 首尔/釜山有
│  18L/36R    28.5°C           │
│  18R/36L    27.9°C           │
└──────────────────────────────┘
```

温度较高或触达新高时，温度数字用暖色高亮。趋势指示用箭头（↑ 绿色 / ↓ 蓝色 / → 灰色）。

## 数据源

直接读 SQLite `airport_obs_log` 表：

```sql
SELECT temp_c, obs_time, created_at
FROM airport_obs_log
WHERE icao = ? AND created_at > datetime('now', '-2 hours')
ORDER BY created_at DESC
LIMIT 12;
```

- 最新一条 → 当前温度
- 最近 6 条 → 算趋势（线性拟合斜率）
- 今日最高从 DB 或单独配置拿

11 个城市的 ICAO 映射写死在 Rust config 里（与 telegram_push.py 一致）：

```rust
const CITIES: &[(&str, &str, &str, &str, i32)] = &[
    ("seoul",    "首尔",       "RKSI",   "Incheon",       9),
    ("busan",    "釜山",       "RKPK",   "Gimhae",        9),
    ("tokyo",    "东京",       "44166",  "Haneda",        9),
    ("ankara",   "安卡拉",     "17128",  "Esenboğa",      3),
    ("helsinki", "赫尔辛基",   "EFHK",   "Vantaa",        3),
    ("amsterdam","阿姆斯特丹", "EHAM",   "Schiphol",      2),
    ("istanbul", "伊斯坦布尔", "17058",  "Airport",       3),
    ("paris",    "巴黎",       "LFPB",   "Le Bourget",    2),
    ("hong kong","香港",       "HKO",    "Observatory",   8),
    ("lau fau shan","流浮山",  "LFS",    "Lau Fau Shan",  8),
    ("taipei",   "台北",       "466920", "Songshan",      8),
];
```

## Rust 项目结构

```
monitoring-web/           ← 放在 PolyWeather 仓库根目录下
├── Cargo.toml
├── src/
│   ├── main.rs           ← Axum 启动，路由注册
│   ├── db.rs             ← SQLite 查询（rusqlite）
│   ├── model.rs          ← CitySnapshot 数据结构
│   ├── trend.rs          ← 温度趋势计算
│   └── templates/
│       └── monitor.html  ← Askama 模板（完整页面）
└── static/
    └── style.css
```

### `Cargo.toml`

```toml
[package]
name = "market-monitor"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.8"
tokio = { version = "1", features = ["full"] }
askama = { version = "0.12", features = ["with-axum"] }
rusqlite = { version = "0.32", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
tower-http = { version = "0.6", features = ["fs"] }
tracing = "0.1"
tracing-subscriber = "0.3"
chrono = "0.4"
```

### 核心逻辑伪代码

```rust
// main.rs
#[tokio::main]
async fn main() {
    let db_path = std::env::var("POLYWEATHER_DB_PATH")
        .unwrap_or_else(|_| "data/polyweather.db".into());
    let state = Arc::new(AppState { db_path });

    let app = Router::new()
        .route("/", get(index))           // 完整页面
        .route("/api/data", get(cards))   // HTMX 轮询
        .nest_service("/static", ServeDir::new("static"))
        .with_state(state);

    let addr = std::env::var("MONITOR_LISTEN_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:3001".into());
    tracing::info!("市场监控: http://{}", addr);
    axum::serve(TcpListener::bind(&addr).await.unwrap(), app).await.unwrap();
}

// GET / → 渲染完整 HTML 页面
async fn index(state: State<Arc<AppState>>) -> Html<String> {
    let cities = load_all_cities(&state.db_path).await;
    let tmpl = MonitorTemplate { cities, full_page: true };
    Html(tmpl.render().unwrap())
}

// GET /api/data → HTMX 轮询，只返回卡片网格（无完整 HTML 壳）
async fn cards(state: State<Arc<AppState>>) -> Html<String> {
    let cities = load_all_cities(&state.db_path).await;
    let tmpl = MonitorTemplate { cities, full_page: false };
    Html(tmpl.render().unwrap())
}
```

### DB 查询

```rust
// db.rs
fn get_recent_obs(db_path: &str, icao: &str, limit: usize) -> Vec<Obs> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT temp_c, obs_time, created_at
         FROM airport_obs_log
         WHERE icao = ?1 AND created_at > datetime('now', '-3 hours')
         ORDER BY created_at DESC
         LIMIT ?2"
    )?;
    // ...
}
```

### 趋势计算

```rust
// trend.rs
enum Trend { Rising, Falling, Flat }

fn calc_trend(obs: &[Obs]) -> Trend {
    // 最近 6 条温度做线性回归
    // 斜率 > +0.2 → Rising (↑)
    // 斜率 < -0.2 → Falling (↓)
    // 否则 → Flat (→)
}
```

### HTMX 轮询

```html
<!-- monitor.html -->
<div id="card-grid"
     hx-get="/api/data"
     hx-trigger="every 60s"
     hx-swap="outerHTML"
     hx-indicator="#spinner">
  {% for city in cities %}
  <div class="card">
    <!-- 卡片内容 -->
  </div>
  {% endfor %}
</div>
<div id="spinner" class="htmx-indicator">刷新中...</div>
```

HTMX 从 CDN 加载，一个 `<script>` 标签搞定。

## 部署

```bash
cd monitoring-web
cargo build --release

# 环境变量
export POLYWEATHER_DB_PATH=/var/lib/polyweather/polyweather.db
export MONITOR_LISTEN_ADDR=0.0.0.0:3001

./target/release/market-monitor &
```

systemd unit 或 supervisor 托管即可。不占资源，VPS 上完全无感。

## 与 Push 的对比

| | Telegram Push | 网页监控 |
|---|---|---|
| 目的 | 精准触达：该不该发消息 | 全景扫描：一眼看 11 城 |
| 逻辑 | DEB + 三条件 + 去重 | 温度 + 趋势 + 最高 |
| 频率 | 条件触发 | 60s 轮询 |
| 数据源 | `_analyze()` 完整分析 | SQLite 直接读 |
| 用户 | 频道订阅者 | 打开网页的任何人 |

两者互补，不冲突。Push 仍然跑，网页给想主动扫一眼的人。
