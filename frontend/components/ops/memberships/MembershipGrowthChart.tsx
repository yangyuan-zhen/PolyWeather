"use client";

import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_TOOLTIP_STYLE } from "@/lib/chart-utils";

type GrowthPoint = { date: string; trial: number; paid: number; total: number; cumulative: number };

export function MembershipGrowthChart({
  growth,
}: {
  growth: GrowthPoint[];
}) {
  return (
    <>
      <div className="mb-6">
        <h4 className="text-xs text-slate-500 mb-2">累计会员</h4>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={growth}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "#64748b", fontSize: 10 }} width={45} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
            <Area type="monotone" dataKey="cumulative" stroke="#06b6d4" fill="#06b6d420" name="累计" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h4 className="text-xs text-slate-500 mb-2">每日新增</h4>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={growth}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "#64748b", fontSize: 10 }} width={30} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="paid" stackId="1" stroke="#22c55e" fill="#22c55e60" name="付费" />
            <Area type="monotone" dataKey="trial" stackId="1" stroke="#f59e0b" fill="#f59e0b60" name="体验" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
