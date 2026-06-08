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
    };
    model_cities?: {
      strongest?: Array<{ city: string; truth_rows?: number; feature_rows?: number }>;
      gaps?: string[];
    };
  };
};

export type SourceHealthSource = {
  role?: string;
  source_code?: string;
  source_label?: string;
  station_code?: string | null;
  station_label?: string | null;
  status?: "fresh" | "expected_wait" | "delayed" | "stale" | "missing" | "unknown" | string;
  reason?: string | null;
  age_sec?: number | null;
  age_min?: number | null;
  observed_at?: string | null;
  expected_next_update_at?: string | null;
  temp?: number | null;
};

export type SourceHealthCity = {
  city: string;
  cache_exists?: boolean;
  cache_updated_at?: string | null;
  cache_age_sec?: number | null;
  source_count?: number;
  worst_status?: string;
  sources?: SourceHealthSource[];
};

export type SourceHealthPayload = {
  checked_at?: string;
  cities?: SourceHealthCity[];
  status_counts?: Record<string, number>;
  total_cities?: number;
};

export type ObservationCollectorStatus =
  | "ok"
  | "due"
  | "cooldown"
  | "failed"
  | "never_run"
  | string;

export type ObservationCollectorEntry = {
  source: string;
  city: string;
  interval_sec?: number;
  last_due_at?: string | null;
  last_started_at?: string | null;
  last_success_at?: string | null;
  last_failure_at?: string | null;
  last_latency_ms?: number | null;
  failure_count?: number;
  last_error?: string | null;
  updated_at?: string | null;
  next_due_at?: string | null;
  due_in_sec?: number | null;
  age_sec?: number | null;
  in_cooldown?: boolean;
  cooldown_until_at?: string | null;
  status?: ObservationCollectorStatus;
};

export type ObservationCollectorSourceSummary = {
  source: string;
  city_count?: number;
  interval_sec?: number;
  min_interval_sec?: number;
  max_interval_sec?: number;
  failure_count?: number;
  cooldown_count?: number;
  status_counts?: Record<string, number>;
  avg_latency_ms?: number | null;
  last_success_at?: string | null;
  last_failure_at?: string | null;
  worst_status?: ObservationCollectorStatus;
};

export type ObservationCollectorStatusPayload = {
  checked_at?: string;
  entries?: ObservationCollectorEntry[];
  sources?: ObservationCollectorSourceSummary[];
  status_counts?: Record<string, number>;
  total_entries?: number;
};

export type PaymentRuntimePayload = {
  rpc?: Record<string, unknown> | string;
  chain_id?: number;
  receiver_contract?: string;
  last_scanned_block?: number;
  audit_events_count?: number;
  checkout?: Record<string, unknown>;
  event_loop_state?: Record<string, unknown>;
  recent_audit_events?: Array<Record<string, unknown>>;
  recent_events?: Array<Record<string, unknown>>;
};

export type PaymentIncident = {
  id: number;
  event_type?: string;
  reason?: string;
  detail?: string;
  intent_id?: string;
  user_id?: string;
  tx_hash?: string;
  payload_json?: string;
  created_at?: string;
  resolved?: boolean;
  resolved_at?: string;
  resolved_by?: string;
  occurrence_count?: number;
  event_ids?: number[];
  first_seen_at?: string;
  last_seen_at?: string;
};

export type IncidentsPayload = {
  incidents?: PaymentIncident[];
  total?: number;
};

export type PaymentRecord = {
  id: number;
  user_id?: string;
  amount?: number;
  currency?: string;
  chain?: string;
  tx_hash?: string;
  status?: string;
  created_at?: string;
};

export type PaymentsPayload = {
  payments?: PaymentRecord[];
  total?: number;
};

export type UserFeedbackEntry = {
  id: number;
  category?: string;
  message?: string;
  source?: string;
  status?: string;
  contact?: string;
  user_id?: string;
  user_email?: string;
  context?: Record<string, unknown>;
  reward_points?: number;
  reward_reason?: string;
  rewarded_at?: string | null;
  reward_status?: string;
  created_at?: string;
  updated_at?: string;
};

export type UserFeedbackPayload = {
  feedback?: UserFeedbackEntry[];
  total?: number;
  status_counts?: Record<string, number>;
};

export type BillingRiskIssue = {
  category?: string;
  severity?: "high" | "medium" | "low" | string;
  title?: string;
  detail?: string;
  user_id?: string;
  created_at?: string;
  reference?: string;
  payload?: Record<string, unknown>;
};

export type BillingRiskPayload = {
  checked_at?: string;
  window_days?: number;
  summary?: {
    issues?: number;
    stuck_intents?: number;
    trial_gaps?: number;
    payment_incidents?: number;
    points_discount_issues?: number;
    referral_settlement_issues?: number;
    monthly_cap_hits?: number;
    recent_referral_rewards?: number;
    recent_trial_claims?: number;
  };
  issues?: BillingRiskIssue[];
  stuck_intents?: Array<Record<string, unknown>>;
  trial_gaps?: Array<Record<string, unknown>>;
  payment_incidents?: Array<Record<string, unknown>>;
  points_discount_issues?: Array<Record<string, unknown>>;
  referral_settlement_issues?: Array<Record<string, unknown>>;
  monthly_cap_hits?: Array<Record<string, unknown>>;
  recent_referral_rewards?: Array<Record<string, unknown>>;
  recent_trial_claims?: Array<Record<string, unknown>>;
  query_errors?: Array<{ table?: string; error?: string }>;
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
  source?: string;
  is_trial?: boolean;
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
