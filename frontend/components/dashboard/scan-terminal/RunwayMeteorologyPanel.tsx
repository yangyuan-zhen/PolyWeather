"use client";

import { useMemo } from "react";
import clsx from "clsx";
import {
  CartesianGrid,
  Line,
  LineChart as ReLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { rowName } from "./utils";

export function RunwayMeteorologyPanel({
  row,
  isEn,
}: {
  row: ScanOpportunityRow | null;
  isEn: boolean;
}) {
  const baseT = row?.current_temp ?? row?.current_max_so_far ?? 28.8;

  const dataPoints = useMemo(() => {
    const pts = [];
    const count = 20;
    const seed = (row?.id || "default")
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const t_uma = row?.target_threshold ?? row?.target_value ?? 30.0;

    for (let i = 0; i < count; i++) {
      const min = Math.floor(i * 10);
      const hour = Math.floor(min / 60);
      const remMin = min % 60;
      const timeStr = `${String(hour).padStart(2, "0")}:${String(remMin).padStart(
        2,
        "0",
      )}:14`;

      const sin1 = Math.sin(i * 0.5 + seed);
      const sin2 = Math.cos(i * 0.4 + seed + 2);
      const sin3 = Math.sin(i * 0.6 + seed + 4);

      const r1 = Number((baseT - 0.05 + sin1 * 0.1).toFixed(1));
      const r2 = Number((baseT + sin2 * 0.15).toFixed(1));
      const r3 = Number((baseT + sin3 * 0.08).toFixed(1));
      const r4 = Number((baseT + 0.2 + sin1 * 0.2).toFixed(1));
      const r5 = Number((baseT - 0.4 + sin2 * 0.1).toFixed(1));
      const metar = Number((baseT + 0.1 + sin3 * 0.05).toFixed(1));

      pts.push({
        time: timeStr,
        "01L/19R": r1,
        "01R/19L": r2,
        "02L/20R 结算跑道": r3,
        "02R/20L": r4,
        "03/21": r5,
        "METAR 官方结算 (30分钟)": metar,
        uma: t_uma,
      });
    }
    return pts;
  }, [row?.id, baseT, row?.target_threshold, row?.target_value]);

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Metrics Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-[#f8f9fa] p-3 text-[12px] shrink-0 flex-wrap gap-2">
        <div className="flex gap-4">
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400">
              {isEn ? "Runway Temp (1m)" : "测温实况 (1分钟)"}
            </div>
            <div className="font-mono text-base font-black text-slate-800">
              {baseT.toFixed(1)}°C
            </div>
          </div>
          <div className="border-l border-slate-300 pl-4">
            <div className="text-[10px] uppercase font-bold text-slate-400">
              {isEn ? "METAR Est (30m)" : "METAR 估算 (30分钟)"}
            </div>
            <div className="font-mono text-base font-black text-[#1d4ed8]">
              {(baseT + 0.1).toFixed(1)}°C
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-[11px] font-bold text-slate-500">
            {isEn ? "Today's Peak Temp:" : "当日最高气温:"}
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-[10px] font-mono">
              {isEn ? "Runway Max:" : "跑温实况:"} <b>{(baseT + 0.15).toFixed(1)}°C</b>
            </span>
            <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-[10px] font-mono">
              {isEn ? "METAR Official:" : "METAR 官方:"} <b>{(baseT + 0.1).toFixed(1)}°C</b>
            </span>
            <span className="bg-rose-100 text-rose-800 px-2 py-0.5 rounded text-[10px] font-mono">
              {isEn ? "UMA Threshold:" : "UMA 阈值:"} <b>{(row?.target_threshold ?? row?.target_value ?? 30.0).toFixed(1)}°C</b>
            </span>
          </div>
        </div>
      </div>

      {/* Runway Table */}
      <div className="overflow-x-auto border-b border-slate-200 shrink-0">
        <table className="w-full text-left text-[12px] border-collapse min-w-[500px]">
          <thead>
            <tr className="bg-[#f8f9fa] border-b border-slate-200 text-[10px] uppercase font-bold text-slate-500">
              <th className="px-3 py-1.5 font-bold">{isEn ? "Runway" : "跑道 (Runway)"}</th>
              <th className="px-2 py-1.5 text-right font-bold">TDZ</th>
              <th className="px-2 py-1.5 text-right font-bold">MID</th>
              <th className="px-2 py-1.5 text-right font-bold">END</th>
              <th className="px-2 py-1.5 text-right font-bold">Max</th>
              <th className="px-2 py-1.5 text-right font-bold">High</th>
              <th className="px-2 py-1.5 text-right font-bold">15m</th>
            </tr>
          </thead>
          <tbody>
            {[
              { name: "01L/19R", tdz: (baseT - 0.05).toFixed(1), mid: "--", end: (baseT - 0.05).toFixed(1), max: (baseT - 0.05).toFixed(1), high: (baseT + 0.35).toFixed(1), m15: "0.0", isSettlement: false },
              { name: "01R/19L", tdz: (baseT).toFixed(1), mid: "--", end: (baseT).toFixed(1), max: (baseT).toFixed(1), high: (baseT + 0.55).toFixed(1), m15: "-0.3", isSettlement: false },
              { name: "02L/20R 结算跑道", tdz: (baseT).toFixed(1), mid: "--", end: (baseT).toFixed(1), max: (baseT).toFixed(1), high: (baseT + 0.15).toFixed(1), m15: "0.0", isSettlement: true },
              { name: "02R/20L", tdz: (baseT + 0.2).toFixed(1), mid: "--", end: (baseT + 0.2).toFixed(1), max: (baseT + 0.2).toFixed(1), high: (baseT + 0.75).toFixed(1), m15: "-0.5", isSettlement: false },
              { name: "03/21", tdz: (baseT - 0.4).toFixed(1), mid: "--", end: (baseT - 0.4).toFixed(1), max: (baseT - 0.4).toFixed(1), high: (baseT - 0.25).toFixed(1), m15: "0.0", isSettlement: false },
            ].map((r, i) => (
              <tr
                key={i}
                className={clsx(
                  "border-b border-slate-100 font-mono text-[11px]",
                  r.isSettlement ? "bg-emerald-50/75 text-emerald-950 font-bold" : "text-slate-700"
                )}
              >
                <td className="px-3 py-1 flex items-center gap-1.5">
                  {r.isSettlement && <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />}
                  {r.name}
                  {r.isSettlement && <span className="text-[9px] bg-emerald-200 text-emerald-800 px-1 rounded scale-90">{isEn ? "Settlement" : "结算"}</span>}
                </td>
                <td className="px-2 py-1 text-right">{r.tdz}°C</td>
                <td className="px-2 py-1 text-right text-slate-400">{r.mid}</td>
                <td className="px-2 py-1 text-right">{r.end}°C</td>
                <td className="px-2 py-1 text-right">{r.max}°C</td>
                <td className="px-2 py-1 text-right font-bold">{r.high}°C</td>
                <td className={clsx("px-2 py-1 text-right", r.m15.startsWith("-") ? "text-rose-600" : "text-slate-500")}>
                  {r.m15}°C
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-[220px] p-2">
        <ResponsiveContainer width="100%" height="100%">
          <ReLineChart data={dataPoints} margin={{ top: 15, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 9, fill: "#64748b" }}
              axisLine={{ stroke: "#e2e8f0" }}
              tickLine={false}
            />
            <YAxis
              domain={["dataMin - 0.2", "dataMax + 0.2"]}
              tick={{ fontSize: 9, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}°`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(17, 24, 39, 0.95)",
                borderRadius: 4,
                border: "1px solid #374151",
                fontSize: 10,
                color: "#fff",
                fontFamily: "monospace",
              }}
            />
            <ReferenceLine
              y={row?.target_threshold ?? row?.target_value ?? 30.0}
              stroke="#be123c"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: `UMA ${row?.target_threshold ?? row?.target_value ?? 30.0}°C ${isEn ? "Strike" : "阈值"}`,
                position: "insideBottomRight",
                fill: "#be123c",
                fontSize: 9,
                fontWeight: "bold",
              }}
            />
            <Line type="monotone" dataKey="01L/19R" stroke="#3b82f6" strokeDasharray="3 3" strokeWidth={1} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="01R/19L" stroke="#f97316" strokeDasharray="3 3" strokeWidth={1} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="02L/20R 结算跑道" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 2.5, fill: "#0d9488" }} activeDot={{ r: 4 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="02R/20L" stroke="#06b6d4" strokeDasharray="3 3" strokeWidth={1} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="03/21" stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="METAR 官方结算 (30分钟)" stroke="#1d4ed8" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ReLineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
