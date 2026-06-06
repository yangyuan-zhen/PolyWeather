"use client";

import clsx from "clsx";
import { temp } from "@/components/dashboard/scan-terminal/utils";

const OBSERVATION_LABEL_EN: Record<string, string> = {
  "参考站点 (1分钟)": "Reference Station (1m)",
  "天文台实测 (10分钟)": "HKO Live (10m)",
  "机场气象站 (10分钟)": "Airport Weather Station (10m)",
  "航站楼温度": "Terminal Temperature",
  "官方机场观测 (15分钟)": "Official Airport Obs (15m)",
  "CWA (10分钟)": "CWA (10m)",
  "气象站实测": "Weather Station Live",
  "跑道实测 (1分钟)": "Runway Live (1m)",
  "机场报文": "Airport METAR",
  "METAR 结算 (30分钟)": "METAR Settlement (30m)",
};

const HIGH_LABEL_EN: Record<string, string> = {
  "参考站点": "Reference Station",
  "天文台实测": "HKO Live",
  "天文台": "HKO",
  "机场气象站": "Airport Weather Station",
  "航站楼": "Terminal",
  "官方机场观测": "Official Airport Obs",
  "气象站": "Weather Station",
  "跑道实测": "Runway",
  "机场报文": "Airport METAR",
  "METAR 官方": "Official METAR",
};

function observationLabel(label: string, isEn: boolean) {
  return isEn ? (OBSERVATION_LABEL_EN[label] || label) : label;
}

function highLabel(label: string, isEn: boolean) {
  return isEn ? (HIGH_LABEL_EN[label] || label) : label;
}

function buildStatsLabels({
  isEn,
  isShenzhen,
  runwayHeaderLabel,
  metarHeaderLabel,
  runwayHighLabel,
  metarHighLabel,
}: {
  isEn: boolean;
  isShenzhen: boolean;
  runwayHeaderLabel: string;
  metarHeaderLabel: string;
  runwayHighLabel: string;
  metarHighLabel: string;
}) {
  const primary = observationLabel(runwayHeaderLabel, isEn);
  const secondaryObservation = observationLabel(metarHeaderLabel, isEn);
  const dailyHigh = isEn ? "Daily High" : "当日最高";
  return {
    primary,
    compactSecondary: isShenzhen ? dailyHigh : secondaryObservation,
    expandedSecondary: `${secondaryObservation} · ${dailyHigh}`,
    dailyPeakTitle: isEn ? "Daily Peak" : "当日最高气温",
    runwayHigh: highLabel(runwayHighLabel, isEn),
    metarHigh: highLabel(metarHighLabel, isEn),
  };
}

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
  displayMetarTemp,
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
  displayMetarTemp: number | null;
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
  const labels = buildStatsLabels({
    isEn,
    isShenzhen,
    runwayHeaderLabel,
    metarHeaderLabel,
    runwayHighLabel,
    metarHighLabel,
  });

  if (compact) {
    return (
      <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-1.5 flex items-center justify-between">
        {timeframe === "1D" ? (
          <div className="flex items-center gap-4 text-[11px]">
            <span className="font-semibold text-slate-500">
              {labels.primary}:{" "}
              <strong className="text-[#009688] font-mono">{temp(displayRunwayTemp, tempSymbol)}</strong>
            </span>
            <span className="text-slate-300">|</span>
            <span className="font-semibold text-slate-500">
              {labels.compactSecondary}:{" "}
              <strong className="text-blue-600 font-mono">{temp(displayMetarTemp, tempSymbol)}</strong>
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
                {labels.primary}
              </span>
              <span className="text-2xl font-bold font-mono text-[#009688] mt-1">
                {temp(displayRunwayTemp, tempSymbol)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                {labels.expandedSecondary}
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
            {labels.dailyPeakTitle}
          </span>
          <div className="mt-1 flex items-center gap-2 text-xs font-mono text-slate-600">
            <span>{labels.runwayHigh}: <strong className="text-[#009688]">{temp(observedHighRunway, tempSymbol)}</strong></span>
            <span>|</span>
            <span>{labels.metarHigh}: <strong className="text-blue-600">{temp(observedHighMetar, tempSymbol)}</strong></span>
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

export const __buildTemperatureStatsLabelsForTest = buildStatsLabels;
