export type AiPinnedCity = {
  cityName: string;
  displayName?: string | null;
  addedAt: number;
};

export type AiCityForecastMeta = {
  fallback?: boolean | null;
  deterministic_guard_fields?: string[] | null;
  deterministic_guard_reason?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type AiCityForecastPayload = {
  status?: string | null;
  reason?: string | null;
  reason_zh?: string | null;
  reason_en?: string | null;
  raw_reason?: string | null;
  degraded?: boolean | null;
  cached?: boolean | null;
  model?: string | null;
  provider?: string | null;
  city_forecast?: {
    predicted_max?: number | string | null;
    range_low?: number | string | null;
    range_high?: number | string | null;
    unit?: string | null;
    confidence?: string | null;
    final_judgment_zh?: string | null;
    final_judgment_en?: string | null;
    metar_read_zh?: string | null;
    metar_read_en?: string | null;
    reasoning_zh?: string | null;
    reasoning_en?: string | null;
    risks_zh?: string[] | null;
    risks_en?: string[] | null;
    model_cluster_note_zh?: string | null;
    model_cluster_note_en?: string | null;
    _polyweather_meta?: AiCityForecastMeta | null;
  } | null;
};
export type AiCityForecastState = {
  status: "idle" | "loading" | "ready" | "failed";
  payload?: AiCityForecastPayload | null;
  error?: string | null;
  streamText?: string | null;
  streamRaw?: string | null;
};
