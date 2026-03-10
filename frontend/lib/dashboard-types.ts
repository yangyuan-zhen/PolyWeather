export type RiskLevel = "low" | "medium" | "high" | string;

export interface CityListItem {
  name: string;
  display_name: string;
  lat: number;
  lon: number;
  risk_level: RiskLevel;
  risk_emoji?: string;
  airport: string;
  icao: string;
  temp_unit: "celsius" | "fahrenheit";
  is_major?: boolean;
}

export interface ProbabilityBucket {
  value?: number | null;
  label?: string | null;
  bucket?: string | null;
  range?: string | null;
  unit?: string | null;
  probability?: number | null;
}

export interface ModelForecastEntry {
  label: string;
  value: number;
}

export interface DashboardRisk {
  level: RiskLevel;
  emoji?: string;
  airport?: string;
  icao?: string;
  distance_km?: number | null;
  warning?: string | null;
}

export interface CloudLayer {
  cover: string;
  base: number | null;
}

export interface CurrentConditions {
  temp: number | null;
  max_so_far: number | null;
  max_temp_time: string | null;
  wu_settlement: number | null;
  obs_time: string | null;
  obs_age_min: number | null;
  wind_speed_kt: number | null;
  wind_dir: number | null;
  humidity: number | null;
  cloud_desc: string | null;
  clouds_raw: CloudLayer[];
  visibility_mi: number | null;
  wx_desc: string | null;
  raw_metar?: string | null;
  report_time?: string | null;
  receipt_time?: string | null;
  obs_time_epoch?: number | null;
  dewpoint?: number | null;
}

export interface NearbyStation {
  name?: string;
  icao?: string;
  lat: number;
  lon: number;
  temp: number | null;
  wind_dir?: number | null;
  wind_speed?: number | null;
  wind_speed_kt?: number | null;
}

export interface HourlyTrendPoint {
  time: string;
  temp: number;
}

export interface TrendInfo {
  direction?: string;
  recent?: HourlyTrendPoint[];
  is_cooling?: boolean;
  is_dead_market?: boolean;
}

export interface PeakInfo {
  hours?: string[];
  first_h?: number;
  last_h?: number;
  status?: string;
}

export interface MgmData {
  temp?: number | null;
  time?: string | null;
  today_high?: number | null;
  today_low?: number | null;
  hourly?: Array<{
    time?: string | null;
    temp?: number | null;
  }>;
}

export interface ForecastDay {
  date: string;
  max_temp: number | null;
  min_temp?: number | null;
}

export interface ForecastData {
  today_high?: number | null;
  daily?: ForecastDay[];
  sunrise?: string | null;
  sunset?: string | null;
  sunshine_hours?: number | null;
}

export interface DebForecast {
  prediction: number | null;
  weights_info?: string | null;
}

export interface CitySummary {
  name: string;
  display_name?: string | null;
  icao?: string | null;
  local_time?: string | null;
  temp_symbol?: string | null;
  current?: {
    temp?: number | null;
    obs_time?: string | null;
  };
  deb?: {
    prediction?: number | null;
  };
  risk?: {
    level?: RiskLevel;
    warning?: string | null;
  };
  updated_at?: string | null;
}

export interface HourlySeries {
  times?: string[];
  temps?: Array<number | null>;
  dew_point?: Array<number | null>;
  pressure_msl?: Array<number | null>;
  wind_speed_10m?: Array<number | null>;
  wind_direction_10m?: Array<number | null>;
  precipitation_probability?: Array<number | null>;
  cloud_cover?: Array<number | null>;
  radiation?: Array<number | null>;
}

export interface WeatherGovPeriod {
  name?: string;
  start_time?: string;
  end_time?: string;
  short_forecast?: string | null;
  detailed_forecast?: string | null;
  temperature?: number | null;
  temperature_unit?: string | null;
}

export interface SourceForecasts {
  weather_gov?: {
    forecast_periods?: WeatherGovPeriod[];
  };
  meteoblue?: {
    daily_highs?: Array<number | null>;
  };
}

export interface DailyModelForecast {
  models?: Record<string, number | null>;
  deb?: {
    prediction?: number | null;
  };
  probabilities?: ProbabilityBucket[];
}

export interface MarketToken {
  outcome?: string | null;
  token_id?: string | null;
  implied_probability?: number | null;
  buy_price?: number | null;
  sell_price?: number | null;
  midpoint?: number | null;
  last_trade_price?: number | null;
}

export interface MarketPrimary {
  id?: string | null;
  question?: string | null;
  slug?: string | null;
  condition_id?: string | null;
  end_date?: string | null;
  active?: boolean;
  closed?: boolean;
  liquidity?: number | null;
  volume?: number | null;
}

export interface MarketTopBucket {
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
}

export interface MarketScan {
  available?: boolean;
  reason?: string | null;
  primary_market?: MarketPrimary | null;
  selected_date?: string | null;
  selected_condition_id?: string | null;
  selected_slug?: string | null;
  temperature_bucket?: ProbabilityBucket | null;
  model_probability?: number | null;
  market_price?: number | null;
  edge_percent?: number | null;
  signal_label?: string | null;
  confidence?: string | null;
  yes_token?: MarketToken | null;
  no_token?: MarketToken | null;
  yes_buy?: number | null;
  yes_sell?: number | null;
  no_buy?: number | null;
  no_sell?: number | null;
  last_trade_price?: number | null;
  liquidity?: number | null;
  volume?: number | null;
  sparkline?: number[];
  top_buckets?: MarketTopBucket[] | null;
  recent_trades?: unknown[];
  websocket?: Record<string, unknown>;
}

export interface AiAnalysisStructured {
  summary?: string | null;
  text?: string | null;
  message?: string | null;
  highlights?: string[];
  points?: string[];
}

export interface CityDetail {
  name: string;
  display_name: string;
  lat: number;
  lon: number;
  temp_symbol: string;
  local_time: string;
  local_date: string;
  risk: DashboardRisk;
  current: CurrentConditions;
  mgm?: MgmData;
  mgm_nearby?: NearbyStation[];
  forecast?: ForecastData;
  multi_model?: Record<string, number | null>;
  deb?: DebForecast;
  probabilities?: {
    mu?: number | null;
    distribution?: ProbabilityBucket[];
  };
  hourly?: {
    times?: string[];
    temps?: Array<number | null>;
  };
  hourly_next_48h?: HourlySeries;
  metar_recent_obs?: Array<{
    time?: string;
    temp?: number | null;
  }>;
  metar_today_obs?: Array<{
    time?: string;
    temp?: number | null;
  }>;
  trend?: TrendInfo;
  peak?: PeakInfo;
  ai_analysis?: string | AiAnalysisStructured | null;
  updated_at?: string;
  multi_model_daily?: Record<string, DailyModelForecast>;
  source_forecasts?: SourceForecasts;
  market_scan?: MarketScan;
}

export interface HistoryPoint {
  date: string;
  actual: number | null;
  deb: number | null;
  mgm?: number | null;
}

export interface LoadingState {
  cities: boolean;
  cityDetail: boolean;
  refresh: boolean;
  history: boolean;
  marketScan?: boolean;
}

export interface HistoryState {
  isOpen: boolean;
  loading: boolean;
  error: string | null;
  dataByCity: Record<string, HistoryPoint[]>;
}

export interface DashboardState {
  cities: CityListItem[];
  cityDetailsByName: Record<string, CityDetail>;
  citySummariesByName: Record<string, CitySummary>;
  selectedCity: string | null;
  isPanelOpen: boolean;
  selectedForecastDate: string | null;
  loadingState: LoadingState;
  historyState: HistoryState;
}
