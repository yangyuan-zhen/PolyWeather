"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Activity, Cpu, CreditCard, Database, RefreshCcw, TrendingUp, Users } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { opsApi } from "@/lib/ops-api";
import type { MembershipEntry, MembershipsPayload, SystemStatusPayload } from "@/types/ops";

const OverviewCharts = dynamic(
  () => import("./OverviewCharts").then((mod) => mod.OverviewCharts),
  {
    ssr: false,
    loading: () => <div className="h-[360px] animate-pulse rounded-lg bg-slate-100" />,
  },
);

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
  const [funnel, setFunnel] = useState<{ steps: { key?: string; label: string; count: number; pct_of_prev?: number; uniqueActors?: number }[] } | null>(null);
  const [growth, setGrowth] = useState<{ date: string; trial: number; paid: number; total: number; cumulative: number }[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [s, m, f] = await Promise.all([
        opsApi.systemStatus() as Promise<SystemStatusPayload>,
        opsApi.membershipsOverview(200, 30) as Promise<MembershipsPayload & { daily?: { date: string; trial: number; paid: number; total: number; cumulative: number }[] }>,
        opsApi.funnel(30),
      ]);
      setStatus(s);
      setMemberships((m as MembershipsPayload).memberships ?? []);
      setFunnel(f);
      setGrowth(m?.daily ?? []);
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

  const paid = memberships.filter((m) => !m.is_trial).length;
  const trials = memberships.filter((m) => m.is_trial).length;
  const steps = funnel?.steps ?? [];
  const totalUsers = steps[0]?.count ?? 0;
  const stepByKey = Object.fromEntries(steps.map((step) => [step.key || step.label, step]));
  const payingUsers = stepByKey.payment_success?.count ?? 0;
  const convRate = totalUsers > 0 ? ((payingUsers / totalUsers) * 100).toFixed(1) : "—";
  const cache = status?.cache;
  const cacheAnalysis = cache?.analysis;
  const td = status?.training_data;
  const features = status?.features;
  const coverage = td?.city_coverage;
  const truthRows = td?.truth_records?.row_count ?? 0;

  const cacheBuckets = cache ? [
    { name: "API", value: cache.api_cache_entries ?? 0 },
    { name: "预报", value: cache.open_meteo_forecast_entries ?? 0 },
    { name: "METAR", value: cache.metar_entries ?? 0 },
    { name: "TAF", value: cache.taf_entries ?? 0 },
    { name: "结算", value: cache.settlement_entries ?? 0 },
  ].filter((d) => d.value > 0) : [];

  const cachePie = cacheAnalysis ? [
    { name: "命中", value: cacheAnalysis.cache_hits ?? 0, color: "#22c55e" },
    { name: "未命中", value: cacheAnalysis.cache_misses ?? 0, color: "#f59e0b" },
    { name: "强制刷新", value: cacheAnalysis.force_refresh_requests ?? 0, color: "#3b82f6" },
  ] : [];

  const memberPie = [
    { name: "付费", value: paid, color: "#22c55e" },
    ...(trials > 0 ? [{ name: "体验", value: trials, color: "#f59e0b" }] : []),
  ];

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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <KpiCard href="/ops/system" icon={Activity} label="系统" value={status?.db?.ok ? "OK" : "FAIL"} color={status?.db?.ok ? "text-emerald-400" : "text-red-400"} />
        <KpiCard href="/ops/memberships" icon={Users} label="付费会员" value={paid} color="text-cyan-400" sub={trials > 0 ? `+${trials} 体验` : undefined} />
        <KpiCard href="/ops/analytics" icon={TrendingUp} label="30天转化" value={`${convRate}%`} color="text-blue-400" sub={`${totalUsers} → ${payingUsers}`} />
        <KpiCard href="/ops/training" icon={Database} label="真值记录" value={truthRows} color="text-purple-400" sub={`${coverage?.with_truth_rows ?? 0} 城市`} />
        <KpiCard href="/ops/payments" icon={CreditCard} label="支付成功" value={payingUsers} color="text-emerald-400" sub="30天内" />
        <KpiCard href="/ops/system" icon={Cpu} label="概率引擎" value={status?.probability?.engine_mode ?? "—"} color="text-amber-400" />
      </div>

      <OverviewCharts
        growth={growth}
        steps={steps}
        cacheBuckets={cacheBuckets}
        memberPie={memberPie}
        planBreakdown={planBreakdown}
        cachePie={cachePie}
        cacheAnalysis={cacheAnalysis}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
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
                  <div className="text-xl font-bold text-purple-400">{coverage.with_feature_rows ?? 0}</div>
                  <div className="text-[11px] text-slate-500">有特征</div>
                </div>
                <div className="rounded-xl bg-white/5 p-3 text-center">
                  <div className="text-xl font-bold text-amber-400">{td?.truth_records?.row_count ?? 0}</div>
                  <div className="text-[11px] text-slate-500">真值行数</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
