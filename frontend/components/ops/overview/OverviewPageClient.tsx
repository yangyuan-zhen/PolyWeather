"use client";

import { useEffect, useState } from "react";
import { RefreshCcw, TrendingUp, Users, CreditCard, Database, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { opsApi } from "@/lib/ops-api";
import Link from "next/link";
import type { SystemStatusPayload, MembershipsPayload, FunnelPayload } from "@/types/ops";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from "recharts";

export function OverviewPageClient() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SystemStatusPayload | null>(null);
  const [memberships, setMemberships] = useState<MembershipsPayload | null>(null);
  const [funnel, setFunnel] = useState<FunnelPayload | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [s, m, f] = await Promise.all([
        opsApi.systemStatus() as Promise<SystemStatusPayload>,
        opsApi.memberships() as Promise<MembershipsPayload>,
        opsApi.funnel(7) as Promise<FunnelPayload>,
      ]);
      setStatus(s);
      setMemberships(m);
      setFunnel(f);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  if (loading) return <div className="text-slate-400 animate-pulse">加载中...</div>;

  const cacheAnalysis = status?.cache?.analysis;
  const cacheData = cacheAnalysis ? [
    { name: "命中", value: cacheAnalysis.cache_hits ?? 0, color: "#22c55e" },
    { name: "未命中", value: cacheAnalysis.cache_misses ?? 0, color: "#f59e0b" },
    { name: "强制刷新", value: cacheAnalysis.force_refresh_requests ?? 0, color: "#3b82f6" },
  ].filter((d) => d.value > 0) : [];

  const mems = memberships?.memberships ?? [];
  const paid = mems.filter((m) => !(m as Record<string, unknown>).is_trial).length;
  const trials = mems.filter((m) => (m as Record<string, unknown>).is_trial).length;

  const steps = funnel?.steps ?? [];
  const totalUsers = steps[0]?.count ?? 0;
  const payingUsers = steps[5]?.count ?? 0;
  const convRate = totalUsers > 0 ? ((payingUsers / totalUsers) * 100).toFixed(1) : "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">总览</h1>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCcw className="h-3.5 w-3.5" /> 刷新
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Link href="/ops/system" className="block">
          <Card className="hover:bg-white/[0.03] transition-colors cursor-pointer">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className={`h-4 w-4 ${status?.db?.ok ? "text-emerald-400" : "text-red-400"}`} />
                <span className="text-xs text-slate-500">系统状态</span>
              </div>
              <div className="text-lg font-bold text-white">{status?.db?.ok ? "OK" : "—"}</div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/ops/memberships" className="block">
          <Card className="hover:bg-white/[0.03] transition-colors cursor-pointer">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-cyan-400" />
                <span className="text-xs text-slate-500">付费会员</span>
              </div>
              <div className="text-lg font-bold text-cyan-400">{paid}</div>
              {trials > 0 && <div className="text-xs text-slate-500 mt-0.5">体验 {trials}</div>}
            </CardContent>
          </Card>
        </Link>
        <Link href="/ops/payments" className="block">
          <Card className="hover:bg-white/[0.03] transition-colors cursor-pointer">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="h-4 w-4 text-emerald-400" />
                <span className="text-xs text-slate-500">支付成功</span>
              </div>
              <div className="text-lg font-bold text-emerald-400">{payingUsers}</div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/ops/analytics" className="block">
          <Card className="hover:bg-white/[0.03] transition-colors cursor-pointer">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-blue-400" />
                <span className="text-xs text-slate-500">转化率</span>
              </div>
              <div className="text-lg font-bold text-blue-400">{convRate}%</div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/ops/training" className="block">
          <Card className="hover:bg-white/[0.03] transition-colors cursor-pointer">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Database className="h-4 w-4 text-purple-400" />
                <span className="text-xs text-slate-500">训练数据</span>
              </div>
              <div className="text-lg font-bold text-purple-400">
                {status?.training_data?.truth_records?.row_count ?? "—"}
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Cache pie chart */}
      {cacheData.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-bold text-white mb-4">缓存命中率</h3>
            <div className="flex items-center gap-6">
              <div className="w-48 h-48">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={cacheData}
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {cacheData.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e2e8f0" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 text-sm">
                {cacheData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="text-slate-400">{d.name}</span>
                    <span className="text-white font-bold ml-2">{d.value}</span>
                  </div>
                ))}
                {cacheAnalysis?.hit_rate != null && (
                  <div className="pt-2 border-t border-white/10">
                    <span className="text-slate-400">命中率 </span>
                    <span className="text-emerald-400 font-bold">{(cacheAnalysis.hit_rate * 100).toFixed(1)}%</span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
