"use client";

import { useEffect, useState } from "react";
import { RefreshCcw, CheckCircle2, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { opsApi } from "@/lib/ops-api";
import type { PaymentRuntimePayload, PaymentIncident, PaymentRecord } from "@/types/ops";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from "recharts";

export function PaymentsPageClient() {
  const [loading, setLoading] = useState(true);
  const [runtime, setRuntime] = useState<PaymentRuntimePayload | null>(null);
  const [incidents, setIncidents] = useState<PaymentIncident[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [resolving, setResolving] = useState<Set<number>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const [rt, inc, pay] = await Promise.all([
        opsApi.paymentRuntime() as Promise<PaymentRuntimePayload>,
        opsApi.incidents(50),
        opsApi.listPayments(50),
      ]);
      setRuntime(rt);
      setIncidents((inc as unknown as { incidents?: PaymentIncident[] }).incidents ?? []);
      setPayments((pay as unknown as { payments?: PaymentRecord[] }).payments ?? []);
    } catch { /* */ }
    setLoading(false);
  };

  const handleResolve = async (id: number) => {
    setResolving((prev) => new Set(prev).add(id));
    try {
      await opsApi.resolveIncident(id);
      setIncidents((prev) => prev.filter((i) => i.id !== id));
    } catch { /* */ }
    setResolving((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  useEffect(() => { void load(); }, []);

  if (loading) return <div className="text-slate-400 animate-pulse">加载中...</div>;

  const reasonCounts: Record<string, number> = {};
  incidents.forEach((inc) => {
    const r = inc.reason || "unknown";
    reasonCounts[r] = (reasonCounts[r] || 0) + 1;
  });

  const incidentPieData = Object.entries(reasonCounts).map(([name, value]) => ({
    name,
    value,
  }));

  const COLORS = ["#ef4444", "#f59e0b", "#3b82f6", "#10b981", "#a855f7", "#6366f1", "#ec4899"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">支付管理</h1>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCcw className="h-3.5 w-3.5" /> 刷新
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>支付运行时</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              {runtime ? Object.entries({
                chain_id: runtime.chain_id,
                last_scanned_block: runtime.last_scanned_block,
                audit_events_count: runtime.audit_events_count,
              }).map(([k, v]) => (
                <div key={k}>
                  <div className="text-slate-500 text-xs">{k}</div>
                  <div className="text-white font-mono">{String(v ?? "—")}</div>
                </div>
              )) : <span className="text-slate-500">无数据</span>}
            </dl>
            {runtime?.receiver_contract ? (
              <div className="mt-3">
                <div className="text-slate-500 text-xs">receiver_contract</div>
                <code className="text-xs text-blue-300 bg-black/40 rounded-lg px-2 py-1.5 block mt-1 truncate">{runtime.receiver_contract}</code>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>异常原因分布</CardTitle></CardHeader>
          <CardContent className="h-[125px] flex items-center justify-center p-3">
            {incidentPieData.length === 0 ? (
              <span className="text-sm text-slate-500">暂无异常数据</span>
            ) : (
              <div className="w-full h-full flex items-center gap-2">
                <div className="w-[100px] h-[100px] shrink-0">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={incidentPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={24}
                        outerRadius={40}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {incidentPieData.map((d, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e2e8f0", fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-1 overflow-y-auto max-h-[100px] text-xs">
                  {incidentPieData.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-1.5 truncate">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-slate-400 truncate" title={d.name}>{d.name}</span>
                      <span className="text-white font-bold ml-auto">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>支付异常 ({incidents.length})</CardTitle></CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <span className="text-sm text-slate-500">暂无异常</span>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-slate-400">
                    <th className="py-2 pr-4 font-medium">ID</th>
                    <th className="py-2 pr-4 font-medium">原因</th>
                    <th className="py-2 pr-4 font-medium">时间</th>
                    <th className="py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((inc) => (
                    <tr key={inc.id} className="border-b border-white/5">
                      <td className="py-2 pr-4 text-slate-500 font-mono">{inc.id}</td>
                      <td className="py-2 pr-4 text-amber-300">{inc.reason ?? "—"}</td>
                      <td className="py-2 pr-4 text-slate-400 text-xs">{inc.created_at?.slice(0, 19) ?? "—"}</td>
                      <td className="py-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resolving.has(inc.id)}
                          onClick={() => handleResolve(inc.id)}
                          className="gap-1 h-7 text-xs"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          {resolving.has(inc.id) ? "处理中" : "标记处理"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>成功支付记录 ({payments.length})</CardTitle></CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <span className="text-sm text-slate-500">暂无记录</span>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-slate-400">
                    <th className="py-2 pr-4 font-medium">ID</th>
                    <th className="py-2 pr-4 font-medium">用户</th>
                    <th className="py-2 pr-4 font-medium">金额</th>
                    <th className="py-2 pr-4 font-medium">链</th>
                    <th className="py-2 pr-4 font-medium">Tx Hash</th>
                    <th className="py-2 pr-4 font-medium">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-white/5">
                      <td className="py-2 pr-4 text-slate-500 font-mono text-xs">{p.id}</td>
                      <td className="py-2 pr-4 text-slate-400 font-mono text-xs" title={p.user_id}>{p.user_id?.slice(0, 10) ?? "—"}...</td>
                      <td className="py-2 pr-4 text-emerald-300 font-mono">{p.amount} {p.currency}</td>
                      <td className="py-2 pr-4 text-slate-400 text-xs">{p.chain ?? "—"}</td>
                      <td className="py-2 pr-4 text-xs">
                        {p.tx_hash ? (
                          <a
                            href={`https://polygonscan.com/tx/${p.tx_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 font-mono inline-flex items-center gap-1"
                          >
                            {p.tx_hash.slice(0, 8)}...{p.tx_hash.slice(-6)}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : "—"}
                      </td>
                      <td className="py-2 pr-4 text-slate-400 text-xs whitespace-nowrap">{p.created_at?.slice(0, 19) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
