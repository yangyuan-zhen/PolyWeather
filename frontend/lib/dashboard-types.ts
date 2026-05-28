export type RiskLevel = "low" | "medium" | "high" | string;

export interface CityListItem {
  name: string;
  display_name: string;
  lat: number;
  lon: number;
  utc_offset_seconds?: number;
  risk_level: RiskLevel;
  deb_recent_tier?: RiskLevel;
  deb_recent_hit_rate?: number | null;
  deb_recent_sample_count?: number;
  deb_recent_mae?: number | null;
  deb_recent_last_date?: string | null;
  risk_emoji?: string;
  airport: string;
  icao: string;
  temp_unit: "celsius" | "fahrenheit";
  is_major?: boolean;
  settlement_source?: string;
  settlement_source_label?: string;
  settlement_station_code?: string;
  settlement_station_label?: string;
  network_provider?: string;
  network_provider_label?: string;
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

export interface ObservationFreshness {
  source_code?: string | null;
  source_label?: string | null;
  observed_at?: string | null;
  observed_at_local?: string | null;
  ingested_at?: string | null;
  native_update_interval_sec?: number | null;
  expected_next_update_at?: string | null;
  freshness_status?:
    | "fresh"
    | "expected_wait"
    | "delayed"
    | "stale"
    | "offline"
    | "unknown"
    | string
    | null;
  freshness_reason?: string | null;
  age_sec?: number | null;
}

export interface CurrentConditions {
  temp: number | null;
  max_so_far: number | null;
  max_temp_time: string | null;
  wu_settlement: number | null;
  settlement_source?: string | null;
  settlement_source_label?: string | null;
  station_code?: string | null;
  station_name?: string | null;
  obs_time: string | null;
  obs_age_min: number | null;
  observation_status?: "live" | "missing" | "stale" | string | null;
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
  source_code?: string | null;
  freshness?: ObservationFreshness | null;
  dewpoint?: number | null;
}

export interface AirportCurrentConditions {
  temp: number | null;
  obs_time: string | null;
  max_so_far?: number | null;
  max_temp_time?: string | null;
  obs_age_min?: number | null;
  report_time?: string | null;
  receipt_time?: string | null;
  obs_time_epoch?: number | null;
  wind_speed_kt?: number | null;
  wind_dir?: number | null;
  humidity?: number | null;
  cloud_desc?: string | null;
  visibility_mi?: number | null;
  wx_desc?: string | null;
  raw_metar?: string | null;
  source_code?: string | null;
  source_label?: string | null;
  station_code?: string | null;
  station_label?: string | null;
  is_airport_station?: boolean;
  is_official?: boolean;
  is_settlement_anchor?: boolean;
  stale_for_today?: boolean;
  pressure_hpa?: number | null;
  last_observation_local_date?: string | null;
  current_local_date?: string | null;
  freshness?: ObservationFreshness | null;
}

export interface NearbyStation {
  name?: string;
  icao?: string;
  station_code?: string | null;
  station_label?: string | null;
  lat: number;
  lon: number;
  temp: number | null;
  wind_dir?: number | null;
  wind_speed?: number | null;
  wind_speed_kt?: number | null;
  source_code?: string | null;
  source_label?: string | null;
  is_official?: boolean;
  is_airport_station?: boolean;
  is_settlement_anchor?: boolean;
  obs_time?: string | null;
  obs_time_epoch?: number | string | null;
  obs_time_label?: string | null;
  obs_time_display_tz?: "city_local" | string | null;
  age_minutes?: number | null;
  time_delta_vs_anchor_minutes?: number | null;
  sync_status?: "synced" | "near_realtime" | "lagged" | "stale" | "unknown" | string | null;
  usable_for_intraday?: boolean;
  wind_direction_text?: string | null;
  wind_power_text?: string | null;
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

export interface DebHourlyPath {
  source?: string | null;
  version?: string | null;
  times?: string[];
  temps?: Array<number | null>;
  base_source?: string | null;
  base_offset?: number | null;
  correction?: Record<string, unknown> | null;
}

export interface DebForecast {
  prediction: number | null;
  raw_prediction?: number | null;
  version?: string | null;
  weights_info?: string | null;
  bias_adjustment?: number | null;
  bias_samples?: number | null;
  intraday_adjustment?: number | null;
  hourly_path?: DebHourlyPath | null;
  hourly_correction?: Record<string, unknown> | null;
}

export interface CitySummary {
  name: string;
  display_name?: string | null;
  icao?: string | null;
  utc_offset_seconds?: number | null;
  local_time?: string | null;
  temp_symbol?: string | null;
  current?: {
    temp?: number | null;
    obs_time?: string | null;
    settlement_source?: string | null;
    settlement_source_label?: string | null;
  };
  deb?: {
    prediction?: number | null;
  };
  deviation_monitor?: DeviationMonitor;
  risk?: {
    level?: RiskLevel;
    warning?: string | null;
  };
  updated_at?: string | null;
}

export interface DeviationMonitor {
  available?: boolean;
  current_delta?: number | null;
  reference_temp?: number | null;
  direction?: "normal" | "cold" | "hot" | string;
  severity?: "normal" | "light" | "strong" | string;
  trend?: "stable" | "expanding" | "contracting" | string;
  label_zh?: string | null;
  label_en?: string | null;
  trend_label_zh?: string | null;
  trend_label_en?: string | null;
}

export interface HourlySeries {
  times?: string[];
  temps?: Array<number | null>;
  dew_point?: Array<number | null>;
  pressure_msl?: Array<number | null>;
  wind_speed_10m?: Array<number | null>;
  wind_direction_10m?: Array<number | null>;
  wind_speed_180m?: Array<number | null>;
  wind_direction_180m?: Array<number | null>;
  precipitation_probability?: Array<number | null>;
  cloud_cover?: Array<number | null>;
  radiation?: Array<number | null>;
  cape?: Array<number | null>;
  convective_inhibition?: Array<number | null>;
  lifted_index?: Array<number | null>;
  boundary_layer_height?: Array<number | null>;
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
  open_meteo_multi_model?: {
    source?: string | null;
    provider?: string | null;
    dates?: string[];
    model_metadata?: Record<
      string,
      {
        label?: string | null;
        provider?: string | null;
        model?: string | null;
        tier?: string | null;
        resolution_km?: number | null;
        horizon?: string | null;
        open_meteo_model?: string | null;
      }
    >;
    model_keys?: Record<string, string>;
    attribution?: string | null;
  };
}

export interface DailyModelForecast {
  models?: Record<string, number | null>;
  deb?: {
    prediction?: number | null;
  };
  probabilities?: ProbabilityBucket[];
  probabilities_all?: ProbabilityBucket[];
}

export interface MarketToken {
  outcome?: string | null;
  token_id?: string | null;
  implied_probability?: number | null;
  buy_price?: number | null;
  sell_price?: number | null;
  midpoint?: number | null;
  last_trade_price?: number | null;
  quote_source?: string | null;
  quote_age_ms?: number | null;
}

export interface MarketPrimary {
  id?: string | null;
  question?: string | null;
  slug?: string | null;
  market_url?: string | null;
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
  lower?: number | null;
  upper?: number | null;
  unit?: string | null;
  probability?: number | null;
  model_probability?: number | null;
  market_price?: number | null;
  edge_percent?: number | null;
  yes_buy?: number | null;
  yes_sell?: number | null;
  no_buy?: number | null;
  no_sell?: number | null;
  yes_token_id?: string | null;
  no_token_id?: string | null;
  quote_source?: string | null;
  quote_age_ms?: number | null;
  slug?: string | null;
  market_url?: string | null;
  question?: string | null;
  is_primary?: boolean;
}

export interface MarketPriceSide {
  side?: "yes" | "no" | string | null;
  model_probability?: number | null;
  ask?: number | null;
  bid?: number | null;
  edge?: number | null;
  edge_percent?: number | null;
  kelly_fraction?: number | null;
  quarter_kelly?: number | null;
}

export interface MarketPriceAnalysis {
  available?: boolean;
  source?: string | null;
  model_probability?: number | null;
  yes?: MarketPriceSide | null;
  no?: MarketPriceSide | null;
  best_side?: "yes" | "no" | string | null;
  lock?: {
    available?: boolean;
    ask_sum?: number | null;
    edge?: number | null;
  } | null;
  sell_side?: {
    bid_sum?: number | null;
    edge?: number | null;
  } | null;
}

export interface MarketScan {
  available?: boolean;
  reason?: string | null;
  primary_market?: MarketPrimary | null;
  market_url?: string | null;
  primary_market_url?: string | null;
  selected_date?: string | null;
  selected_condition_id?: string | null;
  selected_slug?: string | null;
  temperature_bucket?: ProbabilityBucket | null;
  model_probability?: number | null;
  market_price?: number | null;
  midpoint?: number | null;
  spread?: number | null;
  edge_percent?: number | null;
  signal_label?: string | null;
  confidence?: string | null;
  probability_engine?: string | null;
  probability_calibration_mode?: string | null;
  yes_token?: MarketToken | null;
  no_token?: MarketToken | null;
  yes_buy?: number | null;
  yes_sell?: number | null;
  yes_midpoint?: number | null;
  yes_spread?: number | null;
  no_buy?: number | null;
  no_sell?: number | null;
  no_midpoint?: number | null;
  no_spread?: number | null;
  last_trade_price?: number | null;
  liquidity?: number | null;
  volume?: number | null;
  quote_source?: string | null;
  quote_age_ms?: number | null;
  price_analysis?: MarketPriceAnalysis | null;
  sparkline?: number[];
  top_buckets?: MarketTopBucket[] | null;
  all_buckets?: MarketTopBucket[] | null;
  recent_trades?: unknown[];
  scan_scope?: "lite" | "full" | string | null;
  websocket?: Record<string, unknown>;
  distribution_bias?: DistributionBias | null;
  distribution_preview?: DistributionPreviewPoint[] | null;
  distribution_full?: DistributionPreviewPoint[] | null;
  window_phase?: string | null;
  window_score?: number | null;
  primary_signal?: PrimarySignal | null;
  signal_status?: string | null;
  candidate_count?: number | null;
  scan_rows?: ScanOpportunityRow[] | null;
  resolved_market_type?: string | null;
}

export interface DistributionBias {
  available?: boolean;
  value?: number | null;
  score?: number | null;
  direction?: "hotter" | "colder" | "balanced" | string | null;
}

export interface DistributionPreviewPoint {
  label?: string | null;
  value?: number | null;
  unit?: string | null;
  model_probability?: number | null;
  market_probability?: number | null;
  highlighted?: boolean;
}

export interface ScanTerminalFilters {
  scan_mode: "tradable" | "early" | "touch" | "trend";
  min_price: number;
  max_price: number;
  min_edge_pct: number;
  min_liquidity: number;
  high_liquidity_only: boolean;
  market_type: "maxtemp" | "all" | string;
  time_range: "today" | "tomorrow" | "week" | string;
  limit: number;
}

export interface ScanOpportunityRow {
  id: string;
  rank?: number | null;
  city: string;
  city_display_name?: string | null;
  display_name?: string | null;
  trading_region?: string | null;
  trading_region_label?: string | null;
  trading_region_label_zh?: string | null;
  trading_region_sort?: number | null;
  tz_offset_seconds?: number | null;
  selected_date?: string | null;
  local_date?: string | null;
  local_time?: string | null;
  temp_symbol?: string | null;
  current_temp?: number | null;
  current_max_so_far?: number | null;
  metar_context?: {
    source?: string | null;
    station?: string | null;
    station_label?: string | null;
    obs_count?: number | null;
    last_time?: string | null;
    last_temp?: number | null;
    max_temp?: number | null;
    max_time?: string | null;
    trend_delta?: number | null;
    stale_for_today?: boolean;
    available_for_today?: boolean;
    last_observation_time?: string | null;
    airport_current_temp?: number | null;
    airport_max_so_far?: number | null;
    airport_obs_time?: string | null;
    airport_report_time?: string | null;
    airport_raw_metar?: string | null;
    airport_wx_desc?: string | null;
    airport_cloud_desc?: string | null;
    airport_visibility_mi?: number | null;
    airport_wind_speed_kt?: number | null;
    airport_wind_dir?: number | null;
    airport_humidity?: number | null;
    today_obs?: Array<{ time?: string; temp?: number | null }>;
    recent_obs?: Array<{ time?: string; temp?: number | null }>;
    settlement_today_obs?: Array<{ time?: string; temp?: number | null }>;
  } | null;
  metar_recent_obs?: Array<{ time?: string; temp?: number | null }>;
  metar_today_obs?: Array<{ time?: string; temp?: number | null }>;
  settlement_today_obs?: Array<{ time?: string; temp?: number | null }>;
  metar_status?: {
    available_for_today?: boolean;
    stale_for_today?: boolean;
    last_observation_time?: string | null;
    last_temp?: number | null;
  } | null;
  deb_prediction?: number | null;
  airport?: string | null;
  risk_level?: RiskLevel | null;
  market_slug?: string | null;
  market_question?: string | null;
  market_url?: string | null;
  market_key?: string | null;
  side?: "yes" | "no" | string | null;
  action?: string | null;
  market_direction?: string | null;
  temperature_direction?: string | null;
  target_label?: string | null;
  target_value?: number | null;
  target_threshold?: number | null;
  target_lower?: number | null;
  target_upper?: number | null;
  target_unit?: string | null;
  model_probability?: number | null;
  market_probability?: number | null;
  probability_engine?: string | null;
  probability_calibration_mode?: string | null;
  model_event_probability?: number | null;
  raw_model_event_probability?: number | null;
  market_event_probability?: number | null;
  gap?: number | null;
  signed_gap?: number | null;
  yes_token_id?: string | null;
  no_token_id?: string | null;
  yes_ask?: number | null;
  yes_bid?: number | null;
  no_ask?: number | null;
  no_bid?: number | null;
  ask?: number | null;
  bid?: number | null;
  midpoint?: number | null;
  spread?: number | null;
  book_liquidity?: number | null;
  market_liquidity?: number | null;
  volume?: number | null;
  quote_source?: string | null;
  quote_age_ms?: number | null;
  edge?: number | null;
  edge_percent?: number | null;
  kelly_fraction?: number | null;
  quarter_kelly?: number | null;
  edge_score?: number | null;
  bias_score?: number | null;
  consensus_score?: number | null;
  distribution_bias?: DistributionBias | null;
  distribution_preview?: DistributionPreviewPoint[] | null;
  distribution_full?: DistributionPreviewPoint[] | null;
  distribution_bias_direction?: string | null;
  distribution_bias_score?: number | null;
  distribution_bias_available?: boolean;
  peak_probability?: number | null;
  peak_value?: number | null;
  peak_distance?: number | null;
  peak_alignment_score?: number | null;
  is_peak_candidate?: boolean;
  is_directional_candidate?: boolean;
  cluster_adjusted?: boolean;
  cluster_role?: string | null;
  cluster_center?: number | null;
  cluster_core_low?: number | null;
  cluster_core_high?: number | null;
  cluster_model_count?: number | null;
  cluster_deb_reference?: number | null;
  cluster_median?: number | null;
  model_cluster_sources?: Record<string, number | null> | null;
  window_phase?: string | null;
  window_score?: number | null;
  remaining_window_minutes?: number | null;
  peak_window_start?: string | null;
  peak_window_end?: string | null;
  peak_window_label?: string | null;
  minutes_until_peak_start?: number | null;
  minutes_until_peak_end?: number | null;
  liquidity_score?: number | null;
  price_usefulness_score?: number | null;
  spread_penalty?: number | null;
  final_score?: number | null;
  current_reference?: number | null;
  gap_to_target?: number | null;
  touch_distance?: number | null;
  trend_alignment?: boolean;
  tradable?: boolean;
  active?: boolean;
  closed?: boolean;
  accepting_orders?: boolean;
  enable_order_book?: boolean;
  is_primary_market?: boolean;
  is_primary_signal?: boolean;
  signal_confidence?: number | null;
  signal_status?: string | null;
  candidate_count?: number | null;
  resolved_market_type?: string | null;
  ai_decision?: "approve" | "veto" | "downgrade" | "neutral" | string | null;
  ai_rank?: number | null;
  ai_confidence?: string | null;
  ai_reason_zh?: string | null;
  ai_reason_en?: string | null;
  v4_metar_decision?: "approve" | "veto" | "downgrade" | "watchlist" | string | null;
  v4_metar_reason_zh?: string | null;
  v4_metar_reason_en?: string | null;
}

export interface PrimarySignal extends ScanOpportunityRow {}

export interface ScanTerminalResponse {
  generated_at: string;
  snapshot_id?: string | null;
  status?: "ready" | "stale" | "failed" | string;
  stale?: boolean;
  stale_reason?: string | null;
  last_success_at?: string | null;
  last_failed_at?: string | null;
  filters: ScanTerminalFilters;
  summary: {
    recommended_count: number;
    visible_count: number;
    candidate_total: number;
    avg_edge_percent?: number | null;
    avg_primary_confidence?: number | null;
    tradable_market_count: number;
    total_volume: number;
    resolved_market_type?: string | null;
    total_city_count?: number | null;
    scanned_city_count?: number | null;
    failed_city_count?: number | null;
  };
  top_signal?: PrimarySignal | null;
  rows: ScanOpportunityRow[];
}

export interface IntradayMeteorologySignal {
  label?: string | null;
  label_en?: string | null;
  direction?: "support" | "suppress" | "neutral" | string | null;
  strength?: "weak" | "medium" | "strong" | string | null;
  summary?: string | null;
  summary_en?: string | null;
}

export interface IntradayMeteorology {
  headline?: string | null;
  headline_en?: string | null;
  confidence?: "low" | "medium" | "high" | string | null;
  base_case_bucket?: string | null;
  upside_bucket?: string | null;
  downside_bucket?: string | null;
  next_observation_time?: string | null;
  peak_window?: string | null;
  invalidation_rules?: string[] | null;
  invalidation_rules_en?: string[] | null;
  confirmation_rules?: string[] | null;
  confirmation_rules_en?: string[] | null;
  signal_contributions?: IntradayMeteorologySignal[] | null;
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
  detail_depth?: "panel" | "market" | "nearby" | "full";
  lat: number;
  lon: number;
  utc_offset_seconds?: number;
  temp_symbol: string;
  local_time: string;
  local_date: string;
  risk: DashboardRisk;
  current: CurrentConditions;
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
  airport_current?: AirportCurrentConditions;
  airport_primary?: AirportCurrentConditions;
  airport_primary_today_obs?: Array<{
    time?: string;
    temp?: number | null;
  }>;
  mgm?: MgmData;
  mgm_nearby?: NearbyStation[];
  official_nearby?: NearbyStation[];
  nearby_source?: string;
  official_network_source?: string;
  official_network_status?: {
    provider_code?: string | null;
    provider_label?: string | null;
    available?: boolean;
    mode?: string | null;
    row_count?: number | null;
  };
  network_lead_signal?: {
    available?: boolean;
    delta?: number | null;
    leader_station_code?: string | null;
    leader_station_label?: string | null;
    leader_temp?: number | null;
    leader_obs_time?: string | null;
    leader_obs_time_label?: string | null;
    leader_sync_status?: string | null;
    leader_time_delta_vs_anchor_minutes?: number | null;
  };
  network_spread_signal?: {
    available?: boolean;
    spread?: number | null;
    hottest_station_code?: string | null;
    coolest_station_code?: string | null;
  };
  center_station_candidate?: NearbyStation | null;
  airport_vs_network_delta?: number | null;
  forecast?: ForecastData;
  multi_model?: Record<string, number | null>;
  deb?: DebForecast;
  deviation_monitor?: DeviationMonitor;
  probabilities?: {
    mu?: number | null;
    distribution?: ProbabilityBucket[];
    distribution_all?: ProbabilityBucket[];
    engine?: string | null;
    calibration_mode?: string | null;
    calibration_version?: string | null;
    raw_mu?: number | null;
    raw_sigma?: number | null;
    calibrated_mu?: number | null;
    calibrated_sigma?: number | null;
    shadow_distribution?: ProbabilityBucket[];
    shadow_distribution_all?: ProbabilityBucket[];
  };
  hourly?: {
    times?: string[];
    temps?: Array<number | null>;
  };
  models_hourly?: {
    times?: string[];
    curves?: Record<string, Array<number | null>>;
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
  metar_status?: {
    available_for_today?: boolean;
    stale_for_today?: boolean;
    last_observation_time?: string | null;
    last_observation_local_date?: string | null;
    current_local_date?: string | null;
    last_temp?: number | null;
  };
  settlement_today_obs?: Array<{
    time?: string;
    temp?: number | null;
  }>;
  trend?: TrendInfo;
  peak?: PeakInfo;
  dynamic_commentary?: {
    summary?: string | null;
    notes?: string[] | null;
    headline_zh?: string | null;
    headline_en?: string | null;
    bullets_zh?: string[] | null;
    bullets_en?: string[] | null;
    source?: string | null;
  };
  taf?: {
    source?: string | null;
    icao?: string | null;
    issue_time?: string | null;
    valid_time_from?: string | null;
    valid_time_to?: string | null;
    raw_taf?: string | null;
    signal?: {
      available?: boolean;
      source?: string | null;
      peak_window?: string | null;
      segments?: Array<{
        type?: string | null;
        start_local?: string | null;
        end_local?: string | null;
        tokens?: string[] | null;
      }> | null;
      markers?: Array<{
        label_time?: string | null;
        marker_type?: string | null;
        start_local?: string | null;
        end_local?: string | null;
        suppression_level?: string | null;
        summary_zh?: string | null;
        summary_en?: string | null;
      }> | null;
      low_ceiling_ft?: number | null;
      ceiling_cover?: string | null;
      wind_regimes?: string[] | null;
      wind_shift?: boolean | null;
      suppression_level?: string | null;
      disruption_level?: string | null;
      summary_zh?: string | null;
      summary_en?: string | null;
    };
  };
  vertical_profile_signal?: {
    source?: string | null;
    window_start?: string | null;
    window_end?: string | null;
    cape_max?: number | null;
    cin_min?: number | null;
    lifted_index_min?: number | null;
    boundary_layer_height_max?: number | null;
    shear_10m_180m_max?: number | null;
    suppression_risk?: string | null;
    trigger_risk?: string | null;
    mixing_strength?: string | null;
    shear_risk?: string | null;
    heating_setup?: string | null;
    heating_score?: number | null;
    summary_zh?: string | null;
    summary_en?: string | null;
  };
  ai_analysis?: string | AiAnalysisStructured | null;
  updated_at?: string;
  multi_model_daily?: Record<string, DailyModelForecast>;
  source_forecasts?: SourceForecasts;
  market_scan?: MarketScan;
  intraday_meteorology?: IntradayMeteorology;
  amos?: AmosData | null;
  top_buckets?: MarketTopBucket[] | null;
  all_buckets?: MarketTopBucket[] | null;
}

export interface AmosData {
  temp?: number | null;
  temp_c?: number | null;
  dew?: number | null;
  dew_c?: number | null;
  pressure_hpa?: number | null;
  wind_kt?: number | null;
  temp_source?: string | null;
  runway_temps?: Array<[number | null, number | null]> | null;
  runway_temp_range?: [number, number] | null;
  source?: string | null;
  source_label?: string | null;
  icao?: string | null;
  station_label?: string | null;
  raw_metar?: string | null;
  raw_taf?: string | null;
  runway_obs?: {
    runway_pairs?: Array<[string, string]> | null;
    temperatures?: Array<[number | null, number | null]> | null;
    point_temperatures?: Array<{
      runway?: string | null;
      temp?: number | null;
      tdz_temp?: number | null;
      mid_temp?: number | null;
      end_temp?: number | null;
      target_runway_max?: number | null;
    }> | null;
    pressures_hpa?: Array<number | null> | null;
    wind_directions?: Array<[number, number, number] | null> | null;
    wind_speeds?: Array<[number, number, number] | null> | null;
    visibility_mor?: Array<number | null> | null;
    rvr?: Array<number | null> | null;
  } | null;
  observation_source?: string | null;
  observation_source_zh?: string | null;
  observation_time?: string | null;
  observation_time_local?: string | null;
}


export interface LoadingState {
  cities: boolean;
  cityDetail: boolean;
  refresh: boolean;  marketScan?: boolean;
  futureDeep?: boolean;}


export interface ProAccessState {
  loading: boolean;
  authenticated: boolean;
  userId: string | null;
  subscriptionActive: boolean;
  subscriptionPlanCode: string | null;
  subscriptionExpiresAt: string | null;
  subscriptionTotalExpiresAt: string | null;
  subscriptionQueuedDays: number;
  points: number;
  error: string | null;
}

export type ForecastModalMode = "today" | "future";

export interface DashboardState {
  cities: CityListItem[];
  cityDetailsByName: Record<string, CityDetail>;
  citySummariesByName: Record<string, CitySummary>;
  selectedCity: string | null;
  isPanelOpen: boolean;
  selectedForecastDate: string | null;
  forecastModalMode: ForecastModalMode | null;
  loadingState: LoadingState;
  proAccess: ProAccessState;
}
