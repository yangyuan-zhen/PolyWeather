"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Database, RefreshCcw, ShieldCheck, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type HealthPayload = {
  status?: string;
  db?: { ok?: boolean };
};

type ProbabilityRollout = {
  decision?: string;
  ready_for_primary?: boolean;
  blocking_reasons?: string[];
};

type SystemStatusPayload = {
  state_storage_mode?: string;
  sqlite?: { ok?: boolean; path?: string };
  features?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  probability?: {
    mode?: string;
    rollout?: ProbabilityRollout;
  };
  integrations?: Record<string, unknown>;
};

type PaymentRuntimePayload = {
  checkout?: {
    enabled?: boolean;
    configured?: boolean;
    chain_id?: number;
    receiver_contract?: string;
    confirmations?: number;
  };
  rpc?: {
    configured_rpc_count?: number;
    active_rpc_url?: string;
  };
  event_loop_state?: {
    last_scanned_block?: number;
    updated_at?: string;
  };
  recent_audit_events?: Array<{
    id: number;
    event_type: string;
    created_at: string;
  }>;
};

type AuthMePayload = {
  authenticated?: boolean;
  email?: string | null;
  entitlement_mode?: string;
  subscription_active?: boolean | null;
  weekly_rank?: number | null;
  points?: number;
};

type OpsUser = {
  telegram_id: number;
  username?: string | null;
  points?: number;
  daily_points?: number;
  daily_points_date?: string | null;
  weekly_points?: number;
  weekly_points_week?: string | null;
  message_count?: number;
  supabase_email?: string | null;
  last_message_at?: string | null;
};

type WeeklyLeaderboardEntry = {
  telegram_id: number;
  username?: string | null;
  points?: number;
  message_count?: number;
  weekly_points?: number;
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function maskUrl(value?: string | null) {
  if (!value) return "-";
  if (value.length <= 40) return value;
  return `${value.slice(0, 28)}...${value.slice(-8)}`;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`${url} -> HTTP ${response.status} ${raw.slice(0, 180)}`);
  }
  return response.json() as Promise<T>;
}

