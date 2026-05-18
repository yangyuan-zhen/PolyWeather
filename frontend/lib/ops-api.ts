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
  funnel(days = 30) {
    return opsFetch<Record<string, unknown>>(`/api/ops/analytics/funnel?days=${days}`);
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
