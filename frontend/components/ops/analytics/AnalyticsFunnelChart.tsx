"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_TOOLTIP_STYLE } from "@/lib/chart-utils";

const COLORS = ["#2563eb", "#0ea5e9", "#6366f1", "#f59e0b", "#22c55e", "#10b981", "#14b8a6"];

export function AnalyticsFunnelChart({
  data,
}: {
  data: { name: string; count: number; pct?: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={data.length * 60 + 40}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 5, right: 40, left: 140, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#dbe7f3" />
        <XAxis type="number" stroke="#cbd7e6" tick={{ fill: "#64748b", fontSize: 12 }} />
        <YAxis type="category" dataKey="name" stroke="#cbd7e6" tick={{ fill: "#334155", fontSize: 13 }} width={130} />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          formatter={(value) => [`${value} 次`, "数量"]}
        />
        <Bar dataKey="count" radius={[0, 6, 6, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