export function OpsDashboard() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [status, setStatus] = useState<SystemStatusPayload | null>(null);
  const [payments, setPayments] = useState<PaymentRuntimePayload | null>(null);
  const [auth, setAuth] = useState<AuthMePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [users, setUsers] = useState<OpsUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<WeeklyLeaderboardEntry[]>([]);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantPoints, setGrantPoints] = useState("300");
  const [grantStatus, setGrantStatus] = useState<string | null>(null);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [grantLoading, setGrantLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthData, statusData, paymentData, authData] = await Promise.all([
        readJson<HealthPayload>("/api/healthz"),
        readJson<SystemStatusPayload>("/api/system/status"),
        readJson<PaymentRuntimePayload>("/api/payments/runtime"),
        readJson<AuthMePayload>("/api/auth/me"),
      ]);

      setHealth(healthData);
      setStatus(statusData);
      setPayments(paymentData);
      setAuth(authData);
      setRefreshedAt(new Date().toISOString());
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadUsers = useCallback(async (query: string) => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const url = new URL("/api/ops/users", window.location.origin);
      if (query.trim()) {
        url.searchParams.set("q", query.trim());
      }
      url.searchParams.set("limit", "20");
      const data = await readJson<{ users?: OpsUser[] }>(url.toString());
      setUsers(data.users || []);
    } catch (loadError) {
      setUsersError(String(loadError));
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadLeaderboard = useCallback(async () => {
    try {
      const data = await readJson<{ leaderboard?: WeeklyLeaderboardEntry[] }>(
        "/api/ops/leaderboard/weekly?limit=10",
      );
      setLeaderboard(data.leaderboard || []);
    } catch {
      setLeaderboard([]);
    }
  }, []);

  useEffect(() => {
    void loadUsers("");
    void loadLeaderboard();
  }, [loadLeaderboard, loadUsers]);

  const rolloutVariant = useMemo(() => {
    const decision = status?.probability?.rollout?.decision;
    if (decision === "promote") return "success" as const;
    if (decision === "observe") return "warning" as const;
    return "danger" as const;
  }, [status?.probability?.rollout?.decision]);

  const submitGrant = useCallback(async () => {
    setGrantLoading(true);
    setGrantError(null);
    setGrantStatus(null);
    try {
      const response = await fetch("/api/ops/users/grant-points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: grantEmail.trim(),
          points: Number(grantPoints),
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        detail?: { reason?: string };
        points_after?: number;
        points_added?: number;
        supabase_email?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload?.detail?.reason || `HTTP ${response.status}`,
        );
      }
      setGrantStatus(
        `${payload.supabase_email || grantEmail.trim()} 已补 ${payload.points_added || grantPoints} 分，当前 ${payload.points_after ?? "-"}`,
      );
      await loadUsers(searchQuery);
      await loadLeaderboard();
    } catch (submitError) {
      setGrantError(String(submitError));
    } finally {
      setGrantLoading(false);
    }
  }, [grantEmail, grantPoints, loadLeaderboard, loadUsers, searchQuery]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl backdrop-blur-xl lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="secondary">Ops</Badge>
              <Badge variant={health?.status === "ok" ? "success" : "danger"}>
                Health {health?.status || "unknown"}
              </Badge>
              <Badge variant={status?.sqlite?.ok ? "success" : "danger"}>
                SQLite {status?.sqlite?.ok ? "ok" : "error"}
              </Badge>
              <Badge variant={rolloutVariant}>
                EMOS {status?.probability?.rollout?.decision || "hold"}
              </Badge>
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight">PolyWeather Ops</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                直接挂在现有域名下的轻量运营页。先做只读运维视图，把系统状态、支付运行态和当前登录态聚合起来。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span>刷新时间: {formatDateTime(refreshedAt)}</span>
            <Button onClick={() => void load()} disabled={loading} className="gap-2">
              <RefreshCcw className="h-4 w-4" />
              {loading ? "加载中" : "刷新"}
            </Button>
          </div>
        </section>

        {error ? (
          <Card className="border-rose-500/30 bg-rose-500/10">
            <CardHeader>
              <CardTitle className="text-rose-300">加载失败</CardTitle>
              <CardDescription className="text-rose-200/80">{error}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> 系统健康
              </CardTitle>
              <CardDescription>后端健康、鉴权策略、状态存储模式。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-300">
              <div className="flex justify-between gap-3"><span>healthz</span><span>{health?.status || "-"}</span></div>
              <div className="flex justify-between gap-3"><span>鉴权模式</span><span>{auth?.entitlement_mode || "-"}</span></div>
              <div className="flex justify-between gap-3"><span>状态存储</span><span>{status?.state_storage_mode || "-"}</span></div>
              <div className="flex justify-between gap-3"><span>DB</span><span>{health?.db?.ok ? "ok" : "-"}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-4 w-4" /> 运行态存储
              </CardTitle>
              <CardDescription>SQLite 是否正常，以及 rollout 当前状态。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-300">
              <div className="flex justify-between gap-3"><span>SQLite</span><span>{status?.sqlite?.ok ? "ok" : "error"}</span></div>
              <div className="flex justify-between gap-3"><span>EMOS 模式</span><span>{status?.probability?.mode || "-"}</span></div>
              <div className="flex justify-between gap-3"><span>上线门禁</span><span>{status?.probability?.rollout?.decision || "-"}</span></div>
              <div className="flex justify-between gap-3"><span>ready_for_primary</span><span>{status?.probability?.rollout?.ready_for_primary ? "true" : "false"}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-4 w-4" /> 支付运行态
              </CardTitle>
              <CardDescription>当前 RPC、事件循环区块、合约配置。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-300">
              <div className="flex justify-between gap-3"><span>支付启用</span><span>{payments?.checkout?.enabled ? "true" : "false"}</span></div>
              <div className="flex justify-between gap-3"><span>RPC 数量</span><span>{payments?.rpc?.configured_rpc_count ?? 0}</span></div>
              <div className="flex justify-between gap-3"><span>链</span><span>{payments?.checkout?.chain_id ?? "-"}</span></div>
              <div className="flex justify-between gap-3"><span>最后区块</span><span>{payments?.event_loop_state?.last_scanned_block ?? "-"}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> 当前登录态
              </CardTitle>
              <CardDescription>先确认管理员自己当前有没有会话。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-300">
              <div className="flex justify-between gap-3"><span>authenticated</span><span>{auth?.authenticated ? "true" : "false"}</span></div>
              <div className="flex justify-between gap-3"><span>email</span><span className="truncate text-right">{auth?.email || "-"}</span></div>
              <div className="flex justify-between gap-3"><span>points</span><span>{auth?.points ?? 0}</span></div>
              <div className="flex justify-between gap-3"><span>weekly_rank</span><span>{auth?.weekly_rank ?? "-"}</span></div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>EMOS 上线门禁</CardTitle>
              <CardDescription>当前 shadow 到 primary 的发布判断。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-300">
              <div className="flex flex-wrap gap-2">
                <Badge variant={rolloutVariant}>{status?.probability?.rollout?.decision || "hold"}</Badge>
                <Badge variant={status?.probability?.rollout?.ready_for_primary ? "success" : "warning"}>
                  ready={status?.probability?.rollout?.ready_for_primary ? "true" : "false"}
                </Badge>
              </div>
              <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">阻塞原因</div>
                <ul className="space-y-2">
                  {(status?.probability?.rollout?.blocking_reasons || []).length ? (
                    (status?.probability?.rollout?.blocking_reasons || []).map((reason) => (
                      <li key={reason} className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2">
                        {reason}
                      </li>
                    ))
                  ) : (
                    <li className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2">当前无阻塞项</li>
                  )}
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>支付审计摘要</CardTitle>
              <CardDescription>先展示最新几条事件，日常巡检够用。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-300">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">RPC</div>
                <div className="mt-2 break-all text-xs text-slate-300">{maskUrl(payments?.rpc?.active_rpc_url)}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Receiver Contract</div>
                <div className="mt-2 break-all text-xs text-slate-300">{payments?.checkout?.receiver_contract || "-"}</div>
              </div>
              <div className="space-y-2">
                {(payments?.recent_audit_events || []).slice(0, 6).map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-slate-100">{item.event_type}</span>
                      <span className="text-xs text-slate-500">#{item.id}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{formatDateTime(item.created_at)}</div>
                  </div>
                ))}
                {!payments?.recent_audit_events?.length ? (
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-slate-500">暂无审计事件</div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>用户查询</CardTitle>
              <CardDescription>按 Telegram ID、用户名或 Supabase 邮箱搜用户。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-300">
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="telegram id / username / email"
                  className="h-10 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 outline-none ring-0"
                />
                <Button variant="secondary" onClick={() => void loadUsers(searchQuery)} disabled={usersLoading}>
                  {usersLoading ? "查询中" : "查询"}
                </Button>
              </div>
              {usersError ? <div className="text-rose-300">{usersError}</div> : null}
              <div className="space-y-3">
                {users.map((user) => (
                  <div key={user.telegram_id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-100">{user.username || "(未命名用户)"}</div>
                        <div className="text-xs text-slate-500">
                          TG {user.telegram_id} · {user.supabase_email || "未绑定邮箱"}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">总分 {user.points ?? 0}</Badge>
                        <Badge variant="warning">周分 {user.weekly_points ?? 0}</Badge>
                        <Badge variant="default">发言 {user.message_count ?? 0}</Badge>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      今日积分 {user.daily_points ?? 0} · 最近发言 {formatDateTime(user.last_message_at)}
                    </div>
                  </div>
                ))}
                {!users.length && !usersLoading ? (
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-slate-500">没有匹配用户</div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>积分运营</CardTitle>
              <CardDescription>先做最小版：按 Supabase 邮箱手动补分。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-300">
              <div className="space-y-3">
                <input
                  value={grantEmail}
                  onChange={(event) => setGrantEmail(event.target.value)}
                  placeholder="user@example.com"
                  className="h-10 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 outline-none ring-0"
                />
                <input
                  value={grantPoints}
                  onChange={(event) => setGrantPoints(event.target.value)}
                  placeholder="300"
                  className="h-10 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 outline-none ring-0"
                />
                <Button onClick={() => void submitGrant()} disabled={grantLoading || !grantEmail.trim()} className="w-full">
                  {grantLoading ? "提交中" : "补分"}
                </Button>
              </div>
              {grantStatus ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-300">{grantStatus}</div> : null}
              {grantError ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-300">{grantError}</div> : null}

              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">本周榜前 10</div>
                {(leaderboard || []).map((item, index) => (
                  <div key={item.telegram_id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2">
                    <div>
                      <div className="font-semibold text-slate-100">#{index + 1} {item.username || "(未命名用户)"}</div>
                      <div className="text-xs text-slate-500">TG {item.telegram_id}</div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-amber-300">周分 {item.weekly_points ?? 0}</div>
                      <div className="text-slate-500">总分 {item.points ?? 0}</div>
                    </div>
                  </div>
                ))}
                {!leaderboard.length ? (
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-slate-500">当前没有周榜数据</div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
