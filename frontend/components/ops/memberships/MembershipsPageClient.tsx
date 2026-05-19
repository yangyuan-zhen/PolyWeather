"use client";

import { useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { opsApi } from "@/lib/ops-api";
import type { MembershipEntry } from "@/types/ops";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Area, AreaChart,
} from "recharts";

type GrowthPoint = { date: string; trial: number; paid: number; total: number; cumulative: number };

export function MembershipsPageClient() {
  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<MembershipEntry[]>([]);
  const [growth, setGrowth] = useState<GrowthPoint[]>([]);
  const [filter, setFilter] = useState<"all" | "paid" | "trial">("all");

  const load = async () => {
    setLoading(true);
    try {
      const [mData, gData] = await Promise.all([
        opsApi.memberships(),
        fetch("/api/ops/memberships/growth?days=90", { cache: "no-store" }).then(r => r.ok ? r.json() : null),
      ]);
      setMemberships((mData as unknown as { memberships?: MembershipEntry[] }).memberships ?? []);
      setGrowth((gData as { daily?: GrowthPoint[] })?.daily ?? []);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const paid = memberships.filter((m) => !m.is_trial);
  const trials = memberships.filter((m) => m.is_trial);
  const filtered = filter === "paid" ? paid : filter === "trial" ? trials : memberships;

  const planLabel = (code?: string) => {
    if (!code) return "—";
    if (code.startsWith("signup_trial")) return "3天体验";
    if (code === "pro_monthly") return "月付";
    if (code === "pro_quarterly") return "季付";
    if (code === "pro_yearly") return "年付";
    return code;
  };

  if (loading) return <div className="text-slate-400 animate-pulse">加载中...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-white">
          会员订阅 ({memberships.length})
          <span className="text-sm font-normal text-slate-400 ml-3">
            付费 {paid.length} · 体验 {trials.length}
          </span>
        </h1>
        <div className="flex gap-2">
          {(["all", "paid", "trial"] as const).map((f) => (
            <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => setFilter(f)}>
              {f === "all" ? "全部" : f === "paid" ? "付费" : "体验"}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCcw className="h-3.5 w-3.5" /> 刷新
          </Button>
        </div>
      </div>

      {/* Growth chart */}
      {growth.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">会员增长趋势 — 近 {growth.length} 天</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="rounded-xl bg-white/5 p-3 text-center">
                <div className="text-lg font-bold text-white">
                  {growth.reduce((s, d) => s + d.total, 0)}
                </div>
                <div className="text-[11px] text-slate-500">总新增</div>
              </div>
              <div className="rounded-xl bg-white/5 p-3 text-center">
                <div className="text-lg font-bold text-emerald-400">
                  {growth[growth.length - 1]?.cumulative ?? 0}
                </div>
                <div className="text-[11px] text-slate-500">当前累计</div>
              </div>
              <div className="rounded-xl bg-white/5 p-3 text-center">
                <div className="text-lg font-bold text-cyan-400">
                  {(growth.reduce((s, d) => s + d.total, 0) / Math.max(1, growth.filter(d => d.total > 0).length)).toFixed(1)}
                </div>
                <div className="text-[11px] text-slate-500">日均新增</div>
              </div>
              <div className="rounded-xl bg-white/5 p-3 text-center">
                <div className="text-lg font-bold text-amber-400">
                  {Math.max(...growth.map(d => d.total), 0)}
                </div>
                <div className="text-[11px] text-slate-500">单日最高</div>
              </div>
            </div>

            {/* Cumulative area chart */}
            <div className="mb-6">
              <h4 className="text-xs text-slate-500 mb-2">累计会员</h4>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={growth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: "#64748b", fontSize: 10 }} width={45} />
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e2e8f0", fontSize: 12 }} />
                  <Area type="monotone" dataKey="cumulative" stroke="#06b6d4" fill="#06b6d420" name="累计" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Daily bars */}
            <div>
              <h4 className="text-xs text-slate-500 mb-2">每日新增</h4>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={growth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: "#64748b", fontSize: 10 }} width={30} />
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e2e8f0", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="paid" stackId="1" stroke="#22c55e" fill="#22c55e60" name="付费" />
                  <Area type="monotone" dataKey="trial" stackId="1" stroke="#f59e0b" fill="#f59e0b60" name="体验" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-slate-400">
                  <th className="py-3 px-4 font-medium">类型</th>
                  <th className="py-3 px-4 font-medium">邮箱</th>
                  <th className="py-3 px-4 font-medium">方案</th>
                  <th className="py-3 px-4 font-medium">起始</th>
                  <th className="py-3 px-4 font-medium">到期</th>
                  <th className="py-3 px-4 font-medium">排队天数</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m, i) => (
                  <tr key={m.user_id || i} className="border-b border-white/5">
                    <td className="py-2.5 px-4">
                      {m.is_trial ? (
                        <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">体验</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">付费</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-white">{m.email ?? "—"}</td>
                    <td className="py-2.5 px-4">{planLabel(m.plan_code)}</td>
                    <td className="py-2.5 px-4 text-slate-400 text-xs">{m.starts_at?.slice(0, 10) ?? "—"}</td>
                    <td className="py-2.5 px-4 text-slate-400 text-xs">{m.expires_at?.slice(0, 10) ?? "—"}</td>
                    <td className="py-2.5 px-4">{m.queued_days ?? 0}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-slate-500">暂无会员</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
