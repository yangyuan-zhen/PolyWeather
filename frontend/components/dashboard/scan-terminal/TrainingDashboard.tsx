"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp, Target, Thermometer, Hash, BarChart3, Crosshair } from "lucide-react";

type MetricPayload = {
  hit_rate: number;
  mae: number;
  total_days: number;
  brier_score?: number;
};

type DebWindowSummary = {
  start_date?: string | null;
  end_date?: string | null;
  samples?: number;
  hits?: number;
  hit_rate?: number | null;
  mae?: number | null;
  bias?: number | null;
  city_count?: number;
};

type DebHistoricalSummary = {
  city_count?: number;
  avg_hit_rate?: number | null;
  weighted_hit_rate?: number | null;
  avg_mae?: number | null;
  avg_days_per_city?: number;
  sample_days?: number;
  hits?: number;
};

type DebVersionSummary = {
  version?: string;
  samples?: number;
  mae?: number | null;
  rmse?: number | null;
  bias?: number | null;
  bucket_hit_rate?: number | null;
};

type DebSummaryPayload = {
  historical?: DebHistoricalSummary;
  recent_7d?: DebWindowSummary;
  recent_14d?: DebWindowSummary;
  versions?: Record<string, DebVersionSummary>;
};

type DebRecentStrategy = {
  recent_7d?: DebWindowSummary;
  recent_14d?: DebWindowSummary;
  trust_tier?: "high" | "medium" | "low" | "insufficient" | string;
  recommendation?: "primary" | "supporting" | "context_only" | "insufficient" | string;
  bias_direction?: "under" | "over" | "neutral" | "unknown" | string;
  reason?: string;
};

type TrainingCity = {
  city_id: string;
  name: string;
  deb?: MetricPayload;
  deb_recent?: DebRecentStrategy | null;
  mu?: MetricPayload;
};

type TrainingAccuracyPayload = {
  accuracy: TrainingCity[];
  deb_summary?: DebSummaryPayload;
};

const STAT_CARD_CLASSES: Record<string, string> = {
  blue: "bg-blue-50 border-blue-200",
  emerald: "bg-emerald-50 border-emerald-200",
  amber: "bg-amber-50 border-amber-200",
  purple: "bg-purple-50 border-purple-200",
};
const STAT_ICON_CLASSES: Record<string, string> = {
  blue: "text-blue-600",
  emerald: "text-emerald-600",
  amber: "text-amber-600",
  purple: "text-purple-600",
};

function barColor(hr: number) {
  if (hr >= 65) return "#059669";
  if (hr >= 45) return "#d97706";
  return "#dc2626";
}

