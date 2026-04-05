// --- Polymarket Market Types ---

export interface MarketBook {
  best_bid: number;
  best_ask: number;
  bid_levels: [number, number][]; // [price, size]
  ask_levels: [number, number][]; // [price, size]
}

export interface MarketToken {
  outcome: string;
  token_id: string;
  implied_probability: number;
  buy_price: number;
  sell_price: number;
  midpoint: number;
  last_trade_price: number;
  book?: MarketBook;
}

export interface Trade {
  id: string;
  price: number;
  size: number;
  side: "buy" | "sell";
  timestamp: string;
  timestamp_iso?: string | null;
  outcome?: string | null;
  asset?: string | null;
  transaction_hash?: string | null;
}

export interface MarketSnapshot {
  id: string;
  question: string;
  title: string;
  slug: string;
  event_slug: string;
  condition_id: string;
  target_date: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  enable_order_book: boolean;
  liquidity: number;
  volume: number;
  start_date: string;
  end_date: string;
  tokens: MarketToken[];
  recent_trades: Trade[];
}

export interface MarketPlatformData {
  city: string;
  target_date: string;
  fetched_at: string;
  market_count: number;
  markets: MarketSnapshot[];
  websocket: {
    market_url: string;
    asset_ids: string[];
    condition_ids: string[];
  };
}

// --- Official Weather Types (Aviation) ---

export interface METARObservation {
  source: string;
  icao: string;
  station_name: string;
  timestamp: string;
  observation_time: string;
  current: {
    temp: number;
    max_temp_so_far: number;
    max_temp_time: string;
    dewpoint: number;
    wind_speed_kt: number;
    wind_dir: number;
    visibility_mi: string | number;
    wx_desc: string | null;
    altimeter: number;
    clouds: any[];
  };
  recent_temps: number[];
  today_obs: any[];
  recent_obs: any[];
  unit: "celsius" | "fahrenheit";
}

export interface AviationWeatherData {
  available: boolean;
  source: string;
  icao: string;
  observation: METARObservation;
}

// --- Official Weather Types (Weather.gov) ---

export interface WeatherGovPeriod {
  name: string;
  start_time?: string;
  end_time?: string;
  is_daytime?: boolean;
  temperature: number;
  temperature_unit: string;
  wind_speed?: string;
  wind_direction?: string;
  short_forecast?: string;
  detailed_forecast?: string;
}

export interface WeatherGovAlert {
  id: string;
  event: string;
  severity: string;
  certainty: string;
  urgency: string;
  headline: string;
  onset: string;
  expires: string;
}

export interface WeatherGovData {
  available: boolean;
  source: string;
  city: string;
  grid: any;
  nearest_station: {
    station_identifier?: string;
    name?: string;
    timezone?: string;
    elevation_m?: number | null;
  } | null;
  latest_observation: {
    station_identifier?: string;
    temperature_c?: number | null;
    dewpoint_c?: number | null;
    wind_direction_deg?: number | null;
    wind_speed_kmh?: number | null;
    text_description?: string | null;
    timestamp?: string;
  } | null;
  stations: any[];
  forecast_periods: WeatherGovPeriod[];
  hourly_periods: WeatherGovPeriod[];
  active_alerts: WeatherGovAlert[];
}

export interface OfficialWeatherData {
  city: string;
  fetched_at: string;
  aviation_weather?: AviationWeatherData;
  weather_gov?: WeatherGovData;
}

// --- City List Types ---

export interface CityInfo {
  name: string;
  display_name: string;
  lat: number;
  lon: number;
  risk_level: "low" | "medium" | "high";
  risk_emoji: string;
  airport: string;
  icao: string;
  temp_unit: "celsius" | "fahrenheit";
  is_major: boolean;
  settlement_source?: string;
  settlement_source_label?: string;
}

export interface CitiesResponse {
  cities: CityInfo[];
}

// --- Full City Analysis Types ---

export interface ModelComparison {
  [key: string]: number | undefined;
  "Open-Meteo"?: number;
  ECMWF?: number;
  GFS?: number;
  ICON?: number;
  GEM?: number;
  JMA?: number;
  LGBM?: number;
  MGM?: number;
  NWS?: number;
}

export interface DEBAnalysis {
  prediction: number | null;
  weights_info?: string;
}

export interface TrendInfo {
  direction: string;
  recent: Array<{ time: string; temp: number }>;
  is_cooling: boolean;
  is_dead_market: boolean;
}

export interface PeakInfo {
  hours: string[];
  first_h: number;
  last_h: number;
  status: string;
}

