export type V4TradeDecision = {
  decision: "approve" | "downgrade" | "veto" | "watchlist";
  label: string;
  tone: "approve" | "downgrade" | "veto" | "watchlist";
  reason: string;
  metarSummary?: string | null;
  airportReport?: string | null;
  metarEvidence: string[];
};

export type V4CityForecast = {
  predicted: number | null;
  low: number | null;
  high: number | null;
  confidence?: string | null;
  peakWindow?: string | null;
  airportRead?: string | null;
  weatherRead?: string | null;
  paceRead?: string | null;
  paceTone?: "warm" | "cold" | "neutral" | string | null;
  paceDelta?: number | null;
  paceAdjustedHigh?: number | null;
  reason?: string | null;
  modelNote?: string | null;
  source: "ai" | "fallback";
};
