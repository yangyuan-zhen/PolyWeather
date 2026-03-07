"use client";

import React, { useState } from "react";
import { CitySidebar } from "./Sidebar";
import { AnalyticsPanel } from "./AnalyticsPanel";
import {
  RefreshCw,
  LayoutGrid,
  Maximize2,
  Layers,
  Languages,
  Sun,
  Moon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface TerminalDashboardProps {
  cities: any[];
  activeCity: string;
  onSelectCity: (name: string) => void;
  cityData: any;
  marketData: any;
  officialData: any;
  isLoading: boolean;
  refresh: () => void;
  lang: any;
  setLang: (lang: any) => void;
  theme: string;
  toggleTheme: () => void;
  t: any;
  children: React.ReactNode; // For the Map
}

function NavLink({
  href,
  label,
  active = false,
}: {
  href: string;
  label: string;
  active?: boolean;
}) {
  return (
    <a
      href={href}
      className={`text-[10px] font-black uppercase tracking-widest transition-colors ${
        active
          ? "text-neon-cyan shadow-[0_0_10px_rgba(34,211,238,0.3)]"
          : "text-slate-500 hover:text-white"
      }`}
    >
      {label}
    </a>
  );
}

export function TerminalDashboard({
  cities,
  activeCity,
  onSelectCity,
  cityData,
  marketData,
  officialData,
  isLoading,
  refresh,
  lang,
  setLang,
  theme,
  toggleTheme,
  t,
  children,
}: TerminalDashboardProps) {
  const currentTemp = cityData?.current?.temp ?? null;
  const debPrediction = cityData?.deb?.prediction ?? null;
  const marketPrice = marketData?.markets?.[0]?.price ?? 0.62; // Placeholder

  const modelEntries = Object.entries(cityData?.multi_model ?? {})
    .map(([label, value]) => ({ label, value: value as number }))
    .filter((e) => typeof e.value === "number");

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-terminal font-sans text-slate-200 antialiased">
      {/* Top Global Ticker / Nav */}
      <div className="flex h-14 items-center justify-between border-b border-terminal-border bg-slate-950/50 px-6 backdrop-blur-md">
        <div className="flex items-center gap-6">
          <NavLink href="#" label={t.marketScan} active />
          <NavLink href="#" label="FORENSICS" />
          <NavLink href="#" label="ARBITRAGE" />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 border border-terminal-border">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
              {t.node || "Node"}:
            </span>
            <span className="text-[10px] font-mono font-bold text-neon-cyan tracking-widest">
              CLOUD-ALPHA-01
            </span>
          </div>

          <button
            onClick={refresh}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] font-bold text-slate-400 hover:bg-white/5 hover:text-white transition-all border border-transparent hover:border-terminal-border"
          >
            <RefreshCw
              className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`}
            />
            <span className="uppercase tracking-widest">{t.refresh}</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center border-r border-white/10 pr-3 mr-1 gap-1">
            <button
              onClick={() => setLang(lang === "en" ? "zh" : "en")}
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-neon-cyan transition-all"
              title={lang === "en" ? "Switch to Chinese" : "切换为英文"}
            >
              <Languages className="h-4 w-4" />
            </button>
            <button
              onClick={toggleTheme}
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-neon-cyan transition-all"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
          </div>

          <Badge
            variant="outline"
            className="h-6 border-terminal-border bg-slate-900/50 text-[10px] font-mono text-slate-400"
          >
            NODE: CLOUD-ALPHA-01
          </Badge>
          <button
            onClick={refresh}
            className="flex h-8 items-center gap-2 rounded-md border border-terminal-border bg-slate-900/50 px-3 transition-all hover:bg-slate-800"
          >
            <RefreshCw
              className={`h-3 w-3 text-slate-400 ${isLoading ? "animate-spin" : ""}`}
            />
            <span className="text-[10px] font-bold text-slate-300">
              REFRESH
            </span>
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Component List */}
        <CitySidebar
          cities={cities}
          activeCity={activeCity}
          onSelectCity={onSelectCity}
          t={t}
        />

        {/* Center: Interactive Map Area */}
        <div className="relative flex-1 bg-slate-950 overflow-hidden flex flex-col">
          {/* Map UI Overlay */}
          <div className="absolute left-4 top-4 z-10 flex flex-col gap-2">
            <div className="rounded-lg border border-terminal-border bg-terminal/80 p-2 backdrop-blur-md shadow-2xl">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-bold text-slate-500 uppercase">
                  Current Focus
                </span>
                <span className="text-xs font-black text-white uppercase tracking-widest">
                  {activeCity}
                </span>
              </div>
            </div>
          </div>

          <div className="absolute right-4 top-4 z-10 flex flex-col gap-2">
            <button className="rounded-md border border-terminal-border bg-terminal/80 p-2 text-slate-400 hover:text-white backdrop-blur-md">
              <Layers className="h-4 w-4" />
            </button>
            <button className="rounded-md border border-terminal-border bg-terminal/80 p-2 text-slate-400 hover:text-white backdrop-blur-md">
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>

          {/* The Map */}
          <div className="flex-1 h-full min-h-0 relative bg-zinc-900/10">
            {children}
          </div>

          {/* Bottom Map Info Bar */}
          <div className="absolute bottom-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
            <div className="rounded-md border border-terminal-border bg-terminal/80 px-3 py-1.5 backdrop-blur-md pointer-events-auto">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                Projection: Mercator · Layer: Dynamic Thermal Ensemble
              </span>
            </div>
            <div className="flex gap-2 pointer-events-auto">
              <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                STABLE VIBE
              </Badge>
            </div>
          </div>
        </div>

        {/* Right: Intelligence Panel */}
        <AnalyticsPanel
          data={
            {
              city: activeCity,
              fetched_at: cityData?.updated_at || "",
              overview: {
                name: activeCity,
                display_name: cityData?.display_name || activeCity,
                icao: officialData?.aviation_weather?.icao || "",
                airport: cityData?.risk?.airport || "",
                lat: cityData?.lat || 0,
                lon: cityData?.lon || 0,
                local_time: cityData?.local_time || "",
                local_date: cityData?.local_date || "",
                temp_symbol: cityData?.temp_symbol || "°C",
                current_temp: currentTemp,
                deb_prediction: debPrediction,
                risk_level: cityData?.risk?.level || "low",
                risk_warning: cityData?.risk?.warning || "",
                updated_at: cityData?.updated_at || "",
              },
              official: {
                available: !!officialData?.aviation_weather?.available,
                metar: officialData?.aviation_weather?.observation,
                weather_gov: officialData?.weather_gov || {},
                mgm: cityData?.mgm || {},
                mgm_nearby: [],
              },
              timeseries: {
                metar_recent_obs: [],
                metar_today_obs: [],
                hourly: {},
                mgm_hourly: [],
                forecast_daily: cityData?.forecast?.multi_day || [],
              },
              models: cityData?.multi_model || {},
              probabilities: cityData?.probabilities || {
                mu: null,
                distribution: [],
              },
              market_scan: {
                available: !!marketData?.markets?.length,
                reason: null,
                primary_market: marketData?.markets?.[0] || null,
                selected_date: marketData?.target_date || null,
                selected_condition_id: null,
                selected_slug: null,
                temperature_bucket: null,
                model_probability: null,
                market_price: marketPrice,
                edge_percent: null,
                signal_label: "MONITOR",
                confidence: "low",
                yes_token: null,
                no_token: null,
                yes_buy: null,
                yes_sell: null,
                no_buy: null,
                no_sell: null,
                last_trade_price: null,
                liquidity: null,
                volume: null,
                sparkline: [],
                recent_trades: [],
                websocket: marketData?.websocket || {},
              },
              risk: cityData?.risk,
              ai_analysis: cityData?.ai_analysis || "",
              errors: {},
            } as any
          }
          t={t}
        />
      </div>

      {/* Footer Ticker */}
      <footer className="h-8 border-t border-terminal-border bg-terminal-bg flex items-center px-4">
        <div className="flex items-center gap-3 overflow-hidden">
          <span className="text-[10px] font-bold text-neon-cyan uppercase flex-shrink-0">
            TICKER:
          </span>
          <div className="flex items-center gap-6 animate-marquee whitespace-nowrap">
            {cities.slice(0, 10).map((c) => (
              <div key={c.name} className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-300">
                  {c.display_name}
                </span>
                <span className="text-[10px] font-mono text-emerald-500">
                  24.5°
                </span>
                <span className="text-[9px] text-slate-600">LTAC</span>
              </div>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
