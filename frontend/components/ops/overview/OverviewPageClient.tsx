"use client";

import { useEffect, useState } from "react";
import { RefreshCcw, TrendingUp, Users, CreditCard, Database, Activity, Cpu } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { opsApi } from "@/lib/ops-api";
import Link from "next/link";
import type { SystemStatusPayload, MembershipsPayload, MembershipEntry } from "@/types/ops";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

function KpiCard({ href, icon: Icon, label, value, color, sub }: {
  href: string; icon: React.ElementType; label: string; value: string | number; color: string; sub?: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="hover:bg-white/[0.04] transition-colors cursor-pointer h-full">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Icon className={`h-4 w-4 ${color}`} />
            <span className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</span>
          </div>
          <div className={`text-xl font-bold ${color}`}>{value}</div>
          {sub ? <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div> : null}
        </CardContent>
      </Card>
    </Link>
  );
}

export function OverviewPageClient() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SystemStatusPayload | null>(null);
  const [memberships, setMemberships] = useState<MembershipEntry[]>([]);
  const [funnel, setFunnel] = useState<{ steps: { label: string; count: number; pct_of_prev?: number }[] } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [s, m, f] = await Promise.all([
        opsApi.systemStatus() as Promise<SystemStatusPayload>,
        opsApi.memberships() as Promise<MembershipsPayload>,
        opsApi.funnel(30),
      ]);
      setStatus(s);
      setMemberships((m as MembershipsPayload).memberships ?? []);
      setFunnel(f);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-40 bg-white/5 rounded" />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 bg-white/5 rounded-2xl" />
        ))}
      </div>
    </div>
  );

  // ── Derived data ──
  const paid = memberships.filter((m) => !m.is_trial).length;
  const trials = memberships.filter((m) => m.is_trial).length;
  const steps = funnel?.steps ?? [];
  const totalUsers = steps[0]?.count ?? 0;
  const payingUsers = steps[5]?.count ?? 0;
  const convRate = totalUsers > 0 ? ((payingUsers / totalUsers) * 100).toFixed(1) : "—";
  const cache = status?.cache;
  const cacheAnalysis = cache?.analysis;
  const td = status?.training_data;
  const features = status?.features;

  // Cache bucket data for bar chart
  const cacheBuckets = cache ? [
    { name: "API", value: cache.api_cache_entries ?? 0 },
    { name: "预报", value: cache.open_meteo_forecast_entries ?? 0 },
    { name: "METAR", value: cache.metar_entries ?? 0 },
    { name: "TAF", value: cache.taf_entries ?? 0 },
    { name: "结算", value: cache.settlement_entries ?? 0 },
  ].filter((d) => d.value > 0) : [];

  // Cache pie
  const cachePie = cacheAnalysis ? [
    { name: "命中", value: cacheAnalysis.cache_hits ?? 0, color: "#22c55e" },
    { name: "未命中", value: cacheAnalysis.cache_misses ?? 0, color: "#f59e0b" },
    { name: "强制刷新", value: cacheAnalysis.force_refresh_requests ?? 0, color: "#3b82f6" },
  ] : [];

  // Membership pie
  const memberPie = [
    { name: "付费", value: paid, color: "#22c55e" },
    ...(trials > 0 ? [{ name: "体验", value: trials, color: "#f59e0b" }] : []),
  ];

  // Plan breakdown
  const planCounts: Record<string, number> = {};
  memberships.forEach((m) => {
    const code = m.plan_code ?? "unknown";
    planCounts[code] = (planCounts[code] ?? 0) + 1;
  });
  const planBreakdown = Object.entries(planCounts)
    .map(([k, v]) => {
      const label = k.startsWith("signup_trial") ? "3天体验" : k === "pro_monthly" ? "月付" : k === "pro_quarterly" ? "季付" : k === "pro_yearly" ? "年付" : k;
      return { name: label, value: v };
    })
    .sort((a, b) => b.value - a.value);

  const truthRows = td?.truth_records?.row_count ?? 0;
  const coverage = td?.city_coverage;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">总览</h1>
          <p className="text-xs text-slate-500 mt-1">系统实时数据快照</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCcw className="h-3.5 w-3.5" /> 刷新
        </Button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <KpiCard href="/ops/system" icon={Activity} label="系统" value={status?.db?.ok ? "OK" : "FAIL"} color={status?.db?.ok ? "text-emerald-400" : "text-red-400"} />
        <KpiCard href="/ops/memberships" icon={Users} label="付费会员" value={paid} color="text-cyan-400" sub={trials > 0 ? `+${trials} 体验` : undefined} />
        <KpiCard href="/ops/analytics" icon={TrendingUp} label="30天转化" value={`${convRate}%`} color="text-blue-400" sub={`${totalUsers} → ${payingUsers}`} />
        <KpiCard href="/ops/training" icon={Database} label="真值记录" value={truthRows} color="text-purple-400" sub={`${coverage?.with_truth_rows ?? 0} 城市`} />
        <KpiCard href="/ops/payments" icon={CreditCard} label="支付成功" value={payingUsers} color="text-emerald-400" sub="30天内" />
        <KpiCard href="/ops/system" icon={Cpu} label="概率引擎" value={status?.probability?.engine_mode ?? "—"} color="text-amber-400" />
      </div>

      {/* Main grid: 2 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Column 1 */}
        <div className="space-y-5">

          {/* Funnel mini chart */}
          {steps.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">30天转化漏斗</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={[...steps].reverse().map((s) => ({ name: s.label, count: s.count }))} layout="vertical" margin={{ left: 80, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} width={75} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e2e8f0", fontSize: 12 }} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="#06b6d4" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Cache buckets */}
          {cacheBuckets.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">缓存桶分布</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={cacheBuckets} layout="vertical" margin={{ left: 50, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} width={45} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e2e8f0", fontSize: 12 }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} fill="#6366f1" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Features */}
          {features && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">功能开关</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(features).map(([k, v]) => (
                    <Badge key={k} variant={v ? "default" : "secondary"} className="text-[11px]">
                      {k.replace(/_/g, " ")}: {String(v)}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Column 2 */}
        <div className="space-y-5">

          {/* Membership donut + plan breakdown side by side */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">会员分布</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="w-36 h-36 shrink-0">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={memberPie} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={2} dataKey="value">
                        {memberPie.map((d, i) => (<Cell key={i} fill={d.color} />))}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e2e8f0", fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-1.5 text-sm">
                  {memberPie.map((d) => (
                    <div key={d.name} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="text-slate-400">{d.name}</span>
                      <span className="text-white font-bold ml-auto">{d.value}</span>
                    </div>
                  ))}
                  {planBreakdown.length > 0 && (
                    <div className="pt-2 mt-2 border-t border-white/10 space-y-1">
                      {planBreakdown.map((p) => (
                        <div key={p.name} className="flex justify-between text-xs">
                          <span className="text-slate-500">{p.name}</span>
                          <span className="text-slate-300">{p.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cache hit rate donut */}
          {cachePie.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  缓存分析{" "}
                  {cacheAnalysis?.hit_rate != null && (
                    <span className="text-emerald-400 font-normal">{(cacheAnalysis.hit_rate * 100).toFixed(1)}% 命中</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <div className="w-36 h-36 shrink-0">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={cachePie} cx="50%" cy="50%" innerRadius={36} outerRadius={58} paddingAngle={2} dataKey="value">
                          {cachePie.map((d, i) => (<Cell key={i} fill={d.color} />))}
                        </Pie>
                        <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e2e8f0", fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-slate-500 text-xs">总请求</div>
                      <div className="text-white font-bold">{cacheAnalysis?.total_requests ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-xs">强制刷新</div>
                      <div className="text-blue-400 font-bold">{cacheAnalysis?.force_refresh_requests ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-xs">命中</div>
                      <div className="text-emerald-400 font-bold">{cacheAnalysis?.cache_hits ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-xs">未命中</div>
                      <div className="text-amber-400 font-bold">{cacheAnalysis?.cache_misses ?? 0}</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Training data summary */}
          {coverage && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">城市模型覆盖</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-white/5 p-3 text-center">
                    <div className="text-xl font-bold text-cyan-400">{coverage.total_cities ?? 0}</div>
                    <div className="text-[11px] text-slate-500">总城市</div>
                  </div>
                  <div className="rounded-xl bg-white/5 p-3 text-center">
                    <div className="text-xl font-bold text-emerald-400">{coverage.with_truth_rows ?? 0}</div>
                    <div className="text-[11px] text-slate-500">有真值</div>
                  </div>
                  <div className="rounded-xl bg-white/5 p-3 text-center">
                    <div className="text-xl font-bold text-purple-400">{coverage.with_emos_samples ?? 0}</div>
                    <div className="text-[11px] text-slate-500">有EMOS</div>
                  </div>
                  <div className="rounded-xl bg-white/5 p-3 text-center">
                    <div className="text-xl font-bold text-amber-400">{coverage.with_lgbm_samples ?? 0}</div>
                    <div className="text-[11px] text-slate-500">有LGBM</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
