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
import { TrendingUp, Target, Thermometer, Hash } from "lucide-react";

type TrainingCity = {
  city_id: string;
  name: string;
  deb?: { hit_rate: number; mae: number; total_days: number } | null;
};

const CHART_COLORS = {
  high: "#059669",
  mid: "#d97706",
  low: "#dc2626",
  blue: "#2563eb",
  purple: "#7c3aed",
};

function barColor(hr: number) {
  if (hr >= 65) return CHART_COLORS.high;
  if (hr >= 45) return CHART_COLORS.mid;
  return CHART_COLORS.low;
}

export function TrainingDashboard({ isEn }: { isEn: boolean }) {
  const [data, setData] = useState<TrainingCity[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ops/training/accuracy", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{ accuracy: TrainingCity[] }>;
      })
      .then((payload) => {
        if (cancelled || !payload?.accuracy) return;
        setData(payload.accuracy.filter((c) => c.deb && c.deb.total_days >= 5));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const debSorted = useMemo(
    () => (data || []).sort((a, b) => (b.deb?.hit_rate ?? 0) - (a.deb?.hit_rate ?? 0)),
    [data],
  );

  const stats = useMemo(() => {
    if (!debSorted.length) return null;
    const avgHit = debSorted.reduce((s, c) => s + (c.deb?.hit_rate ?? 0), 0) / debSorted.length;
    const avgMae = debSorted.reduce((s, c) => s + (c.deb?.mae ?? 0), 0) / debSorted.length;
    const totalDays = debSorted.reduce((s, c) => s + (c.deb?.total_days ?? 0), 0);
    const high = debSorted.filter((c) => (c.deb?.hit_rate ?? 0) >= 65).length;
    const mid = debSorted.filter((c) => {
      const hr = c.deb?.hit_rate ?? 0;
      return hr >= 45 && hr < 65;
    }).length;
    const low = debSorted.filter((c) => (c.deb?.hit_rate ?? 0) < 45).length;
    return { avgHit, avgMae, totalDays, cities: debSorted.length, high, mid, low };
  }, [debSorted]);

  const chartData = useMemo(
    () =>
      debSorted.slice(0, 18).map((c) => ({
        name: c.name,
        hit: Number((c.deb?.hit_rate ?? 0).toFixed(1)),
        mae: Number((c.deb?.mae ?? 0).toFixed(2)),
        fill: barColor(c.deb?.hit_rate ?? 0),
      })),
    [debSorted],
  );

  const maeChartData = useMemo(
    () =>
      [...debSorted]
        .sort((a, b) => (a.deb?.mae ?? 99) - (b.deb?.mae ?? 99))
        .slice(0, 18)
        .map((c) => ({
          name: c.name,
          mae: Number((c.deb?.mae ?? 0).toFixed(2)),
        })),
    [debSorted],
  );

  return (
    <div className="h-full overflow-auto bg-[#f5f7fa]">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Target size={18} className="text-blue-600" />
              {isEn ? "DEB Training Accuracy" : "DEB 训练数据准确率"}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {isEn
                ? "DEB hit rate = forecast within settlement acceptance window"
                : "DEB 命中率 = 预报落入结算接受窗口的比例"}
            </p>
          </div>
          {stats && (
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span>{isEn ? "Updated" : "更新时间"}: {new Date().toLocaleDateString()}</span>
            </div>
          )}
        </div>

        {/* Stats cards */}
        {stats && (
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[
              { icon: Hash, label: isEn ? "Models" : "城市模型", value: stats.cities, color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
              { icon: Target, label: isEn ? "Avg Hit Rate" : "平均命中率", value: `${stats.avgHit.toFixed(1)}%`, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
              { icon: Thermometer, label: "Avg MAE", value: `${stats.avgMae.toFixed(1)}°`, color: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
              { icon: TrendingUp, label: isEn ? "Total Days" : "总训练天数", value: stats.totalDays.toLocaleString(), color: "text-purple-600", bg: "bg-purple-50 border-purple-200" },
            ].map(({ icon: Icon, label, value, color, bg }) => (
              <div key={label} className={`flex items-center gap-3 rounded-lg border ${bg} p-3`}>
                <Icon size={20} className={color} />
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500">{label}</div>
                  <div className="font-mono text-lg font-black text-slate-900">{String(value)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Distribution summary */}
        {stats && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { label: isEn ? "High (≥65%)" : "高 (≥65%)", count: stats.high, color: "emerald" },
              { label: isEn ? "Mid (45-64%)" : "中 (45-64%)", count: stats.mid, color: "amber" },
              { label: isEn ? "Low (<45%)" : "低 (<45%)", count: stats.low, color: "red" },
            ].map(({ label, count, color }) => (
              <div key={color} className={`rounded-lg border border-${color}-200 bg-${color}-50 p-3 text-center`}>
                <div className={`font-mono text-2xl font-black text-${color}-600`}>{count}</div>
                <div className="text-[10px] font-bold uppercase text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Charts */}
        {chartData.length > 0 && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            {/* Hit rate bar chart */}
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <h2 className="mb-2 text-[11px] font-black uppercase text-slate-500">
                {isEn ? "Hit Rate by City" : "各城市命中率"}
              </h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 16, left: 48, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v) => `${v}%`} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: "#334155" }} width={50} />
                    <Tooltip
                      contentStyle={{ borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12 }}
                      formatter={(value) => [`${Number(value)}%`, isEn ? "Hit Rate" : "命中率"]}
                    />
                    <Bar dataKey="hit" radius={[0, 3, 3, 0]} fill="#2563eb" barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* MAE bar chart (lower is better) */}
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <h2 className="mb-2 text-[11px] font-black uppercase text-slate-500">
                {isEn ? "MAE by City (lower = better)" : "各城市 MAE (越低越好)"}
              </h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={maeChartData} layout="vertical" margin={{ top: 0, right: 16, left: 48, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v) => `${v}°`} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: "#334155" }} width={50} />
                    <Tooltip
                      contentStyle={{ borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12 }}
                      formatter={(value) => [`${Number(value)}°`, "MAE"]}
                    />
                    <Bar dataKey="mae" radius={[0, 3, 3, 0]} fill="#7c3aed" barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-[#f8f9fa] text-left">
                <th className="w-10 px-3 py-2 text-center text-[10px] font-black text-slate-400">#</th>
                <th className="px-3 py-2 text-[10px] font-black uppercase text-slate-500">
                  {isEn ? "City" : "城市"}
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase text-slate-500">
                  {isEn ? "Hit Rate" : "命中率"}
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase text-slate-500">MAE</th>
                <th className="px-3 py-2 text-right text-[10px] font-black uppercase text-slate-500">
                  {isEn ? "Days" : "训练天数"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {debSorted.length ? debSorted.map((c, i) => {
                const hr = c.deb?.hit_rate ?? 0;
                const mae = c.deb?.mae ?? 0;
                const color = hr >= 65 ? "emerald" : hr >= 45 ? "amber" : "red";
                return (
                  <tr key={c.city_id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2 text-center text-[10px] font-mono text-slate-400">{i + 1}</td>
                    <td className="px-3 py-2 font-semibold text-slate-800 capitalize">{c.name}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="relative h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`absolute inset-y-0 left-0 rounded-full bg-${color}-500 transition-all`}
                            style={{ width: `${Math.min(100, hr)}%` }}
                          />
                          <div
                            className="absolute inset-y-0 left-0 rounded-full opacity-30"
                            style={{
                              width: `${Math.min(100, hr)}%`,
                              background: `repeating-linear-gradient(90deg, transparent, transparent 3px, rgba(255,255,255,0.3) 3px, rgba(255,255,255,0.3) 6px)`,
                            }}
                          />
                        </div>
                        <span className={`w-10 text-right font-mono text-[11px] font-bold text-${color}-600`}>
                          {hr.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">{mae.toFixed(1)}°</td>
                    <td className="px-3 py-2 text-right text-slate-400">{c.deb?.total_days ?? 0}</td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                    {data === null
                      ? (isEn ? "Loading training data..." : "加载训练数据中...")
                      : (isEn ? "No training data available" : "暂无训练数据")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer note */}
        <p className="mt-3 text-center text-[10px] text-slate-400">
          {isEn
            ? "Training data updated daily. Hit rate = DEB prediction within settlement acceptance range."
            : "训练数据每日更新。命中率 = DEB 预报落入结算接受窗口的比例。"}
        </p>
      </div>
    </div>
  );
}
