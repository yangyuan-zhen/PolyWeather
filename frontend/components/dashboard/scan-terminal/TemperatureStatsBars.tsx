"use client";

import clsx from "clsx";
import { temp } from "@/components/dashboard/scan-terminal/utils";

const OBSERVATION_LABEL_EN: Record<string, string> = {
  "参考站点 (1分钟)": "Reference Station (1m)",
  "天文台实测 (10分钟)": "HKO Live (10m)",
  "机场气象站 (10分钟)": "Airport Weather Station (10m)",
  "航站楼温度": "Terminal Temperature",
  "官方机场观测 (15分钟)": "Official Airport Obs (15m)",
  "气象站实测": "Weather Station Live",
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
  "机场报文": "Airport METAR",
  "METAR 官方": "Official METAR",
};

function observationLabel(label: string, isEn: boolean) {
  return isEn ? (OBSERVATION_LABEL_EN[label] || label) : label;
}

function highLabel(label: string, isEn: boolean) {
  return isEn ? (HIGH_LABEL_EN[label] || label) : label;
}

type DebQuality = {
  quality_tier?: string | null;
  recommendation?: string | null;
  recent_hit_rate?: number | null;
  recent_samples?: number | null;
  ensemble_signal?: DebEnsembleSignal | null;
};

type DebEnsembleSignal = {
  available?: boolean;
  stance?: string | null;
  label_zh?: string | null;
  label_en?: string | null;
  reason_zh?: string | null;
  reason_en?: string | null;
  spread?: number | null;
  deb_distance?: number | null;
  confidence_delta?: number | null;
};

function debQualityLabel(quality: DebQuality | null | undefined, isEn: boolean) {
  const recommendation = quality?.recommendation;
  if (recommendation === "primary") return isEn ? "Primary" : "主用";
  if (recommendation === "supporting") return isEn ? "Support" : "辅助";
  if (recommendation === "context_only") return isEn ? "Context" : "参考";
  if (recommendation === "insufficient") return isEn ? "Thin" : "样本少";
  return "";
}

