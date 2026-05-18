"use client";

import { useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { opsApi } from "@/lib/ops-api";

type FunnelStep = { label: string; count: number; pct_of_prev?: number };

export function AnalyticsPageClient() {
  const [loading, setLoading] = useState(true);
  const [funnel, setFunnel] = useState<FunnelStep[]>([]);
  const [days, setDays] = useState(30);

  const load = async () => {
    setLoading(true);
    try {
      const data = await opsApi.funnel(days);
      const steps = (data as unknown as { steps?: FunnelStep[] }).steps ?? [];
      setFunnel(steps);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => { void load(); }, [days]);

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

      <Card>
        <CardHeader><CardTitle>用户转化漏斗</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            {funnel.map((step, i) => {
              const pct = (step.count / maxCount) * 100;
              const prevPct = step.pct_of_prev != null ? `${step.pct_of_prev}%` : "—";
              return (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-300">{step.label}</span>
                    <span className="text-slate-400">
                      <span className="text-white font-bold">{step.count}</span>
                      <span className="ml-2 text-xs">转化 {prevPct}</span>
                    </span>
                  </div>
                  <div className="h-6 w-full rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {funnel.length === 0 && (
              <p className="text-slate-500 text-sm py-4 text-center">暂无数据</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
