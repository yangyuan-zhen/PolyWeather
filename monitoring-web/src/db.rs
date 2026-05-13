use rusqlite::Connection;

#[derive(Debug, Clone)]
pub struct ObsRow {
    pub temp_c: Option<f64>,
    #[allow(dead_code)]
    pub obs_time: Option<String>,
    pub created_at: Option<String>,
}

/// Get today's running max temperature from intraday snapshots.
pub fn get_daily_max(db_path: &str, city_key: &str) -> Option<(f64, Option<String>)> {
    let conn = Connection::open(db_path).ok()?;
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let mut stmt = conn
        .prepare(
            "SELECT max_so_far, snapshot_time FROM intraday_path_snapshots_store \
             WHERE city = ?1 AND target_date = ?2 \
             ORDER BY id DESC LIMIT 1"
        )
        .ok()?;
    stmt.query_row(rusqlite::params![city_key, today], |row| {
        Ok((row.get(0)?, row.get(1)?))
    })
    .ok()
}

/// Get runway-level observations for Seoul/Busan (stored as ICAO_RWY_N).
pub fn get_runway_temps(db_path: &str, icao: &str) -> Vec<(String, f64)> {
    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let pattern = format!("{}_RWY_%", icao.to_uppercase());
    let mut stmt = match conn.prepare(
        "SELECT icao, temp_c FROM airport_obs_log \
         WHERE icao LIKE ?1 AND created_at > datetime('now', '-120 minutes') \
         ORDER BY icao, created_at DESC"
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let mut results: Vec<(String, f64)> = vec![];
    let rows = stmt.query_map(rusqlite::params![pattern], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
    });
    if let Ok(iter) = rows {
        let mut seen = std::collections::HashSet::new();
        for r in iter.filter_map(|r| r.ok()) {
            // Take only the first (most recent) per unique icao
            if seen.insert(r.0.clone()) {
                results.push(r);
            }
        }
    }
    results
}

/// Get recent temperature observations for an ICAO station.
pub fn get_recent_obs(db_path: &str, icao: &str, minutes: i32, limit: usize) -> Vec<ObsRow> {
    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let sql = format!(
        "SELECT temp_c, obs_time, created_at FROM airport_obs_log \
         WHERE icao = ?1 AND created_at > datetime('now', '{} minutes') \
         ORDER BY created_at DESC LIMIT ?2",
        -minutes
    );
    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows = stmt
        .query_map(rusqlite::params![icao.to_uppercase(), limit as i64], |row| {
            Ok(ObsRow {
                temp_c: row.get(0)?,
                obs_time: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .ok()
        .map(|iter| iter.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();
    rows
}
