use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct CitySnapshot {
    pub name: String,
    pub display_name: String,
    pub airport: String,
    pub icao: String,
    pub local_time: String,
    pub current_temp: Option<f64>,
    pub today_max: Option<f64>,
    pub max_time: Option<String>,
    pub trend: Trend,
    pub new_high: bool,
    pub runway_pairs: Vec<(String, f64)>,
    pub gap: Option<f64>,
    pub threshold: f64,
    pub time_ok: bool,
    pub temp_ok: bool,
    pub trend_ok: bool,
    pub in_window: bool,
    pub obs_age_min: Option<i64>,
    pub temp_warm: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Trend {
    Rising,
    Falling,
    Flat,
    Unknown,
}

impl Trend {
    pub fn symbol(&self) -> &str {
        match self {
            Trend::Rising => "↑",
            Trend::Falling => "↓",
            Trend::Flat => "→",
            Trend::Unknown => "",
        }
    }

    pub fn css_class(&self) -> &str {
        match self {
            Trend::Rising => "rising",
            Trend::Falling => "falling",
            Trend::Flat => "flat",
            Trend::Unknown => "",
        }
    }
}
