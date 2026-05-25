"use client";

import { useEffect, useState } from "react";
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
import { Panel } from "@/components/dashboard/scan-terminal/Panel";
import { DASHBOARD_REFRESH_POLICY_MS } from "@/lib/refresh-policy";

type StreamPoint = { timestamp: string; temp: number; source: string };
type Threshold = { label: string; threshold_c: number; breached: boolean };

type StreamPayload = {
  points: StreamPoint[];
  thresholds: Threshold[];
};

const POLL_INTERVAL_MS = DASHBOARD_REFRESH_POLICY_MS.observation;

export function RealtimeScrollChart({
  city,
  isEn,
}: {
  city: string;
  isEn: boolean;
}) {
  const [payload, setPayload] = useState<StreamPayload>({ points: [], thresholds: [] });

  useEffect(() => {
    if (!city) return;
    let cancelled = false;

    const fetchStream = () => {
      fetch(`/api/city/${encodeURIComponent(city)}/realtime-stream`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      })
        .then(async (res) => {
          if (!res.ok) return null;
          return res.json() as Promise<StreamPayload>;
        })
        .then((data) => {
          if (cancelled || !data) return;
          setPayload(data);
        })
        .catch(() => {});
    };

    fetchStream();
    const interval = setInterval(fetchStream, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [city]);

  const { points, thresholds } = payload;
  const latestTemp = points.length ? points[points.length - 1].temp : null;
  const breached = thresholds.filter((t) => t.breached);
  const domainMin = thresholds.length
    ? Math.min(...thresholds.map((t) => t.threshold_c)) - 2
    : "auto";
  const domainMax = thresholds.length
    ? Math.max(...thresholds.map((t) => t.threshold_c)) + 2
    : "auto";

  return (
    <Panel title={isEn ? "Realtime Scrolling Temperature" : "实时滚动温度"}>
      <div className="flex h-full min-h-[300px] flex-col">
        {/* Status bar */}
        <div className="shrink-0 flex items-center gap-4 border-b border-slate-200 bg-white px-3 py-1.5 text-[10px]">
          <span className="font-black text-slate-600">
            {isEn ? "Latest" : "最新"}:{" "}
            <span className="font-mono text-teal-700">
              {latestTemp !== null ? `${latestTemp.toFixed(1)}°` : "--"}
            </span>
          </span>
          <span className="text-slate-400">
            {isEn ? "Points" : "数据点"}: {points.length}
          </span>
          {breached.length > 0 && (
            <span className="font-black text-amber-600">
              {isEn ? "Breached" : "已触发"}: {breached.map((t) => t.label).join(", ")}
            </span>
          )}
        </div>

        {/* Chart */}
        <div className="min-h-0 flex-1 p-2">
          {points.length < 2 ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">
              {isEn ? "Collecting data..." : "数据采集中..."}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ReLineChart data={points} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="2 2" />
                <XAxis
                  dataKey="timestamp"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  tickLine={false}
                  axisLine={{ stroke: "#cbd5e1" }}
                  interval={Math.max(1, Math.floor(points.length / 6))}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  tickFormatter={(v) => `${Number(v).toFixed(1)}°`}
                  axisLine={{ stroke: "#cbd5e1" }}
                  tickLine={false}
                  domain={[domainMin, domainMax]}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    border: "1px solid #cbd5e1",
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                  formatter={(value: unknown) => [`${Number(value).toFixed(2)}°`, "Temp"]}
                  labelFormatter={(label) => `${label}`}
                />
                {/* Temperature line */}
                <Line
                  type="linear"
                  dataKey="temp"
                  stroke="#009688"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                {/* Threshold lines */}
                {thresholds.map((t) => (
                  <ReferenceLine
                    key={t.label}
                    y={t.threshold_c}
                    stroke={t.breached ? "#f97316" : "#94a3b8"}
                    strokeDasharray="4 4"
                    strokeWidth={1}
                    label={{
                      value: t.label,
                      fill: t.breached ? "#f97316" : "#94a3b8",
                      fontSize: 9,
                      position: "right",
                    }}
                  />
                ))}
              </ReLineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </Panel>
  );
}
