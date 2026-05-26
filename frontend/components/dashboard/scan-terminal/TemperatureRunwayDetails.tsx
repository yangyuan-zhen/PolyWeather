"use client";

import clsx from "clsx";

type RunwayPlate = {
  rwy: string;
  isSettlement: boolean;
  tdzTemp: number | null;
  midTemp: number | null;
  endTemp: number | null;
  maxTemp: number | null;
  dailyHigh: number | null;
  trend_15m: number | null;
};

export function TemperatureRunwayDetails({
  isEn,
  plates,
  tempSymbol,
}: {
  isEn: boolean;
  plates: RunwayPlate[];
  tempSymbol: string;
}) {
  if (!plates.length) return null;

  return (
    <div className="shrink-0 border-b border-slate-200 bg-[#f8fafc] px-3 py-2">
      <div className="flex items-center justify-between text-[11px] font-black text-slate-700 mb-1.5 uppercase">
        <span>{isEn ? "Runway Observations" : "跑道观测"}</span>
        {plates.some((p) => p.trend_15m !== null && p.trend_15m > 0 && !p.isSettlement) && (
          <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-sans">
            {isEn ? "Non-settlement Runway Warming Alert" : "非结算跑道升温提醒"}
          </span>
        )}
      </div>
      <div className="grid gap-1">
        {plates.map((plate) => (
          <div
            key={plate.rwy}
            className={clsx(
              "grid grid-cols-7 gap-2 items-center border rounded px-2.5 py-1 text-[11px] font-mono",
              plate.isSettlement
                ? "border-emerald-200 bg-emerald-50/50 text-emerald-950 font-bold"
                : "border-slate-200 bg-white text-slate-600"
            )}
          >
            <div className="flex items-center gap-1.5 font-sans font-bold text-slate-800">
              {plate.isSettlement && <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />}
              <span>{plate.rwy}</span>
              {plate.isSettlement && (
                <span className="text-[9px] bg-teal-200 text-teal-800 px-1 rounded font-normal">
                  {isEn ? "Settlement" : "结算"}
                </span>
              )}
            </div>
            <div>TDZ: <strong>{plate.tdzTemp !== null ? `${plate.tdzTemp.toFixed(1)}${tempSymbol}` : "--"}</strong></div>
            <div>MID: <strong>{plate.midTemp !== null ? `${plate.midTemp.toFixed(1)}${tempSymbol}` : "--"}</strong></div>
            <div>END: <strong>{plate.endTemp !== null ? `${plate.endTemp.toFixed(1)}${tempSymbol}` : "--"}</strong></div>
            <div>max: <strong>{plate.maxTemp !== null ? `${plate.maxTemp.toFixed(1)}${tempSymbol}` : "--"}</strong></div>
            <div>high: <strong>{plate.dailyHigh !== null ? `${plate.dailyHigh.toFixed(1)}${tempSymbol}` : "--"}</strong></div>
            <div className={clsx(plate.trend_15m !== null && plate.trend_15m > 0 ? "text-orange-600 font-bold" : "text-slate-500")}>
              15m: <strong>{plate.trend_15m !== null ? `${plate.trend_15m >= 0 ? "+" : ""}${plate.trend_15m.toFixed(1)}${tempSymbol}` : "--"}</strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
