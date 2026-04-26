export type AiPinnedCity = {
  cityName: string;
  displayName?: string | null;
  addedAt: number;
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
  } | null;
};
export type AiCityForecastState = {
  status: "idle" | "loading" | "ready" | "failed";
  payload?: AiCityForecastPayload | null;
  error?: string | null;
  streamText?: string | null;
  streamRaw?: string | null;
};

export type AiMetarSummaryPayload = {
  status?: string | null;
  summary?: string | null;
  reason?: string | null;
  degraded?: boolean | null;
  duration_ms?: number | null;
  model?: string | null;
  provider?: string | null;
};

export type AiMetarSummaryState = {
  status: "idle" | "loading" | "ready" | "failed";
  payload?: AiMetarSummaryPayload | null;
  error?: string | null;
  streamText?: string | null;
};

