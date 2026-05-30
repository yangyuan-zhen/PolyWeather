"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { RefreshCcw, X, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { opsApi } from "@/lib/ops-api";
import type { MembershipEntry } from "@/types/ops";

const MembershipGrowthChart = dynamic(
  () => import("./MembershipGrowthChart").then((mod) => mod.MembershipGrowthChart),
  {
    ssr: false,
    loading: () => <div className="h-[360px] animate-pulse rounded-lg bg-slate-100" />,
  },
);

type GrowthPoint = { date: string; trial: number; paid: number; total: number; cumulative: number };

type SubRow = {
  id?: string;
  status?: string;
  plan_code?: string;
  source?: string;
  starts_at?: string;
  expires_at?: string;
  created_at?: string;
  updated_at?: string;
};

export function MembershipsPageClient() {
  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<MembershipEntry[]>([]);
  const [growth, setGrowth] = useState<GrowthPoint[]>([]);
  const [filter, setFilter] = useState<"all" | "paid" | "trial">("all");

  // Detail modal state
  const [detailEmail, setDetailEmail] = useState<string | null>(null);
  const [detailUserId, setDetailUserId] = useState<string>("");
  const [detailRows, setDetailRows] = useState<SubRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await opsApi.membershipsOverview(200, 90);
      setMemberships((data as unknown as { memberships?: MembershipEntry[] }).memberships ?? []);
      setGrowth((data as { daily?: GrowthPoint[] })?.daily ?? []);
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

  const sourceLabel = (source?: string) => {
    if (!source) return "—";
    if (source === "payment_contract") return "链上支付";
    if (source === "ops_manual_grant") return "后台赠送";
    if (source === "signup_trial") return "注册体验";
    if (source === "weekly_reward") return "周奖励";
    return source;
  };

  const statusBadge = (status?: string) => {
    if (status === "active") return <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">active</span>;
    if (status === "expired") return <span className="inline-flex items-center rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-400">expired</span>;
    if (status === "cancelled") return <span className="inline-flex items-center rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] font-medium text-slate-400">cancelled</span>;
    return <span className="inline-flex items-center rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] font-medium text-slate-400">{status ?? "—"}</span>;
  };

  const openDetail = async (email: string) => {
    if (!email) return;
    setDetailEmail(email);
    setDetailLoading(true);
    setDetailError("");
    setDetailRows([]);
    setDetailUserId("");
    try {
      const data = await opsApi.userSubscriptions(email);
      setDetailUserId(data.user_id ?? "");
      setDetailRows(data.subscriptions ?? []);
    } catch (e: unknown) {
      setDetailError(e instanceof Error ? e.message : "查询失败");
    }
    setDetailLoading(false);
  };

  const closeDetail = () => {
    setDetailEmail(null);
    setDetailRows([]);
    setDetailUserId("");
    setDetailError("");
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

            <MembershipGrowthChart growth={growth} />
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
                  <tr key={m.user_id || i} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="py-2.5 px-4">
                      {m.is_trial ? (
                        <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">体验</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">付费</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      <button
                        className="text-white hover:text-cyan-400 transition-colors inline-flex items-center gap-1.5 group"
                        onClick={() => openDetail(m.email ?? "")}
                        title="查看全部订阅记录"
                      >
                        {m.email ?? "—"}
                        <Search className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                      </button>
                    </td>
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

      {/* Subscription detail modal */}
      {detailEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeDetail}>
          <div
            className="bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <div>
                <h2 className="text-lg font-bold text-white">订阅记录详情</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {detailEmail}
                  {detailUserId && <span className="ml-2 text-slate-500">ID: {detailUserId.slice(0, 8)}…</span>}
                </p>
              </div>
              <button onClick={closeDetail} className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto flex-1 px-6 py-4">
              {detailLoading && (
                <div className="text-slate-400 animate-pulse py-8 text-center">查询中...</div>
              )}
              {detailError && (
                <div className="text-red-400 py-8 text-center text-sm">{detailError}</div>
              )}
              {!detailLoading && !detailError && detailRows.length === 0 && (
                <div className="text-slate-500 py-8 text-center text-sm">未找到订阅记录</div>
              )}
              {!detailLoading && detailRows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-left text-slate-400">
                        <th className="py-2.5 px-3 font-medium text-xs">状态</th>
                        <th className="py-2.5 px-3 font-medium text-xs">方案</th>
                        <th className="py-2.5 px-3 font-medium text-xs">来源</th>
                        <th className="py-2.5 px-3 font-medium text-xs">起始</th>
                        <th className="py-2.5 px-3 font-medium text-xs">到期</th>
                        <th className="py-2.5 px-3 font-medium text-xs">创建</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailRows.map((row, i) => {
                        const isExpired = row.expires_at && new Date(row.expires_at) < new Date();
                        return (
                          <tr key={row.id ?? i} className={`border-b border-white/5 ${isExpired ? "opacity-50" : ""}`}>
                            <td className="py-2 px-3">{statusBadge(row.status)}</td>
                            <td className="py-2 px-3 text-white text-xs">{planLabel(row.plan_code)}</td>
                            <td className="py-2 px-3 text-slate-400 text-xs">{sourceLabel(row.source)}</td>
                            <td className="py-2 px-3 text-slate-400 text-xs font-mono">{row.starts_at?.slice(0, 19)?.replace("T", " ") ?? "—"}</td>
                            <td className="py-2 px-3 text-xs font-mono">
                              <span className={isExpired ? "text-red-400" : "text-emerald-400"}>
                                {row.expires_at?.slice(0, 19)?.replace("T", " ") ?? "—"}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-500 text-xs font-mono">{row.created_at?.slice(0, 19)?.replace("T", " ") ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="text-xs text-slate-500 mt-3 px-1">
                    共 {detailRows.length} 条记录 · 时间为 UTC
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
