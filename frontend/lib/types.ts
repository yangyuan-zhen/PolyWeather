export type CitySummary = {
  name: string;
  display_name: string;
  lat: number;
  lon: number;
  risk_level: "low" | "medium" | "high";
  risk_emoji?: string;
  temp_unit: "fahrenheit" | "celsius";
  is_major?: boolean;
};

export type CityDetail = {
  name: string;
  display_name: string;
  lat: number;
  lon: number;
  temp_symbol: string;
  local_time: string;
  current?: {
    temp?: number | null;
    max_so_far?: number | null;
    wu_settlement?: number | null;
    cloud_desc?: string | null;
    wind_speed_kt?: number | null;
    obs_time?: string | null;
  };
  deb?: {
    prediction?: number | null;
  };
  probabilities?: {
    mu?: number | null;
    distribution?: Array<{ value: number; probability: number }>;
  };
  ai_analysis?: string;
};
