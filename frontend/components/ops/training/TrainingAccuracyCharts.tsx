"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHART_TOOLTIP_STYLE } from "@/lib/chart-utils";

type DebChartRow = {
  name: string;
  cityId: string;
  hitRate: number;
  mae: number;
  days: number;
};

type MuChartRow = {
  name: string;
  cityId: string;
  brierScore: number;
  hitRate: number;
  mae: number;
  days: number;
};

const CHART_COLORS = {
  green: "#22c55e",
  yellow: "#eab308",
  red: "#ef4444",
};

function hitColor(hitRate: number) {
  if (hitRate >= 80) return CHART_COLORS.green;
  if (hitRate >= 60) return CHART_COLORS.yellow;
  return CHART_COLORS.red;
}

function maeColor(mae: number) {
  if (mae <= 1.5) return CHART_COLORS.green;
  if (mae <= 2.5) return CHART_COLORS.yellow;
  return CHART_COLORS.red;
}

function brierColor(score: number) {
  if (score <= 0.1) return CHART_COLORS.green;
  if (score <= 0.25) return CHART_COLORS.yellow;
  return CHART_COLORS.red;
}

export function TrainingAccuracyCharts({
  debChartData,
  muChartData,
}: {
  debChartData: DebChartRow[];
  muChartData: MuChartRow[];
}) {
  return (
    <>
      {debChartData.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle>DEB 可用近期命中率 by 城市</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer>
                  <BarChart data={debChartData} margin={{ top: 8, right: 8, left: 8, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" tick={{ fill: "#94a3b8", fontSize: 11 }} interval={0} />
                    <YAxis domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 11 }} unit="%" />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      formatter={(value: unknown) => [`${Number(value).toFixed(1)}%`, "可用近期命中率"]}
                    />
                    <Bar dataKey="hitRate" radius={[4, 4, 0, 0]} maxBarSize={36}>
                      {debChartData.map((entry, i) => (
                        <Cell key={i} fill={hitColor(entry.hitRate)} fillOpacity={0.85} />
                      ))}
                      <LabelList dataKey="hitRate" position="top" style={{ fill: "#94a3b8", fontSize: 10 }} formatter={(v: unknown) => `${Number(v)}%`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>DEB 可用近期 MAE by 城市</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer>
                  <ComposedChart data={debChartData} margin={{ top: 8, right: 8, left: 8, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" tick={{ fill: "#94a3b8", fontSize: 11 }} interval={0} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} unit="°" />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      formatter={(value: unknown) => [`${Number(value).toFixed(1)}°`, "可用近期 MAE"]}
                    />
                    <Bar dataKey="mae" radius={[4, 4, 0, 0]} maxBarSize={36}>
                      {debChartData.map((entry, i) => (
                        <Cell key={i} fill={maeColor(entry.mae)} fillOpacity={0.85} />
                      ))}
                      <LabelList dataKey="mae" position="top" style={{ fill: "#94a3b8", fontSize: 10 }} formatter={(v: unknown) => `${Number(v)}°`} />
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {muChartData.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle>概率 μ Brier Score by 城市</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer>
                  <BarChart data={muChartData} margin={{ top: 8, right: 8, left: 8, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" tick={{ fill: "#94a3b8", fontSize: 11 }} interval={0} />
                    <YAxis domain={[0, 0.5]} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      formatter={(value: unknown) => [Number(value).toFixed(4), "Brier Score"]}
                    />
                    <Bar dataKey="brierScore" radius={[4, 4, 0, 0]} maxBarSize={36}>
                      {muChartData.map((entry, i) => (
                        <Cell key={i} fill={brierColor(entry.brierScore)} fillOpacity={0.85} />
                      ))}
                      <LabelList dataKey="brierScore" position="top" style={{ fill: "#94a3b8", fontSize: 10 }} formatter={(v: unknown) => Number(v).toFixed(3)} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>概率 μ 命中率 by 城市</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer>
                  <BarChart data={muChartData} margin={{ top: 8, right: 8, left: 8, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" tick={{ fill: "#94a3b8", fontSize: 11 }} interval={0} />
                    <YAxis domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 11 }} unit="%" />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      formatter={(value: unknown) => [`${Number(value).toFixed(1)}%`, "命中率"]}
                    />
                    <Bar dataKey="hitRate" radius={[4, 4, 0, 0]} maxBarSize={36}>
                      {muChartData.map((entry, i) => (
                        <Cell key={i} fill={hitColor(entry.hitRate)} fillOpacity={0.85} />
                      ))}
                      <LabelList dataKey="hitRate" position="top" style={{ fill: "#94a3b8", fontSize: 10 }} formatter={(v: unknown) => `${Number(v)}%`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
