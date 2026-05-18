"use client";

import { useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { opsApi } from "@/lib/ops-api";
import type { SystemStatusPayload } from "@/types/ops";
import Link from "next/link";

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-white/5 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  );
}

export function TrainingPageClient() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SystemStatusPayload | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const s = await opsApi.systemStatus() as SystemStatusPayload;
      setStatus(s);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  if (loading) return <div className="text-slate-400 animate-pulse">加载中...</div>;
  if (!status) return <div className="text-red-400">加载失败</div>;

  const td = status.training_data;
  const truth = td?.truth_records;
  const features = td?.training_features;
  const coverage = td?.city_coverage;
  const modelCities = td?.model_cities;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">训练数据</h1>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCcw className="h-3.5 w-3.5" /> 刷新
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader><CardTitle>真值记录</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <StatRow label="行数" value={truth?.row_count ?? "—"} />
            <StatRow label="城市数" value={truth?.cities_count ?? "—"} />
            <StatRow label="日期范围" value={truth?.min_date && truth?.max_date ? `${truth.min_date} ~ ${truth.max_date}` : "—"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>训练特征</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <StatRow label="行数" value={features?.row_count ?? "—"} />
            <StatRow label="城市数" value={features?.cities_count ?? "—"} />
            <StatRow label="日期范围" value={features?.min_date && features?.max_date ? `${features.min_date} ~ ${features.max_date}` : "—"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>城市覆盖</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <StatRow label="城市总数" value={coverage?.total_cities ?? "—"} />
            <StatRow label="有真值" value={coverage?.with_truth_rows ?? "—"} />
            <StatRow label="有特征" value={coverage?.with_feature_rows ?? "—"} />
          </CardContent>
        </Card>
      </div>

      {modelCities ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle>最强城市</CardTitle></CardHeader>
            <CardContent>
              {modelCities.strongest?.length ? (
                <ul className="space-y-1">
                  {modelCities.strongest.map((c, i) => (
                    <li key={i} className="text-sm text-slate-300">
                      <span className="text-white font-medium">{c.city}</span>
                      <span className="text-slate-500 ml-3">真值:{c.truth_rows ?? "—"} 特征:{c.feature_rows ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              ) : <span className="text-slate-500 text-sm">无数据</span>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>覆盖缺口</CardTitle></CardHeader>
            <CardContent>
              {modelCities.gaps?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {modelCities.gaps.map((c) => (
                    <Badge key={c} variant="secondary">{c}</Badge>
                  ))}
                </div>
              ) : <span className="text-slate-500 text-sm">无缺口</span>}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>真值历史浏览</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-400 mb-3">按城市和日期筛选查看历史真值记录。</p>
          <Link href="/ops/truth-history" className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/15 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/25 transition-colors">
            打开真值历史 →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
