"use client";

import { useEffect, useMemo, useState } from "react";

type TrainingCity = {
  city_id: string;
  name: string;
  deb?: { hit_rate: number; mae: number; total_days: number } | null;
};

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
        return (res.json() as Promise<{ accuracy: TrainingCity[] }>);
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
    return { avgHit, avgMae, totalDays, cities: debSorted.length };
  }, [debSorted]);

  return (
    <div className="h-full overflow-auto bg-white p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-xl font-black text-slate-900">
          {isEn ? "DEB Training Accuracy" : "DEB 训练数据准确率"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {isEn
            ? "Per-city DEB prediction accuracy. Hit rate measures whether the forecast fell within the settlement window."
            : "各城市 DEB 预报命中率。命中率衡量预报是否落入结算接受窗口。"}
        </p>

        {stats && (
          <div className="mt-6 grid grid-cols-4 gap-3">
            {[
              [isEn ? "Cities" : "城市数", stats.cities],
              [isEn ? "Avg Hit" : "平均命中率", `${stats.avgHit.toFixed(1)}%`],
              ["Avg MAE", `${stats.avgMae.toFixed(1)}°`],
              [isEn ? "Days" : "训练天数", stats.totalDays],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded border border-slate-200 bg-slate-50 p-4">
                <div className="text-[11px] font-bold uppercase text-slate-400">{label}</div>
                <div className="mt-1 font-mono text-xl font-black text-slate-900">{String(value)}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 rounded border border-slate-200 overflow-hidden">
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                <th className="px-4 py-2 font-bold">{isEn ? "City" : "城市"}</th>
                <th className="px-4 py-2 text-right font-bold">{isEn ? "Hit Rate" : "命中率"}</th>
                <th className="px-4 py-2 text-right font-bold">MAE</th>
                <th className="px-4 py-2 text-right font-bold">{isEn ? "Days" : "训练天数"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {debSorted.length ? debSorted.map((c) => {
                const hr = c.deb?.hit_rate ?? 0;
                return (
                  <tr key={c.city_id} className="hover:bg-slate-50">
                    <td className="px-4 py-1.5 font-semibold capitalize">{c.name}</td>
                    <td className="px-4 py-1.5" style={{ minWidth: 180 }}>
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              hr >= 60 ? "bg-emerald-500" : hr >= 30 ? "bg-amber-400" : "bg-red-400"
                            }`}
                            style={{ width: `${Math.min(100, hr)}%` }}
                          />
                        </div>
                        <span className={`font-mono font-bold text-[11px] ${
                          hr >= 60 ? "text-emerald-700" : hr >= 30 ? "text-amber-700" : "text-red-600"
                        }`}>
                          {hr.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono">
                      {(c.deb?.mae ?? 0).toFixed(1)}°
                    </td>
                    <td className="px-4 py-1.5 text-right text-slate-400">
                      {c.deb?.total_days ?? 0}
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                    {data === null ? (isEn ? "Loading..." : "加载中...") : (isEn ? "No training data" : "暂无训练数据")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
