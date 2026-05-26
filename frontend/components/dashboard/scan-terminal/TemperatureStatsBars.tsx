"use client";

import clsx from "clsx";
import { temp } from "@/components/dashboard/scan-terminal/utils";

export function TemperatureStatsBars({
  isEn,
  compact,
  timeframe,
  tempSymbol,
  runwayHeaderLabel,
  metarHeaderLabel,
  runwayHighLabel,
  metarHighLabel,
  isShenzhen,
  displayRunwayTemp,
  observedHighMetar,
  observedHighRunway,
  wundergroundDailyHigh,
  debVal,
  modelMin,
  modelMax,
  spread,
  spreadLabel,
  spreadLabelEn,
  formattedUpdateTime,
}: {
  isEn: boolean;
  compact: boolean;
  timeframe: string;
  tempSymbol: string;
  runwayHeaderLabel: string;
  metarHeaderLabel: string;
  runwayHighLabel: string;
  metarHighLabel: string;
  isShenzhen: boolean;
  displayRunwayTemp: number | null;
  observedHighMetar: number | null;
  observedHighRunway: number | null;
  wundergroundDailyHigh: number | null;
  debVal: number | null;
  modelMin: number | null;
  modelMax: number | null;
  spread: number | null;
  spreadLabel: string;
  spreadLabelEn: string;
  formattedUpdateTime: string;
}) {
  if (compact) {
    return (
      <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-1.5 flex items-center justify-between">
        {timeframe === "1D" ? (
          <div className="flex items-center gap-4 text-[11px]">
            <span className="font-semibold text-slate-500">
              {isEn ? "Runway" : runwayHeaderLabel}:{" "}
              <strong className="text-[#009688] font-mono">{temp(displayRunwayTemp, tempSymbol)}</strong>
            </span>
            <span className="text-slate-300">|</span>
            <span className="font-semibold text-slate-500">
              {isEn ? "METAR" : (isShenzhen ? "当日最高" : metarHeaderLabel)}:{" "}
              <strong className="text-blue-600 font-mono">{temp(observedHighMetar, tempSymbol)}</strong>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-4 text-[11px]">
            <span className="font-semibold text-slate-500">
              DEB: <strong className="text-orange-600 font-mono">{temp(debVal, tempSymbol)}</strong>
            </span>
            {modelMin !== null && modelMax !== null && (
              <>
                <span className="text-slate-300">|</span>
                <span className="font-semibold text-slate-500">
                  {isEn ? "Models" : "多模型"}:{" "}
                  <strong className="text-slate-700 font-mono">
                    {temp(modelMin, tempSymbol)} - {temp(modelMax, tempSymbol)}
                  </strong>
                </span>
              </>
            )}
          </div>
        )}
        <div className="text-[10px] text-slate-400 font-mono">
          {timeframe === "1D" && formattedUpdateTime.includes(" ") ? formattedUpdateTime.split(" ")[1].slice(0, 5) : ""}
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex justify-between items-center gap-6 mb-3">
        {timeframe === "1D" ? (
          <div className="flex items-center gap-12">
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                {isEn ? "Runway Live (1m)" : `${runwayHeaderLabel}`}
              </span>
              <span className="text-2xl font-bold font-mono text-[#009688] mt-1">
                {temp(displayRunwayTemp, tempSymbol)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                {isEn ? "METAR Settlement · Daily High" : `${metarHeaderLabel} · 当日最高`}
              </span>
              <span className="text-2xl font-bold font-mono text-blue-600 mt-1">
                {temp(observedHighMetar, tempSymbol)}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-12">
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                DEB Max
              </span>
              <span className="text-2xl font-bold font-mono text-orange-600 mt-1">
                {temp(debVal, tempSymbol)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                {isEn ? "Model Range" : "多模型区间"}
              </span>
              <span className="text-2xl font-bold font-mono text-slate-700 mt-1">
                {modelMin !== null && modelMax !== null ? `${temp(modelMin, tempSymbol)} - ${temp(modelMax, tempSymbol)}` : "--"}
              </span>
            </div>
          </div>
        )}

        <div className="hidden sm:flex flex-col items-end text-right">
          <span className="text-[10px] text-slate-400 uppercase font-semibold">
            {isEn ? "Daily Peak" : "当日最高气温"}
          </span>
          <div className="mt-1 flex items-center gap-2 text-xs font-mono text-slate-600">
            <span>{isEn ? "Runway" : runwayHighLabel}: <strong className="text-[#009688]">{temp(observedHighRunway, tempSymbol)}</strong></span>
            <span>|</span>
            <span>{isEn ? "METAR" : metarHighLabel}: <strong className="text-blue-600">{temp(observedHighMetar, tempSymbol)}</strong></span>
            {wundergroundDailyHigh !== null && (
              <>
                <span>|</span>
                <span>WU: <strong className="text-purple-600">{temp(wundergroundDailyHigh, tempSymbol)}</strong></span>
              </>
            )}
          </div>
        </div>
      </div>

      {timeframe === "1D" && (
        <div className="grid grid-cols-4 gap-4 border-t border-slate-100 pt-3 text-xs font-mono text-slate-700 bg-slate-50/50 -mx-4 px-4 rounded-b-md">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">
              {isEn ? "Model Range" : "模型区间"}
            </span>
            <strong className="text-slate-800 font-bold">
              {modelMin !== null && modelMax !== null ? `${temp(modelMin, tempSymbol)} - ${temp(modelMax, tempSymbol)}` : "--"}
            </strong>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">
              DEB
            </span>
            <strong className="text-blue-600 font-bold">
              {temp(debVal, tempSymbol)}
            </strong>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">
              {isEn ? "Spread" : "分歧"}
            </span>
            <strong className={clsx("font-bold", spreadLabel === "高分歧" ? "text-amber-600" : "text-slate-600")}>
              {spread !== null ? `${spread.toFixed(1)}${tempSymbol}` : "--"}
              {spreadLabel && ` · ${isEn ? spreadLabelEn : spreadLabel}`}
            </strong>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">
              {isEn ? "Updated" : "更新时间"}
            </span>
            <strong className="text-slate-800 font-bold">
              {formattedUpdateTime}
            </strong>
          </div>
        </div>
      )}
    </div>
  );
}
