type FetchOptions = RequestInit & { timeoutMs?: number };

async function opsFetch<T>(url: string, options?: FetchOptions): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...options });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const opsApi = {
  health() {
    return opsFetch<{ status: string }>("/api/healthz");
  },
  systemStatus() {
    return opsFetch<Record<string, unknown>>("/api/system/status");
  },
  sourceHealth(limit = 80) {
    return opsFetch<Record<string, unknown>>(`/api/ops/source-health?limit=${limit}`);
  },
  paymentRuntime() {
    return opsFetch<Record<string, unknown>>("/api/payments/runtime");
  },
  listPayments(limit = 50) {
    return opsFetch<{ payments?: Array<Record<string, unknown>>; total?: number }>(`/api/ops/payments?limit=${limit}`);
  },
  billingRisk(days = 30, limit = 80) {
    return opsFetch<Record<string, unknown>>(`/api/ops/billing-risk?days=${days}&limit=${limit}`);
  },
  async funnel(days = 30) {
    const raw = await opsFetch<{
      events?: Record<string, { total?: number; unique_users?: number; unique_actors?: number }>;
      diagnostics?: Record<string, { total?: number; unique_actors?: number; by_reason?: { name: string; count: number }[] }>;
      rates?: Record<string, number>;
      traffic?: {
        referrers?: { name: string; count: number }[];
        countries?: { name: string; count: number }[];
        devices?: { name: string; count: number }[];
        landing_paths?: { name: string; count: number }[];
      };
      window_days?: number;
    }>(`/api/ops/analytics/funnel?days=${days}`);
    const stepOrder = ["landing_view", "enter_terminal", "login_start", "signup_success", "trial_created", "payment_start", "payment_success"];
    const stepLabels: Record<string, string> = {
      landing_view: "访问落地页",
      enter_terminal: "进入终端",
      login_start: "开始登录",
      signup_success: "注册成功",
      trial_created: "试用开通",
      payment_start: "发起支付",
      payment_success: "支付成功",
    };
    const steps = stepOrder.map((key, i) => {
      const evt = raw?.events?.[key];
      const count = evt?.total ?? 0;
      const uniqueActors = evt?.unique_actors ?? evt?.unique_users ?? 0;
      let pct_of_prev: number | undefined;
      if (i > 0) {
        const prevCount = raw?.events?.[stepOrder[i - 1]]?.total ?? 0;
        pct_of_prev = prevCount > 0 ? Math.round((count / prevCount) * 100) : 0;
      } else {
        pct_of_prev = 100;
      }
      return { key, label: stepLabels[key] ?? key, count, uniqueActors, pct_of_prev };
    });
    return {
      diagnostics: raw?.diagnostics ?? {},
      rates: raw?.rates,
      steps,
      traffic: raw?.traffic ?? {},
      window_days: raw?.window_days,
    };
  },
  users(q: string, limit = 20) {
    return opsFetch<Record<string, unknown>>(`/api/ops/users?q=${encodeURIComponent(q)}&limit=${limit}`);
  },
  grantPoints(email: string, points: number) {
    return opsFetch<Record<string, unknown>>("/api/ops/users/grant-points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, points }),
    });
  },
  leaderboard(limit = 10) {
    return opsFetch<Record<string, unknown>>(`/api/ops/leaderboard/weekly?limit=${limit}`);
  },
  memberships() {
    return opsFetch<Record<string, unknown>>("/api/ops/memberships?limit=200");
  },
  membershipsOverview(limit = 200, days = 90) {
    return opsFetch<{
      memberships?: Array<Record<string, unknown>>;
      days?: number;
      daily?: { date: string; trial: number; paid: number; total: number; cumulative: number }[];
    }>(`/api/ops/memberships/overview?limit=${limit}&days=${days}`);
  },
  membershipsGrowth(days = 90) {
    return opsFetch<{
      days: number;
      daily: { date: string; trial: number; paid: number; total: number; cumulative: number }[];
    }>(`/api/ops/memberships/growth?days=${days}`);
  },
  incidents(limit = 20, reason?: string) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (reason) params.set("reason", reason);
    return opsFetch<Record<string, unknown>>(`/api/ops/payments/incidents?${params}`);
  },
  feedback(limit = 100, status?: string) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status) params.set("status", status);
    return opsFetch<Record<string, unknown>>(`/api/ops/feedback?${params}`);
  },
  updateFeedbackStatus(feedbackId: string | number, status: string) {
    return opsFetch<Record<string, unknown>>(`/api/ops/feedback/${feedbackId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  },
  resolveIncident(eventId: string | number) {
    return opsFetch<Record<string, unknown>>(`/api/ops/payments/incidents/${eventId}/resolve`, {
      method: "POST",
    });
  },
  truthHistory(params: Record<string, string>) {
    const qs = new URLSearchParams(params).toString();
    return opsFetch<Record<string, unknown>>(`/api/ops/truth-history?${qs}`);
  },
  userSubscriptions(email: string) {
    return opsFetch<{
      email: string;
      user_id: string;
      subscriptions: Array<{
        id?: string;
        user_id?: string;
        status?: string;
        plan_code?: string;
        source?: string;
        starts_at?: string;
        expires_at?: string;
        created_at?: string;
        updated_at?: string;
      }>;
      count: number;
    }>(`/api/ops/subscriptions/user?email=${encodeURIComponent(email)}`);
  },
  trainingAccuracy() {
    return opsFetch<{
      accuracy: Array<{
        city_id: string;
        name: string;
        deb?: {
          hit_rate: number;
          mae: number;
          total_days: number;
          hits?: number;
          details_str: string;
        } | null;
        mu?: {
          mae: number;
          hit_rate: number;
          brier_score: number | null;
          total_days: number;
          hits?: number;
          details_str: string;
        } | null;
      }>;
      deb_summary?: {
        historical?: {
          city_count?: number;
          avg_hit_rate?: number | null;
          weighted_hit_rate?: number | null;
          avg_mae?: number | null;
          avg_days_per_city?: number;
          sample_days?: number;
          hits?: number;
        };
        recent_7d?: {
          start_date?: string | null;
          end_date?: string | null;
          samples?: number;
          hits?: number;
          hit_rate?: number | null;
          mae?: number | null;
          bias?: number | null;
          city_count?: number;
        };
        recent_14d?: {
          start_date?: string | null;
          end_date?: string | null;
          samples?: number;
          hits?: number;
          hit_rate?: number | null;
          mae?: number | null;
          bias?: number | null;
          city_count?: number;
        };
        versions?: Record<string, {
          version?: string;
          samples?: number;
          mae?: number | null;
          rmse?: number | null;
          bias?: number | null;
          bucket_hit_rate?: number | null;
        }>;
      };
    }>("/api/ops/training/accuracy");
  },
  telegramAudit() {
    return opsFetch<{
      anomalies: Array<{
        telegram_id: number;
        username: string;
        chat_id: string;
        status: string;
        anomaly_type: "unbound" | "expired" | "trial_only";
        reason: string;
        email: string | null;
        expires_at: string | null;
      }>;
      valid_count: number;
      anomaly_count: number;
      error?: string;
    }>("/api/ops/telegram/members-audit");
  },
};
