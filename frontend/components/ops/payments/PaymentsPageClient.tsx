"use client";

import { useEffect, useState } from "react";
import { RefreshCcw, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { opsApi } from "@/lib/ops-api";
import type { PaymentRuntimePayload, PaymentIncident } from "@/types/ops";

export function PaymentsPageClient() {
  const [loading, setLoading] = useState(true);
  const [runtime, setRuntime] = useState<PaymentRuntimePayload | null>(null);
  const [incidents, setIncidents] = useState<PaymentIncident[]>([]);
  const [resolving, setResolving] = useState<Set<number>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const [rt, inc] = await Promise.all([
        opsApi.paymentRuntime() as Promise<PaymentRuntimePayload>,
        opsApi.incidents(50),
      ]);
      setRuntime(rt);
      setIncidents((inc as unknown as { incidents?: PaymentIncident[] }).incidents ?? []);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">支付管理</h1>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCcw className="h-3.5 w-3.5" /> 刷新
        </Button>
      </div>

      <Card>
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
    </div>
  );
}
