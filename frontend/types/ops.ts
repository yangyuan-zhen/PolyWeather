export type HealthPayload = {
  status?: string;
  db?: { ok?: boolean };
};

export type SystemStatusPayload = {
  state_storage_mode?: string;
  db?: { ok?: boolean; db_path?: string };
  features?: Record<string, unknown>;
  cache?: {
    api_cache_entries?: number;
    open_meteo_forecast_entries?: number;
    metar_entries?: number;
    taf_entries?: number;
    settlement_entries?: number;
    analysis?: {
      total_requests?: number;
      cache_hits?: number;
      cache_misses?: number;
      force_refresh_requests?: number;
      hit_rate?: number | null;
    };
  };
  probability?: {
    engine_mode?: string;
    rollout?: Record<string, unknown>;
  };
  integrations?: Record<string, unknown>;
  training_data?: {
    truth_records?: {
      row_count?: number;
      cities_count?: number;
      min_date?: string | null;
      max_date?: string | null;
      source_counts?: Record<string, number>;
    };
    training_features?: {
      row_count?: number;
      cities_count?: number;
      min_date?: string | null;
      max_date?: string | null;
    };
    city_coverage?: {
      total_cities?: number;
      with_truth_rows?: number;
      with_feature_rows?: number;
      with_emos_samples?: number;
      with_lgbm_samples?: number;
    };
    emos_samples?: Record<string, unknown>;
    lgbm_samples?: Record<string, unknown>;
    model_cities?: {
      strongest?: Array<{ city: string; emos?: number; lgbm?: number }>;
      gaps?: string[];
    };
  };
};

export type PaymentRuntimePayload = {
  rpc?: string;
  chain_id?: number;
  receiver_contract?: string;
  last_scanned_block?: number;
  audit_events_count?: number;
  recent_events?: Array<Record<string, unknown>>;
};

export type PaymentIncident = {
  id: number;
  event_type?: string;
  reason?: string;
  payload_json?: string;
  created_at?: string;
  resolved?: boolean;
};

export type IncidentsPayload = {
  incidents?: PaymentIncident[];
  total?: number;
};

export type OpsUser = {
  telegram_id?: number;
  username?: string;
  supabase_email?: string;
  points?: number;
  weekly_points?: number;
  message_count?: number;
};

export type UsersPayload = {
  users?: OpsUser[];
};

export type GrantPointsResult = {
  ok?: boolean;
  points_added?: number;
  points_after?: number;
  reason?: string;
};

export type MembershipEntry = {
  email?: string;
  username?: string;
  user_id?: string;
  starts_at?: string;
  expires_at?: string;
  total_expires_at?: string;
  queued_days?: number;
  queued_count?: number;
  plan_code?: string;
};

export type MembershipsPayload = {
  memberships?: MembershipEntry[];
  total?: number;
};

export type LeaderboardEntry = {
  telegram_id?: number;
  username?: string;
  weekly_points?: number;
  rank?: number;
};

export type LeaderboardPayload = {
  leaderboard?: LeaderboardEntry[];
};

export type FunnelPayload = {
  steps?: Array<{
    label: string;
    count: number;
    pct_of_prev?: number;
  }>;
  period_days?: number;
};

export type TruthHistoryPayload = {
  rows?: Array<Record<string, unknown>>;
  total?: number;
};

export type ConfigEntry = {
  key: string;
  value: string;
  description: string;
};
