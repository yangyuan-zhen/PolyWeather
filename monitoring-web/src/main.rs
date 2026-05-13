mod db;
mod model;
mod trend;

use std::sync::Arc;

use askama_axum::Template;
use axum::{
    extract::State,
    response::{Html, IntoResponse},
    routing::get,
    Router,
};
use chrono::Utc;
use model::CitySnapshot;
use tower_http::services::ServeDir;
use tracing_subscriber;

// ── city config ──
// (key, zh_name, en_name, icao, airport_en, utc_offset_hours, threshold, tz_abbr, runway_count)
const CITIES: &[(&str, &str, &str, &str, &str, i32, f64, &str, usize)] = &[
    ("seoul", "首尔", "Seoul", "RKSI", "Incheon", 9, 3.0, "KST", 2),
    ("busan", "釜山", "Busan", "RKPK", "Gimhae", 9, 2.0, "KST", 2),
    ("tokyo", "东京", "Tokyo", "44166", "Haneda", 9, 2.0, "JST", 0),
    ("ankara", "安卡拉", "Ankara", "17128", "Esenboğa", 3, 3.0, "TRT", 0),
    ("helsinki", "赫尔辛基", "Helsinki", "EFHK", "Vantaa", 3, 2.0, "EEST", 0),
    ("amsterdam","阿姆斯特丹","Amsterdam","EHAM","Schiphol",2,2.0,"CEST", 0),
    ("istanbul","伊斯坦布尔","Istanbul","17058","Airport",3,3.0,"TRT", 0),
    ("paris", "巴黎", "Paris", "LFPB", "Le Bourget", 2, 3.0, "CEST", 0),
    ("hong kong","香港","Hong Kong","HKO","Observatory",8,1.5,"HKT", 0),
    ("lau fau shan","流浮山","Lau Fau Shan","LFS","Lau Fau Shan",8,1.5,"HKT", 0),
    ("taipei", "台北", "Taipei", "466920", "Songshan", 8, 1.5, "TST", 0),
];

// 跑道标签（与 AMOS scrape 返回的一致）
const RUNWAY_LABELS: &[&[&str]] = &[
    &["18L/36R", "18R/36L"],  // seoul
    &["18L/36R", "18R/36L"],  // busan
];

// ── app state ──
struct AppState {
    db_path: String,
}

// ── templates ──

#[derive(Template)]
#[template(path = "monitor.html")]
struct MonitorTemplate {
    cities: Vec<CitySnapshot>,
    full_page: bool,
    generated_at: String,
}

// ── data loading ──

fn load_city_snapshot(db_path: &str, idx: usize, (key, _zh, en, icao, airport, tz, thresh, tz_abbr, rw_count): &(&str, &str, &str, &str, &str, i32, f64, &str, usize)) -> CitySnapshot {
    let now_utc = Utc::now();
    let local = now_utc + chrono::Duration::hours(*tz as i64);
    let local_time = format!("{} {}", local.format("%H:%M"), tz_abbr);

    // Recent obs for temp + trend
    let obs = db::get_recent_obs(db_path, icao, 120, 12);
    let temps: Vec<f64> = obs.iter().filter_map(|o| o.temp_c).collect();
    let current_temp = temps.first().copied();

    // Age of most recent observation
    let obs_age_min = obs.first().and_then(|o| {
        o.created_at.as_ref().and_then(|ts| {
            chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S")
                .ok()
                .map(|dt| {
                    let obs_utc = dt.and_utc();
                    (now_utc - obs_utc).num_minutes().max(0)
                })
        })
    });

    // Trend from last 6 points
    let trend_data: Vec<f64> = temps.iter().take(6).copied().collect();
    let trend = trend::calc_trend(&trend_data);

    // Today's max: max of all temps in recent window (approximation)
    let today_max = temps.iter().cloned().fold(None::<f64>, |a, b| {
        Some(a.map_or(b, |x| x.max(b)))
    });
    let new_high = match (current_temp, today_max) {
        (Some(ct), Some(tm)) => ct >= tm + 0.3,
        _ => false,
    };

    // Runway data: query each runway ICAO
    let mut runway_pairs: Vec<(String, f64)> = vec![];
    if *rw_count > 0 && idx < RUNWAY_LABELS.len() {
        for i in 0..*rw_count {
            let rw_icao = format!("{}_RWY_{}", icao, i);
            let rw_obs = db::get_recent_obs(db_path, &rw_icao, 120, 1);
            if let Some(rw_temp) = rw_obs.first().and_then(|o| o.temp_c) {
                let label = RUNWAY_LABELS[idx].get(i).unwrap_or(&"?").to_string();
                runway_pairs.push((label, rw_temp));
            }
        }
    }

    CitySnapshot {
        name: key.to_string(),
        en_name: en.to_string(),
        airport: airport.to_string(),
        icao: icao.to_string(),
        local_time,
        current_temp,
        today_max,
        max_time: None,
        trend,
        new_high,
        runway_pairs,
        gap: None,
        threshold: *thresh,
        time_ok: false,
        temp_ok: false,
        trend_ok: false,
        in_window: false,
        obs_age_min,
        temp_warm: current_temp.map_or(false, |t| t >= 30.0),
    }
}

fn load_all_cities(db_path: &str) -> Vec<CitySnapshot> {
    let mut cities: Vec<CitySnapshot> = CITIES
        .iter()
        .enumerate()
        .map(|(i, c)| load_city_snapshot(db_path, i, c))
        .collect();
    // 按当前温度从高到低排序，无数据的排最后
    cities.sort_by(|a, b| {
        b.current_temp
            .partial_cmp(&a.current_temp)
            .unwrap_or(std::cmp::Ordering::Less)
    });
    cities
}

// ── routes ──

async fn index(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let cities = load_all_cities(&state.db_path);
    let tmpl = MonitorTemplate {
        cities,
        full_page: true,
        generated_at: Utc::now().format("%H:%M:%S UTC").to_string(),
    };
    Html(tmpl.render().unwrap_or_else(|e| format!("Template error: {e}")))
}

async fn api_data(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let cities = load_all_cities(&state.db_path);
    let tmpl = MonitorTemplate {
        cities,
        full_page: false,
        generated_at: Utc::now().format("%H:%M:%S UTC").to_string(),
    };
    Html(tmpl.render().unwrap_or_else(|e| format!("Template error: {e}")))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let db_path = std::env::var("POLYWEATHER_DB_PATH")
        .unwrap_or_else(|_| "/var/lib/polyweather/polyweather.db".into());
    let listen = std::env::var("MONITOR_LISTEN_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:3001".into());

    tracing::info!("DB path: {db_path}");
    tracing::info!("市场监控页面: http://{listen}");

    let state = Arc::new(AppState { db_path });

    let app = Router::new()
        .route("/", get(index))
        .route("/api/data", get(api_data))
        .nest_service("/static", ServeDir::new("static"))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&listen).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
