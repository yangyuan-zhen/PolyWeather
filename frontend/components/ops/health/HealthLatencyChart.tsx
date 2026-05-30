"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_TOOLTIP_STYLE } from "@/lib/chart-utils";

const COLORS = ["#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#ef4444"];

export function HealthLatencyChart({
  data,
}: {
  data: { name: string; latency: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 28 + 40)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis type="number" stroke="rgba(255,255,255,0.2)" tick={{ fill: "#64748b", fontSize: 10 }} />
        <YAxis type="category" dataKey="name" stroke="rgba(255,255,255,0.2)" tick={{ fill: "#94a3b8", fontSize: 11 }} width={120} />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          formatter={(value) => [`${value} ms`, "延迟"]}
        />
        <Bar dataKey="latency" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
