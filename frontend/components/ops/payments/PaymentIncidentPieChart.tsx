"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CHART_TOOLTIP_STYLE } from "@/lib/chart-utils";

const COLORS = ["#ef4444", "#f59e0b", "#3b82f6", "#10b981", "#a855f7", "#6366f1", "#ec4899"];

export function PaymentIncidentPieChart({
  data,
}: {
  data: { name: string; value: number }[];
}) {
  return (
    <div className="w-full h-full flex items-center gap-2">
      <div className="w-[100px] h-[100px] shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={24}
              outerRadius={40}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ ...CHART_TOOLTIP_STYLE, fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto max-h-[100px] text-xs">
        {data.map((item, i) => (
          <div key={item.name} className="flex items-center gap-1.5 truncate">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="text-slate-400 truncate" title={item.name}>{item.name}</span>
            <span className="text-white font-bold ml-auto">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