function debQualityClass(quality: DebQuality | null | undefined) {
  const stance = quality?.ensemble_signal?.available ? quality.ensemble_signal.stance : null;
  if (stance === "caution") return "border-amber-300 bg-amber-50 text-amber-700";
  if (stance === "supporting") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  const tier = quality?.quality_tier;
  if (tier === "high") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tier === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  if (tier === "low") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function debEnsembleShortLabel(signal: DebEnsembleSignal | null | undefined, isEn: boolean) {
  if (!signal?.available) return "";
  if (signal.stance === "supporting") return isEn ? "Ens+" : "集+";
  if (signal.stance === "caution") return isEn ? "Ens!" : "集警";
  return "";
}

function debQualityTitle(quality: DebQuality | null | undefined, isEn: boolean) {
  const label = debQualityLabel(quality, isEn);
  const hitRate = quality?.recent_hit_rate;
  const samples = quality?.recent_samples;
  const ensemble = quality?.ensemble_signal;
  const titleParts = [
    label ? (isEn ? `DEB recommendation: ${label}` : `DEB 建议：${label}`) : null,
    hitRate == null ? null : `${hitRate.toFixed(0)}%`,
    samples == null ? null : `n=${samples}`,
    ensemble?.available
      ? `${isEn ? ensemble.label_en || "Ensemble" : ensemble.label_zh || "集合"}: ${
          isEn ? ensemble.reason_en || "" : ensemble.reason_zh || ""
        }`
      : null,
  ].filter(Boolean);
  return titleParts.join(" · ");
}

function DebQualityBadge({ quality, isEn }: { quality?: DebQuality | null; isEn: boolean }) {
  const label = debQualityLabel(quality, isEn);
  const ensembleLabel = debEnsembleShortLabel(quality?.ensemble_signal, isEn);
  if (!label && !ensembleLabel) return null;
  return (
    <span
      className={clsx("ml-1.5 inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-black uppercase leading-none", debQualityClass(quality))}
      title={debQualityTitle(quality, isEn)}
    >
      {label || "DEB"}
      {ensembleLabel && (
        <span className="ml-1 border-l border-current/30 pl-1">
          {ensembleLabel}
        </span>
      )}
    </span>
  );
}

function buildStatsLabels({
  isEn,
  isShenzhen,
  metarRedundant,
  obsHeaderLabel,
  metarHeaderLabel,
  obsHighLabel,
  metarHighLabel,
}: {
  isEn: boolean;
  isShenzhen: boolean;
  metarRedundant: boolean;
  obsHeaderLabel: string;
  metarHeaderLabel: string;
  obsHighLabel: string;
  metarHighLabel: string;
}) {
  const primary = observationLabel(obsHeaderLabel, isEn);
  const secondaryObservation = observationLabel(metarHeaderLabel, isEn);
  const dailyHigh = isEn ? "Daily High" : "当日最高";
  // When the observation layer IS the airport METAR (plain cities without a
  // weather-station / official network), the secondary block shows the daily
  // high only instead of repeating the same METAR value.
  const collapsed = metarRedundant;
  return {
    primary,
    compactSecondary: isShenzhen ? dailyHigh : (collapsed ? dailyHigh : secondaryObservation),
    expandedSecondary: collapsed ? dailyHigh : `${secondaryObservation} · ${dailyHigh}`,
    dailyPeakTitle: isEn ? "Daily Peak" : "当日最高气温",
    obsHigh: highLabel(obsHighLabel, isEn),
    metarHigh: highLabel(metarHighLabel, isEn),
  };
}

export function TemperatureStatsBars({
  isEn,
  compact,
  timeframe,
  tempSymbol,
  obsHeaderLabel,
  metarHeaderLabel,
  obsHighLabel,
  metarHighLabel,
  metarRedundant,
  isShenzhen,
  displayObsTemp,
  displayMetarTemp,
  observedHighMetar,
  observedHighObs,
  debVal,
  debQuality,
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
  obsHeaderLabel: string;
  metarHeaderLabel: string;
  obsHighLabel: string;
  metarHighLabel: string;
  metarRedundant: boolean;
  isShenzhen: boolean;
  displayObsTemp: number | null;
  displayMetarTemp: number | null;
  observedHighMetar: number | null;
  observedHighObs: number | null;
  debVal: number | null;
  debQuality?: DebQuality | null;
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
    metarRedundant,
    obsHeaderLabel,
    metarHeaderLabel,
    obsHighLabel,
    metarHighLabel,
  });

  if (compact) {
    return (
      <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-1.5 flex items-center justify-between">
        {timeframe === "1D" ? (
          <div className="flex items-center gap-4 text-[11px]">
            <span className="font-semibold text-slate-500">
              {labels.primary}:{" "}
              <strong className="text-[#009688] font-mono">{temp(displayObsTemp, tempSymbol)}</strong>
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
              <DebQualityBadge quality={debQuality} isEn={isEn} />
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
                {temp(displayObsTemp, tempSymbol)}
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
                <DebQualityBadge quality={debQuality} isEn={isEn} />
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
            <span>{labels.obsHigh}: <strong className="text-[#009688]">{temp(observedHighObs, tempSymbol)}</strong></span>
            <span>|</span>
            <span>{labels.metarHigh}: <strong className="text-blue-600">{temp(observedHighMetar, tempSymbol)}</strong></span>
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
              <DebQualityBadge quality={debQuality} isEn={isEn} />
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
export const __buildDebQualityLabelForTest = debQualityLabel;
export const __buildDebQualityClassForTest = debQualityClass;
export const __buildDebQualityTitleForTest = debQualityTitle;
export const __buildDebEnsembleLabelForTest = debEnsembleShortLabel;