export interface CityAnalysis {
  name: string;
  display_name: string;
  lat: number;
  lon: number;
  temp_symbol: string;
  local_time: string;
  local_date: string;
  risk: {
    level: string;
    emoji: string;
    airport: string;
    icao: string;
    distance_km: number;
    warning: string;
  };
  current: {
    temp: number | null;
    max_so_far: number | null;
    max_temp_time: string;
    wu_settlement: number | null;
    settlement_source?: string | null;
    settlement_source_label?: string | null;
    obs_time: string;
    obs_age_min: number | null;
    wind_speed_kt: number | null;
    wind_dir: number | null;
    humidity: number | null;
    cloud_desc: string;
    clouds_raw: Array<{ cover: string; base: number | null }>;
    visibility_mi: number | null;
    wx_desc: string | null;
    raw_metar?: string | null;
    report_time?: string | null;
    receipt_time?: string | null;
    obs_time_epoch?: number | null;
  };
  mgm?: {
    temp?: number | null;
    time?: string;
    today_high?: number | null;
    today_low?: number | null;
  };
  forecast: {
    today_high: number | null;
    daily: any[];
  };
  multi_model: ModelComparison;
  deb: DEBAnalysis;
  probabilities: {
    mu?: number | null;
    distribution?: any[];
  };
  hourly?: any;
  metar_recent_obs?: any[];
  trend?: TrendInfo;
  peak?: PeakInfo;
  ai_analysis: string;
  updated_at: string;
}

// --- Aggregated Detail Types ---

export interface MarketScan {
  available: boolean;
  reason: string | null;
  primary_market: any | null;
  selected_date: string | null;
  selected_condition_id: string | null;
  selected_slug: string | null;
  temperature_bucket: any | null;
  model_probability: number | null;
  market_price: number | null;
  edge_percent: number | null;
  signal_label: "BUY YES" | "BUY NO" | "MONITOR";
  confidence: "low" | "medium" | "high";
  yes_token: MarketToken | null;
  no_token: MarketToken | null;
  yes_buy: number | null;
  yes_sell: number | null;
  no_buy: number | null;
  no_sell: number | null;
  last_trade_price: number | null;
  liquidity: number | null;
  volume: number | null;
  sparkline: number[];
  top_buckets?: Array<{
    label?: string | null;
    value?: number | null;
    temp?: number | null;
    probability?: number | null;
    market_price?: number | null;
    yes_buy?: number | null;
    yes_sell?: number | null;
    no_buy?: number | null;
    no_sell?: number | null;
    slug?: string | null;
    question?: string | null;
    is_primary?: boolean;
  }>;
  recent_trades: Trade[];
  websocket: any;
}

export interface CityDetail {
  city: string;
  fetched_at: string;
  overview: {
    name: string;
    display_name: string;
    icao: string;
    airport: string;
    lat: number;
    lon: number;
    local_time: string;
    local_date: string;
    temp_symbol: string;
    current_temp: number | null;
    settlement_station?: {
      provider_code?: string | null;
      settlement_source?: string | null;
      settlement_station_code?: string | null;
      settlement_station_label?: string | null;
      airport_code?: string | null;
      airport_name?: string | null;
      is_airport_anchor?: boolean;
      is_official_station_anchor?: boolean;
    };
    deb_prediction: number | null;
    risk_level: string;
    risk_warning: string;
    updated_at: string;
  };
  official: {
    available: boolean;
    metar: any;
    weather_gov: WeatherGovData;
    mgm: any;
    mgm_nearby: any[];
    nearby_source?: string;
    airport_primary?: any;
    airport_primary_today_obs?: any[];
    official_nearby?: any[];
    official_network_source?: string;
    official_network_status?: any;
    network_lead_signal?: any;
    network_spread_signal?: any;
    center_station_candidate?: any;
    airport_vs_network_delta?: number | null;
  };
  timeseries: {
    metar_recent_obs: any[];
    metar_today_obs: any[];
    settlement_today_obs?: any[];
    hourly: any;
    mgm_hourly: any[];
    forecast_daily: any[];
  };
  models: ModelComparison;
  probabilities: {
    mu: number | null;
    distribution: any[];
  };
  market_scan: MarketScan;
  risk: any;
  settlement_station?: any;
  airport_primary?: any;
  official_nearby?: any[];
  official_network_source?: string;
  official_network_status?: any;
  network_lead_signal?: any;
  network_spread_signal?: any;
  center_station_candidate?: any;
  airport_vs_network_delta?: number | null;
  ai_analysis: string;
  errors: Record<string, string>;
}

export interface CitySummary {
  name: string;
  display_name: string;
  icao: string;
  local_time: string;
  temp_symbol: string;
  current: {
    temp: number | null;
    obs_time: string;
  };
  deb: {
    prediction: number | null;
  };
  risk: {
    level: string;
    warning: string;
  };
  updated_at: string;
}
