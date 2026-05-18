"use client";

import { useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { opsApi } from "@/lib/ops-api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

type FunnelStep = { label: string; count: number; pct_of_prev?: number };

export function AnalyticsPageClient() {
  const [loading, setLoading] = useState(true);
  const [funnel, setFunnel] = useState<FunnelStep[]>([]);
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [days, setDays] = useState(30);

  const load = async () => {
    setLoading(true);
    try {
      const data = await opsApi.funnel(days);
      setFunnel(data.steps);
      setRates(data.rates ?? null);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => { void load(); }, [days]);

  const chartData = [...funnel].reverse().map((s) => ({
    name: s.label,
    count: s.count,
    pct: s.pct_of_prev,
  }));

  const maxCount = Math.max(...funnel.map((s) => s.count), 1);

  if (loading) return <div className="text-slate-400 animate-pulse">加载中...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">转化分析</h1>
        <div className="flex gap-2">
          {[7, 14, 30].map((d) => (
            <Button
              key={d}
              variant={days === d ? "default" : "outline"}
              size="sm"
              onClick={() => setDays(d)}
            >
              {d}天
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCcw className="h-3.5 w-3.5" /> 刷新
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {funnel.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-slate-500">总注册</div>
              <div className="text-xl font-bold text-white">{funnel[0]?.count ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-slate-500">点击付费</div>
              <div className="text-xl font-bold text-cyan-400">{funnel[2]?.count ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-slate-500">发起支付</div>
              <div className="text-xl font-bold text-amber-400">{funnel[4]?.count ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-slate-500">支付成功</div>
              <div className="text-xl font-bold text-emerald-400">{funnel[5]?.count ?? 0}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                总体转化 {maxCount > 0 ? `${((funnel[5]?.count ?? 0) / maxCount * 100).toFixed(1)}%` : "—"}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Funnel chart */}
      <Card>
        <CardHeader><CardTitle>转化漏斗 (Recharts)</CardTitle></CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-slate-500 text-sm py-8 text-center">暂无数据</p>
          ) : (
            <ResponsiveContainer width="100%" height={chartData.length * 60 + 40}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 5, right: 40, left: 140, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" stroke="rgba(255,255,255,0.3)" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <YAxis type="category" dataKey="name" stroke="rgba(255,255,255,0.3)" tick={{ fill: "#e2e8f0", fontSize: 13 }} width={130} />
                <Tooltip
                  contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e2e8f0" }}
                  formatter={(value) => [`${value} 人`, "数量"]}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                  {chartData.map((_, i) => {
                    const colors = ["#06b6d4", "#0ea5e9", "#6366f1", "#f59e0b", "#22c55e", "#10b981"];
                    return <Cell key={i} fill={colors[i % colors.length]} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Drop-off table */}
      <Card>
        <CardHeader><CardTitle>各阶段详情</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-slate-400">
                  <th className="py-2 px-3 font-medium">阶段</th>
                  <th className="py-2 px-3 font-medium text-right">人数</th>
                  <th className="py-2 px-3 font-medium text-right">转化率</th>
                  <th className="py-2 px-3 font-medium text-right">流失率</th>
                </tr>
              </thead>
              <tbody>
                {funnel.map((step, i) => {
                  const pct = step.pct_of_prev;
                  const dropPct = pct != null ? 100 - pct : 0;
                  return (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-2 px-3 text-white">{step.label}</td>
                      <td className="py-2 px-3 text-right font-mono text-white">{step.count}</td>
                      <td className="py-2 px-3 text-right text-emerald-400">{pct != null ? `${pct}%` : "—"}</td>
                      <td className="py-2 px-3 text-right text-amber-400">{i > 0 ? `${dropPct}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