function trustBadgeClass(tier?: string) {
  if (tier === "high") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tier === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  if (tier === "low") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function trustLabel(tier: string | undefined, isEn: boolean) {
  if (tier === "high") return isEn ? "High" : "高";
  if (tier === "medium") return isEn ? "Medium" : "中";
  if (tier === "low") return isEn ? "Low" : "低";
  return isEn ? "Thin" : "少";
}

function recommendationLabel(value: string | undefined, isEn: boolean) {
  if (value === "primary") return isEn ? "Primary" : "主用";
  if (value === "supporting") return isEn ? "Support" : "辅助";
  if (value === "context_only") return isEn ? "Context" : "参考";
  return isEn ? "Insufficient" : "样本少";
}

const TRAINING_CACHE_KEY = "polyweather_training_accuracy_v1";
const TRAINING_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function readTrainingCache(): TrainingAccuracyPayload | null {
  try {
    const raw = localStorage.getItem(TRAINING_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached.ts && Date.now() - cached.ts < TRAINING_CACHE_TTL_MS) {
      if (Array.isArray(cached.data)) return { accuracy: cached.data };
      if (cached.data && Array.isArray(cached.data.accuracy)) return cached.data;
    }
  } catch { /* ignore */ }
  return null;
}

function writeTrainingCache(data: TrainingAccuracyPayload) {
  try {
    localStorage.setItem(TRAINING_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch { /* ignore */ }
}

export function TrainingDashboard({ isEn }: { isEn: boolean }) {
  const [payload, setPayload] = useState<TrainingAccuracyPayload | null>(() => readTrainingCache());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ops/training/accuracy", { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json() as Promise<TrainingAccuracyPayload>;
      })
      .then((nextPayload) => {
        if (cancelled || !nextPayload?.accuracy) return;
        const filtered = nextPayload.accuracy.filter((c) => (c.deb || c.mu) && ((c.deb?.total_days ?? 0) + (c.mu?.total_days ?? 0)) >= 5);
        const next = { ...nextPayload, accuracy: filtered };
        setPayload(next);
        writeTrainingCache(next);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const data = payload?.accuracy ?? null;
  const debSummary = payload?.deb_summary;
  const debSorted = useMemo(() => (data || []).filter((c) => c.deb).sort((a, b) => (b.deb?.hit_rate ?? 0) - (a.deb?.hit_rate ?? 0)), [data]);
  const muSorted = useMemo(() => (data || []).filter((c) => c.mu).sort((a, b) => (b.mu?.hit_rate ?? 0) - (a.mu?.hit_rate ?? 0)), [data]);

  const debStats = useMemo(() => {
    if (!debSorted.length) return null;
    const avgHit = debSorted.reduce((s, c) => s + (c.deb?.hit_rate ?? 0), 0) / debSorted.length;
    const avgMae = debSorted.reduce((s, c) => s + (c.deb?.mae ?? 0), 0) / debSorted.length;
    const avgDays = Math.round(debSorted.reduce((s, c) => s + (c.deb?.total_days ?? 0), 0) / Math.max(debSorted.length, 1));
    return {
      avgHit: debSummary?.historical?.avg_hit_rate ?? avgHit,
      avgMae: debSummary?.historical?.avg_mae ?? avgMae,
      avgDays: debSummary?.historical?.avg_days_per_city ?? avgDays,
      cities: debSummary?.historical?.city_count ?? debSorted.length,
      sampleDays: debSummary?.historical?.sample_days,
      weightedHit: debSummary?.historical?.weighted_hit_rate,
    };
  }, [debSorted, debSummary]);

  const muStats = useMemo(() => {
    if (!muSorted.length) return null;
    const avgHit = muSorted.reduce((s, c) => s + (c.mu?.hit_rate ?? 0), 0) / muSorted.length;
    const avgMae = muSorted.reduce((s, c) => s + (c.mu?.mae ?? 0), 0) / muSorted.length;
    const avgBrier = muSorted.reduce((s, c) => s + (c.mu?.brier_score ?? 0), 0) / muSorted.length;
    const avgDays = Math.round(muSorted.reduce((s, c) => s + (c.mu?.total_days ?? 0), 0) / Math.max(muSorted.length, 1));
    return { avgHit, avgMae, avgBrier, avgDays, cities: muSorted.length };
  }, [muSorted]);

  const debHitChart = useMemo(
    () => debSorted.slice(0, 18).map((c) => ({ name: c.name, value: Number((c.deb?.hit_rate ?? 0).toFixed(1)) })),
    [debSorted],
  );
  const debMaeChart = useMemo(
    () => [...debSorted].sort((a, b) => (a.deb?.mae ?? 99) - (b.deb?.mae ?? 99)).slice(0, 18).map((c) => ({ name: c.name, value: Number((c.deb?.mae ?? 0).toFixed(2)) })),
    [debSorted],
  );
  const muHitChart = useMemo(
    () => muSorted.slice(0, 18).map((c) => ({ name: c.name, value: Number((c.mu?.hit_rate ?? 0).toFixed(1)) })),
    [muSorted],
  );
  const muBrierChart = useMemo(
    () => [...muSorted].sort((a, b) => (a.mu?.brier_score ?? 99) - (b.mu?.brier_score ?? 99)).slice(0, 18).map((c) => ({ name: c.name, value: Number((c.mu?.brier_score ?? 0).toFixed(3)) })),
    [muSorted],
  );
  const debVersionRows = useMemo(() => {
    const versions = debSummary?.versions || {};
    return [
      { key: "deb_v1_raw", label: isEn ? "Raw DEB" : "原始 DEB" },
      { key: "deb_v1_recent_bias_corrected", label: isEn ? "Mean Bias" : "均值偏差" },
      { key: "deb_v2_bucket_calibrated", label: isEn ? "Bucket v2" : "桶校准 v2" },
    ].map(({ key, label }) => ({ key, label, value: versions[key] })).filter((row) => row.value);
  }, [debSummary?.versions, isEn]);

  const formatPct = (value: number | null | undefined) => value == null ? "--" : `${value.toFixed(1)}%`;
  const formatMaybeDeg = (value: number | null | undefined, digits = 1) => value == null ? "--" : `${value.toFixed(digits)}°`;

  return (
    <div className="h-full overflow-auto bg-[#f5f7fa]">
      <div className="p-4">
        <h1 className="text-lg font-black text-slate-900 flex items-center gap-2 mb-1">
          <BarChart3 size={18} className="text-blue-600" />
          {isEn ? "Model Training Accuracy" : "模型训练准确率"}
        </h1>
        <p className="text-xs text-slate-500 mb-4">
          {isEn
            ? "DEB temperature forecast vs. Probability Mu calibration — per-city backtesting metrics."
            : "DEB 气温预报 与 概率 μ 校准 — 各城市回测指标。"}
        </p>

        {/* ── DEB Section ── */}
        {debStats && (
          <>
            <h2 className="text-sm font-black text-slate-800 flex items-center gap-1.5 mb-2">
              <Thermometer size={14} className="text-amber-600" />
              {isEn ? "DEB Temperature Forecast" : "DEB 气温预报"}
            </h2>
            <div className="grid grid-cols-2 gap-2 mb-3 md:grid-cols-3 xl:grid-cols-6">
              {[
                { icon: Hash, label: isEn ? "Cities" : "城市数", value: debStats.cities, tone: "blue" },
                { icon: Target, label: isEn ? "Historical Avg" : "历史平均", value: `${debStats.avgHit.toFixed(1)}%`, tone: "emerald" },
                { icon: TrendingUp, label: isEn ? "Recent 7d" : "近7天", value: formatPct(debSummary?.recent_7d?.hit_rate), tone: "emerald" },
                { icon: TrendingUp, label: isEn ? "Recent 14d" : "近14天", value: formatPct(debSummary?.recent_14d?.hit_rate), tone: "purple" },
                { icon: Thermometer, label: isEn ? "Avg Error" : "平均误差", value: `${debStats.avgMae.toFixed(1)}°`, tone: "amber" },
                { icon: Hash, label: isEn ? "Samples" : "样本天数", value: (debStats.sampleDays ?? debStats.avgDays).toLocaleString(), tone: "blue" },
              ].map(({ icon: Icon, label, value, tone }) => (
                <div key={label} className={`flex items-center gap-3 rounded-lg border ${STAT_CARD_CLASSES[tone]} p-3`}>
                  <Icon size={20} className={STAT_ICON_CLASSES[tone]} />
                  <div>
                    <div className="text-[11px] font-bold uppercase text-slate-500">{label}</div>
                    <div className="font-mono text-lg font-black text-slate-900">{String(value)}</div>
                  </div>
                </div>
              ))}
            </div>
            {debVersionRows.length ? (
              <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                {debVersionRows.map((row) => {
                  const bucketRate = row.value?.bucket_hit_rate == null ? null : row.value.bucket_hit_rate * 100;
                  return (
                    <div key={row.key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] font-black uppercase text-slate-500">{row.label}</span>
                        <span className="font-mono text-sm font-black text-slate-900">{formatPct(bucketRate)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{isEn ? "MAE" : "误差"} {formatMaybeDeg(row.value?.mae, 2)}</span>
                        <span>{isEn ? "Samples" : "样本"} {row.value?.samples ?? 0}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <ChartCard title={isEn ? "Forecast Hit Rate by City" : "预报命中率 by 城市"}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={debHitChart} layout="vertical" margin={{ top: 0, right: 16, left: 48, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => `${v}%`} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: "#334155" }} width={52} />
                    <Tooltip contentStyle={{ borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12 }} formatter={(v: unknown) => [`${Number(v)}%`, isEn ? "Hit Rate" : "命中率"]} />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]} fill="#2563eb" barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title={isEn ? "Forecast Error by City (lower = better)" : "预报误差 by 城市（越低越好）"}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={debMaeChart} layout="vertical" margin={{ top: 0, right: 16, left: 48, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => `${v}°`} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: "#334155" }} width={52} />
                    <Tooltip contentStyle={{ borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12 }} formatter={(v: unknown) => [`${Number(v)}°`, isEn ? "Error" : "误差"]} />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]} fill="#7c3aed" barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </>
        )}

        {/* ── Mu Section ── */}
        {muStats && (
          <>
            <h2 className="text-sm font-black text-slate-800 flex items-center gap-1.5 mb-2">
              <Crosshair size={14} className="text-emerald-600" />
              {isEn ? "Probability Mu Calibration" : "概率 μ 校准"}
            </h2>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[
                { icon: Hash, label: isEn ? "Cities" : "城市数", value: muStats.cities, tone: "blue" },
                { icon: Target, label: isEn ? "Avg Hit" : "平均命中", value: `${muStats.avgHit.toFixed(1)}%`, tone: "emerald" },
                { icon: Thermometer, label: isEn ? "Avg Error" : "平均误差", value: `${muStats.avgMae.toFixed(2)}°`, tone: "amber" },
                { icon: Crosshair, label: isEn ? "Avg Brier" : "平均 Brier", value: muStats.avgBrier.toFixed(4), tone: "purple" },
              ].map(({ icon: Icon, label, value, tone }) => (
                <div key={label} className={`flex items-center gap-3 rounded-lg border ${STAT_CARD_CLASSES[tone]} p-3`}>
                  <Icon size={20} className={STAT_ICON_CLASSES[tone]} />
                  <div>
                    <div className="text-[11px] font-bold uppercase text-slate-500">{label}</div>
                    <div className="font-mono text-lg font-black text-slate-900">{String(value)}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <ChartCard title={isEn ? "Prob Hit Rate by City" : "概率命中率 by 城市"}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={muHitChart} layout="vertical" margin={{ top: 0, right: 16, left: 48, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => `${v}%`} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: "#334155" }} width={52} />
                    <Tooltip contentStyle={{ borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12 }} formatter={(v: unknown) => [`${Number(v)}%`, isEn ? "Hit Rate" : "命中率"]} />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]} fill="#059669" barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title={isEn ? "Brier Score by City (lower = better)" : "Brier 评分 by 城市（越低越好）"}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={muBrierChart} layout="vertical" margin={{ top: 0, right: 16, left: 48, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => `${Number(v).toFixed(2)}`} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: "#334155" }} width={52} />
                    <Tooltip contentStyle={{ borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12 }} formatter={(v: unknown) => [`${Number(v).toFixed(4)}`, "Brier"]} />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]} fill="#d97706" barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </>
        )}

        {/* ── Combined Table ── */}
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-[960px] w-full text-[12px] border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-[#f8f9fa] text-left">
                <th className="w-10 px-3 py-2 text-center text-[11px] font-black text-slate-400">#</th>
                <th className="px-3 py-2 text-[11px] font-black uppercase text-slate-500">{isEn ? "City" : "城市"}</th>
                <th className="px-2 py-2 text-left text-[11px] font-black uppercase text-slate-500">{isEn ? "DEB Trust" : "DEB 信任"}</th>
                <th className="px-2 py-2 text-right text-[11px] font-black uppercase text-slate-500">{isEn ? "7d" : "7天"}</th>
                <th className="px-2 py-2 text-right text-[11px] font-black uppercase text-slate-500">{isEn ? "14d" : "14天"}</th>
                <th className="px-2 py-2 text-right text-[11px] font-black uppercase text-slate-500">{isEn ? "DEB Hit" : "DEB 命中"}</th>
                <th className="px-2 py-2 text-right text-[11px] font-black uppercase text-slate-500">{isEn ? "DEB Error" : "DEB 误差"}</th>
                <th className="px-2 py-2 text-right text-[11px] font-black uppercase text-slate-500">{isEn ? "μ Hit" : "μ 命中"}</th>
                <th className="px-2 py-2 text-right text-[11px] font-black uppercase text-slate-500">Brier</th>
                <th className="px-3 py-2 text-right text-[11px] font-black uppercase text-slate-500">{isEn ? "Days" : "天数"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {debSorted.length || muSorted.length ? (
                (() => {
                  const cities = new Map<string, { deb?: MetricPayload; debRecent?: DebRecentStrategy | null; mu?: MetricPayload; name: string }>();
                  for (const c of debSorted) cities.set(c.city_id, { deb: c.deb, debRecent: c.deb_recent, mu: c.mu, name: c.name });
                  for (const c of muSorted) {
                    const existing = cities.get(c.city_id);
                    if (existing) existing.mu = c.mu;
                    else cities.set(c.city_id, { deb: c.deb, debRecent: c.deb_recent, mu: c.mu, name: c.name });
                  }
                  const merged = [...cities.entries()]
                    .sort((a, b) => {
                      const aMax = Math.max(a[1].deb?.hit_rate ?? 0, a[1].mu?.hit_rate ?? 0);
                      const bMax = Math.max(b[1].deb?.hit_rate ?? 0, b[1].mu?.hit_rate ?? 0);
                      return bMax - aMax;
                    })
                    .slice(0, 30);
                  return merged.map(([cityId, { deb, debRecent, mu, name }], i) => {
                    const debHit = deb?.hit_rate ?? 0;
                    const muHit = mu?.hit_rate ?? 0;
                    const brier = mu?.brier_score;
                    const recent7 = debRecent?.recent_7d?.hit_rate;
                    const recent14 = debRecent?.recent_14d?.hit_rate;
                    return (
                      <tr key={cityId} className="hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2 text-center text-[12px] font-mono text-slate-400">{i + 1}</td>
                        <td className="px-3 py-2 font-semibold text-slate-800 capitalize">{name}</td>
                        <td className="px-2 py-2">
                          {debRecent ? (
                            <span
                              className={`inline-flex min-w-[4rem] items-center justify-center rounded border px-2 py-0.5 text-[10px] font-black uppercase ${trustBadgeClass(debRecent.trust_tier)}`}
                              title={debRecent.reason}
                            >
                              {trustLabel(debRecent.trust_tier, isEn)} · {recommendationLabel(debRecent.recommendation, isEn)}
                            </span>
                          ) : (
                            <span className="text-slate-400">--</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-slate-600">{recent7 == null ? "--" : `${recent7.toFixed(0)}%`}</td>
                        <td className="px-2 py-2 text-right font-mono text-slate-600">{recent14 == null ? "--" : `${recent14.toFixed(0)}%`}</td>
                        <td className="px-2 py-2 text-right font-mono font-bold" style={{ color: barColor(debHit) }}>
                          {deb ? `${debHit.toFixed(0)}%` : "--"}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-slate-600">{deb ? `${deb.mae.toFixed(1)}°` : "--"}</td>
                        <td className="px-2 py-2 text-right font-mono font-bold" style={{ color: barColor(muHit) }}>
                          {mu ? `${muHit.toFixed(0)}%` : "--"}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-slate-600">{brier != null ? brier.toFixed(4) : "--"}</td>
                        <td className="px-3 py-2 text-right text-slate-400">{(deb?.total_days ?? 0) + (mu?.total_days ?? 0)}</td>
                      </tr>
                    );
                  });
                })()
              ) : (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-slate-400">
                    {data === null ? (isEn ? "Loading..." : "加载中...") : (isEn ? "No training data" : "暂无训练数据")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-center text-[11px] text-slate-400">
          {isEn
            ? "DEB = temperature forecast accuracy. μ = probability calibration. Brier = lower is better. Updated daily."
            : "DEB = 气温预报准确率。μ = 概率校准。Brier = 越低越好。每日更新。"}
        </p>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-[12px] font-black uppercase text-slate-500">{title}</h3>
      <div className="h-72">{children}</div>
    </div>
  );
}
