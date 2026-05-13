use rusqlite::Connection;

#[derive(Debug, Clone)]
pub struct ObsRow {
    pub temp_c: Option<f64>,
    #[allow(dead_code)]
    pub obs_time: Option<String>,
    pub created_at: Option<String>,
}

/// Get today's daily max temperature for an ICAO station.
pub fn get_daily_max(db_path: &str, icao: &str) -> Option<(f64, Option<String>)> {
    let conn = Connection::open(db_path).ok()?;
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let mut stmt = conn
        .prepare("SELECT max_temp, max_time FROM city_daily_max WHERE icao = ?1 AND obs_date = ?2")
        .ok()?;
    stmt.query_row(rusqlite::params![icao.to_uppercase(), today], |row| {
        Ok((row.get(0)?, row.get(1)?))
    })
    .ok()
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
