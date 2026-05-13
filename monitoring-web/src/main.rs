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
// (city_key, display_name, icao, airport_en, utc_offset_hours, threshold)
const CITIES: &[(&str, &str, &str, &str, i32, f64)] = &[
    ("seoul", "首尔", "RKSI", "Incheon", 9, 3.0),
    ("busan", "釜山", "RKPK", "Gimhae", 9, 2.0),
    ("tokyo", "东京", "44166", "Haneda", 9, 2.0),
    ("ankara", "安卡拉", "17128", "Esenboğa", 3, 3.0),
    ("helsinki", "赫尔辛基", "EFHK", "Vantaa", 3, 2.0),
    ("amsterdam","阿姆斯特丹","EHAM","Schiphol",2,2.0),
    ("istanbul","伊斯坦布尔","17058","Airport",3,3.0),
    ("paris", "巴黎", "LFPB", "Le Bourget", 2, 3.0),
    ("hong kong","香港","HKO","Observatory",8,1.5),
    ("lau fau shan","流浮山","LFS","Lau Fau Shan",8,1.5),
    ("taipei", "台北", "466920", "Songshan", 8, 1.5),
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

fn load_city_snapshot(db_path: &str, (key, display, icao, airport, tz, thresh): &(&str, &str, &str, &str, i32, f64)) -> CitySnapshot {
    let now_utc = Utc::now();
    let local = now_utc + chrono::Duration::hours(*tz as i64);
    let local_time = local.format("%H:%M").to_string();

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

    // For AMOS cities, we'd need runway data from a different DB table.
    // Simplified: no runway pairs for now; can be added later.
    let runway_pairs: Vec<(String, f64)> = vec![];

    CitySnapshot {
        name: key.to_string(),
        display_name: display.to_string(),
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
    }
}

fn load_all_cities(db_path: &str) -> Vec<CitySnapshot> {
    CITIES
        .iter()
        .map(|c| load_city_snapshot(db_path, c))
        .collect()
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

// ── main ──

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
