"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { RefreshCcw, TrendingUp, TrendingDown, Target, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { opsApi } from "@/lib/ops-api";
import type { SystemStatusPayload } from "@/types/ops";
import Link from "next/link";

const TrainingAccuracyCharts = dynamic(
  () => import("./TrainingAccuracyCharts").then((mod) => mod.TrainingAccuracyCharts),
  {
    ssr: false,
    loading: () => <div className="h-[400px] animate-pulse rounded-lg bg-slate-100" />,
  },
);

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-white/5 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  );
}

function KpiCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ComponentType<{ className?: string }>; color: string;
}) {
  return (
    <Card className="bg-slate-900/60 border-white/5">
      <CardContent className="p-4 flex items-center gap-4">
        <div className={`p-3 rounded-xl ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-2xl font-bold text-white">{value}</div>
          <div className="text-xs text-slate-400">{label}</div>
          {sub ? <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

interface CityAccuracy {
  city_id: string;
  name: string;
  deb?: {
    hit_rate: number;
    mae: number;
    total_days: number;
    details_str: string;
  } | null;
  deb_recent?: {
    recent_7d?: {
      hit_rate?: number | null;
      samples?: number;
      mae?: number | null;
    };
    recent_14d?: {
      hit_rate?: number | null;
      samples?: number;
      mae?: number | null;
    };
    trust_tier?: string;
    recommendation?: string;
    bias_direction?: string;
    reason?: string;
  } | null;
  mu?: {
    mae: number;
    hit_rate: number;
    brier_score: number | null;
    total_days: number;
    details_str: string;
  } | null;
}

interface DebSummary {
  historical?: {
    avg_hit_rate?: number | null;
    weighted_hit_rate?: number | null;
    avg_mae?: number | null;
    sample_days?: number;
    city_count?: number;
  };
  recent_7d?: {
    hit_rate?: number | null;
    mae?: number | null;
    samples?: number;
    hits?: number;
  };
  recent_14d?: {
    hit_rate?: number | null;
    mae?: number | null;
    samples?: number;
    hits?: number;
  };
}

function debTrustBadgeClass(tier?: string) {
  if (tier === "high") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (tier === "medium") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (tier === "low") return "bg-rose-500/15 text-rose-300 border-rose-500/30";
  return "bg-slate-500/15 text-slate-300 border-slate-500/30";
}

function debTrustLabel(tier?: string) {
  if (tier === "high") return "高可信";
  if (tier === "medium") return "中可信";
  if (tier === "low") return "低可信";
  return "样本少";
}

function debRecommendationLabel(recommendation?: string) {
  if (recommendation === "primary") return "主用";
  if (recommendation === "supporting") return "辅助";
  if (recommendation === "context_only") return "仅参考";
  return "不足";
}

function formatPct(value: number | null | undefined) {
  return value == null ? "—" : `${value.toFixed(0)}%`;
}

export function TrainingPageClient() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SystemStatusPayload | null>(null);
  const [accuracy, setAccuracy] = useState<CityAccuracy[] | null>(null);
  const [debSummary, setDebSummary] = useState<DebSummary | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [s, accData] = await Promise.all([
        opsApi.systemStatus() as Promise<SystemStatusPayload>,
        opsApi.trainingAccuracy().catch(() => ({ accuracy: [] as CityAccuracy[], deb_summary: null })),
      ]);
      setStatus(s);
      setAccuracy((accData as { accuracy: CityAccuracy[] }).accuracy ?? []);
      setDebSummary((accData as { deb_summary?: DebSummary | null }).deb_summary ?? null);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const kpis = useMemo(() => {
    if (!accuracy?.length) return null;
    const debCities = accuracy.filter((c) => c.deb);
    const avgHit = debCities.reduce((s, c) => s + (c.deb?.hit_rate ?? 0), 0) / debCities.length;
    const avgMae = debCities.reduce((s, c) => s + (c.deb?.mae ?? 0), 0) / debCities.length;
    const best = debCities.reduce((a, b) => ((a.deb?.hit_rate ?? 0) > (b.deb?.hit_rate ?? 0) ? a : b));
    const worst = debCities.reduce((a, b) => ((a.deb?.mae ?? 0) > (b.deb?.mae ?? 0) ? a : b));
    return {
      avgHit: debSummary?.historical?.avg_hit_rate ?? avgHit,
      avgMae: debSummary?.historical?.avg_mae ?? avgMae,
      recent7Hit: debSummary?.recent_7d?.hit_rate,
      recent14Hit: debSummary?.recent_14d?.hit_rate,
      best,
      worst,
    };
  }, [accuracy, debSummary]);

  const debChartData = useMemo(() => {
    if (!accuracy?.length) return [];
    return accuracy
      .filter((c) => c.deb && c.deb.total_days >= 5)
      .sort((a, b) => (b.deb?.hit_rate ?? 0) - (a.deb?.hit_rate ?? 0))
      .map((c) => ({
        name: c.name,
        cityId: c.city_id,
        hitRate: Number((c.deb?.hit_rate ?? 0).toFixed(1)),
        mae: Number((c.deb?.mae ?? 0).toFixed(1)),
        days: c.deb?.total_days ?? 0,
      }));
  }, [accuracy]);

  const muChartData = useMemo(() => {
    if (!accuracy?.length) return [];
    return accuracy
      .filter((c) => c.mu && c.mu.total_days >= 5 && c.mu.brier_score !== null)
      .sort((a, b) => ((a.mu?.brier_score ?? 1) - (b.mu?.brier_score ?? 1)))
      .map((c) => ({
        name: c.name,
        cityId: c.city_id,
        brierScore: Number((c.mu?.brier_score ?? 0).toFixed(4)),
        hitRate: Number((c.mu?.hit_rate ?? 0).toFixed(1)),
        mae: Number((c.mu?.mae ?? 0).toFixed(1)),
        days: c.mu?.total_days ?? 0,
      }));
  }, [accuracy]);

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

      {/* Data volume KPIs */}
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

      {/* Accuracy KPI row */}
      {kpis ? (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <KpiCard
            icon={Target} color="bg-cyan-500/20 text-cyan-400"
            label="DEB 历史平均命中" value={`${kpis.avgHit.toFixed(1)}%`}
          />
          <KpiCard
            icon={Target} color="bg-emerald-500/20 text-emerald-400"
            label="近 7 天命中" value={kpis.recent7Hit == null ? "—" : `${kpis.recent7Hit.toFixed(1)}%`}
          />
          <KpiCard
            icon={Activity} color="bg-violet-500/20 text-violet-400"
            label="近 14 天命中" value={kpis.recent14Hit == null ? "—" : `${kpis.recent14Hit.toFixed(1)}%`}
          />
          <KpiCard
            icon={Activity} color="bg-blue-500/20 text-blue-400"
            label="DEB 平均 MAE" value={`${kpis.avgMae.toFixed(1)}°`}
          />
          <KpiCard
            icon={TrendingUp} color="bg-emerald-500/20 text-emerald-400"
            label="最佳城市" value={kpis.best.name}
            sub={`命中 ${kpis.best.deb?.hit_rate.toFixed(0)}% · MAE ${kpis.best.deb?.mae.toFixed(1)}°`}
          />
          <KpiCard
            icon={TrendingDown} color="bg-rose-500/20 text-rose-400"
            label="最大偏差" value={kpis.worst.name}
            sub={`MAE ${kpis.worst.deb?.mae.toFixed(1)}° · ${kpis.worst.deb?.total_days}天`}
          />
        </div>
      ) : null}

      <TrainingAccuracyCharts debChartData={debChartData} muChartData={muChartData} />

      {/* City coverage */}
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

      {/* Detail table */}
      <Card>
        <CardHeader>
          <CardTitle>模型融合与预测准确率详情</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-slate-300">
              <thead className="text-xs uppercase bg-slate-800/50 text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">城市</th>
                  <th scope="col" className="px-4 py-3 text-center">DEB 策略</th>
                  <th scope="col" className="px-4 py-3 text-center">近 7 / 14 天</th>
                  <th scope="col" className="px-4 py-3 text-center">DEB 命中</th>
                  <th scope="col" className="px-4 py-3 text-center">DEB MAE</th>
                  <th scope="col" className="px-4 py-3 text-center">DEB 天数</th>
                  <th scope="col" className="px-4 py-3 text-center">μ 命中</th>
                  <th scope="col" className="px-4 py-3 text-center">μ MAE</th>
                  <th scope="col" className="px-4 py-3 text-center">Brier</th>
                  <th scope="col" className="px-4 py-3 text-center">μ 天数</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {accuracy && accuracy.length > 0 ? (
                  accuracy.map((row) => (
                    <tr key={row.city_id} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 font-medium text-white capitalize">
                        {row.name}
                        <span className="text-xs text-slate-500 block font-mono">{row.city_id}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.deb_recent ? (
                          <span
                            title={row.deb_recent.reason}
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${debTrustBadgeClass(row.deb_recent.trust_tier)}`}
                          >
                            {debTrustLabel(row.deb_recent.trust_tier)} · {debRecommendationLabel(row.deb_recent.recommendation)}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-xs text-slate-300">
                        {row.deb_recent ? (
                          <span>
                            {formatPct(row.deb_recent.recent_7d?.hit_rate)}
                            <span className="mx-1 text-slate-600">/</span>
                            {formatPct(row.deb_recent.recent_14d?.hit_rate)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.deb ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            row.deb.hit_rate >= 80
                              ? "bg-green-500/15 text-green-400"
                              : row.deb.hit_rate >= 60
                              ? "bg-yellow-500/15 text-yellow-400"
                              : "bg-red-500/15 text-red-400"
                          }`}>
                            {row.deb.hit_rate.toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center font-mono">
                        {row.deb ? `${row.deb.mae.toFixed(1)}°` : "—"}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-400">
                        {row.deb ? row.deb.total_days : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.mu ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            row.mu.hit_rate >= 80
                              ? "bg-green-500/15 text-green-400"
                              : row.mu.hit_rate >= 60
                              ? "bg-yellow-500/15 text-yellow-400"
                              : "bg-red-500/15 text-red-400"
                          }`}>
                            {row.mu.hit_rate.toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center font-mono">
                        {row.mu ? `${row.mu.mae.toFixed(1)}°` : "—"}
                      </td>
                      <td className="px-4 py-3 text-center font-mono">
                        {row.mu && row.mu.brier_score !== null ? (
                          <span className={`${
                            row.mu.brier_score <= 0.1
                              ? "text-green-400 font-bold"
                              : row.mu.brier_score <= 0.25
                              ? "text-yellow-400"
                              : "text-red-400"
                          }`}>
                            {row.mu.brier_score.toFixed(3)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-400">
                        {row.mu ? row.mu.total_days : "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                      无有效准确率记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

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
