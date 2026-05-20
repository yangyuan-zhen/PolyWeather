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
  paymentRuntime() {
    return opsFetch<Record<string, unknown>>("/api/payments/runtime");
  },
  async funnel(days = 30) {
    const raw = await opsFetch<{
      events?: Record<string, { total?: number; unique_users?: number }>;
      rates?: Record<string, number>;
      window_days?: number;
    }>(`/api/ops/analytics/funnel?days=${days}`);
    const stepOrder = ["signup_completed", "dashboard_active", "paywall_feature_clicked", "paywall_viewed", "checkout_started", "checkout_succeeded"];
    const stepLabels: Record<string, string> = {
      signup_completed: "注册",
      dashboard_active: "活跃",
      paywall_feature_clicked: "点击付费",
      paywall_viewed: "看到入口",
      checkout_started: "发起支付",
      checkout_succeeded: "支付成功",
    };
    const steps = stepOrder.map((key, i) => {
      const evt = raw?.events?.[key];
      const count = evt?.total ?? 0;
      let pct_of_prev: number | undefined;
      if (i > 0) {
        const prevCount = raw?.events?.[stepOrder[i - 1]]?.total ?? 0;
        pct_of_prev = prevCount > 0 ? Math.round((count / prevCount) * 100) : 0;
      } else {
        pct_of_prev = 100;
      }
      return { label: stepLabels[key] ?? key, count, pct_of_prev };
    });
    return { steps, rates: raw?.rates, window_days: raw?.window_days };
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
  resolveIncident(eventId: string | number) {
    return opsFetch<Record<string, unknown>>(`/api/ops/payments/incidents/${eventId}/resolve`, {
      method: "POST",
    });
  },
  truthHistory(params: Record<string, string>) {
    const qs = new URLSearchParams(params).toString();
    return opsFetch<Record<string, unknown>>(`/api/ops/truth-history?${qs}`);
  },
};
