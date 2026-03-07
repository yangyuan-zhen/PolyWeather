"use client";

import React from "react";
import {
  BarChart2,
  Target,
  ShieldAlert,
  Zap,
  Info,
  Activity,
  ArrowUpRight,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Sparkline } from "./Sparkline";
import { CityDetail } from "../../lib/types";

interface AnalyticsPanelProps {
  data: CityDetail;
  t?: any; // Optional translations
}

export function AnalyticsPanel({
  data,
  t = {}, // Default empty for now, can be expanded via context or props
}: AnalyticsPanelProps) {
  const { overview, market_scan, models, ai_analysis } = data;

  const modelEntries = Object.entries(models)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([label, value]) => ({ label, value: value as number }))
    .sort((a, b) => b.value - a.value);

  const signalColor =
    market_scan.signal_label === "BUY YES"
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
      : market_scan.signal_label === "BUY NO"
        ? "border-rose-500/30 bg-rose-500/5 text-rose-400"
        : "border-zinc-800 bg-zinc-900/50 text-zinc-400";

  const signalIconColor =
    market_scan.signal_label === "BUY YES"
      ? "text-emerald-500"
      : market_scan.signal_label === "BUY NO"
        ? "text-rose-500"
        : "text-zinc-500";

  return (
    <div className="flex relative h-full w-[400px] flex-col bg-zinc-950/20 backdrop-blur-sm border-l border-zinc-800/50 overflow-hidden">
      {/* Header Stat Area */}
      <div className="p-4 border-b border-zinc-800 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
            {t.marketAnalysis || "MARKET ANALYSIS"}
          </h2>
          <Badge className="bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border-cyan-500/30 text-[9px] h-5">
            {t.realTime || "LIVE UPLINK"}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 ring-1 ring-inset ring-white/5">
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-tighter">
              {t.liveMetar || "REAL-TIME METAR"}
            </span>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-xl font-black text-white">
                {overview.current_temp?.toFixed(1) || "--"}
              </span>
              <span className="text-[10px] font-bold text-zinc-500">
                {overview.temp_symbol}
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 ring-1 ring-inset ring-white/5">
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-tighter">
              {t.ensembleDeb || "ENSEMBLE DEB"}
            </span>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-xl font-black text-cyan-400">
                {overview.deb_prediction?.toFixed(1) || "--"}
              </span>
              <span className="text-[10px] font-bold text-cyan-500">
                {overview.temp_symbol}
              </span>
            </div>
          </div>
        </div>

        {/* Trade Execution Signal */}
        <div
          className={`rounded-xl border p-4 transition-all duration-500 ${signalColor}`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tighter">
                {t.signalStrategy || "SIGNAL STRATEGY"}
              </span>
              <div className="flex items-center gap-2">
                <Zap
                  className={`h-4 w-4 ${market_scan.available ? "animate-pulse" : ""} ${signalIconColor}`}
                />
                <span className="text-sm font-black text-white italic uppercase tracking-wider">
                  {market_scan.signal_label}
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tighter">
                {t.confidence || "CONFIDENCE"}
              </span>
              <div className="mt-1 text-xs font-black text-white opacity-80 uppercase tracking-widest">
                {market_scan.confidence}
              </div>
            </div>
          </div>
          <div className="h-10 mt-2 flex items-end">
            <Sparkline
              data={
                market_scan.sparkline.length > 0
                  ? market_scan.sparkline
                  : [1, 1, 1]
              }
              width={360}
              height={35}
              color={
                market_scan.signal_label === "BUY YES"
                  ? "#10b981"
                  : market_scan.signal_label === "BUY NO"
                    ? "#f43f5e"
                    : "#52525b"
              }
            />
          </div>
        </div>
      </div>

      {/* Probability & Market Pricing */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar pb-20">
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Target className="h-3 w-3 text-violet-400" />
            <span className="text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400">
              {t.yieldArbitrage || "YIELD ARBITRAGE"}
            </span>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] uppercase font-bold text-zinc-500">
                <span>{t.probComparison || "PROB COMPARISON"}</span>
                <span className="text-cyan-400">
                  {t.predictionGap || "GAP"}:{" "}
                  {market_scan.edge_percent?.toFixed(1) || "0.0"}%
                </span>
              </div>
              {/* Visual Probability Bar */}
              <div className="relative h-4 w-full bg-zinc-900 rounded-sm border border-zinc-800 overflow-hidden">
                <div
                  className="absolute h-full bg-zinc-800 border-r border-zinc-700 transition-all duration-700"
                  style={{ width: `${(market_scan.market_price || 0) * 100}%` }}
                />
                <div
                  className="absolute h-full bg-violet-500/40 border-r border-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.5)] transition-all duration-1000"
                  style={{
                    width: `${(market_scan.model_probability || 0) * 100}%`,
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col rounded-md bg-zinc-900/40 px-3 py-2 border border-zinc-800">
                <span className="text-[9px] text-zinc-500 uppercase font-black">
                  {t.marketPriceLabel || "MIDPOINT"}
                </span>
                <span className="font-mono text-zinc-100 font-bold text-sm">
                  ${market_scan.market_price?.toFixed(2) || "--"}
                </span>
              </div>
              <div className="flex flex-col rounded-md bg-zinc-900/40 px-3 py-2 border border-zinc-800">
                <span className="text-[9px] text-violet-500 uppercase font-black">
                  {t.modelProbLabel || "MODEL PROB"}
                </span>
                <span className="font-mono text-violet-400 font-bold text-sm">
                  {((market_scan.model_probability || 0) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 className="h-3 w-3 text-cyan-400" />
            <span className="text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400">
              {t.multiModelDivergence || "MULTI-MODEL DIVERGENCE"}
            </span>
          </div>
          <div className="space-y-3">
            {modelEntries.map((m) => (
              <div key={m.label} className="group flex flex-col gap-1 px-1">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-zinc-500 group-hover:text-zinc-300 transition-colors uppercase">
                    {m.label}
                  </span>
                  <span className="text-[10px] font-mono font-bold text-white text-right">
                    {m.value.toFixed(1)}°
                  </span>
                </div>
                <div className="relative h-1 w-full bg-zinc-800/50 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      m.value > 25
                        ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"
                        : m.value > 15
                          ? "bg-amber-500"
                          : "bg-cyan-500 shadow-[0_0_8px_rgba(34,211,238,0.5)]"
                    }`}
                    style={{ width: `${(m.value / 40) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {ai_analysis && (
          <section className="pt-2">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="h-3 w-3 text-amber-500" />
              <span className="text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400">
                AI COGNITIVE ANALYSIS
              </span>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-2 opacity-20">
                <ShieldAlert className="w-8 h-8 text-amber-500" />
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-400 relative z-10 font-medium">
                {ai_analysis}
              </p>
            </div>
          </section>
        )}
      </div>

      {/* Execute Scan Footer */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-zinc-950/80 backdrop-blur-md border-t border-zinc-800/50">
        <button className="w-full rounded-lg bg-cyan-500 py-3 text-[11px] font-black uppercase tracking-widest text-black shadow-[0_0_20px_rgba(34,211,238,0.3)] transition-all hover:bg-cyan-400 hover:scale-[0.98] active:scale-95 disabled:opacity-50 disabled:pointer-events-none">
          EXECUTE MARKET RE-SCAN
        </button>
      </div>
    </div>
  );
}
