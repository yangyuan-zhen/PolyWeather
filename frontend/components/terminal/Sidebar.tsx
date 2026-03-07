import React from "react";
import { Search, Globe, ChevronRight, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CityInfo } from "@/lib/types";
import { Sparkline } from "./Sparkline";

interface CitySidebarProps {
  cities: CityInfo[];
  activeCity: string;
  onSelectCity: (name: string) => void;
  t: any;
}

export function CitySidebar({
  cities,
  activeCity,
  onSelectCity,
  t,
}: CitySidebarProps) {
  return (
    <aside className="flex h-full w-[300px] flex-col border-r border-terminal-border bg-terminal/95 transition-all">
      {/* Search Header */}
      <div className="p-4 border-b border-terminal-border">
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-neon-cyan" />
          <input
            type="text"
            placeholder={t.lookupPlaceholder || "Search Terminal..."}
            className="w-full rounded-lg border border-terminal-border bg-slate-900/50 py-2 pl-9 pr-4 text-xs text-white placeholder:text-slate-600 focus:border-neon-cyan/50 focus:outline-none focus:ring-1 focus:ring-neon-cyan/20"
          />
        </div>
      </div>

      {/* Monitor List */}
      <div className="flex-1 overflow-y-auto px-2 py-4 custom-scrollbar">
        <div className="mb-4 flex items-center justify-between px-3">
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
            {t.cityMonitor || "MONITORING NODES"}
          </h3>
          <Badge
            variant="outline"
            className="h-5 rounded-md border-terminal-border text-[10px] text-slate-400"
          >
            {cities.length}
          </Badge>
        </div>

        <div className="space-y-1">
          {cities.map((city) => {
            const isActive =
              activeCity.toLowerCase() === city.name.toLowerCase();
            return (
              <button
                key={city.name}
                onClick={() => onSelectCity(city.name)}
                className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-all ${
                  isActive
                    ? "bg-neon-cyan/10 ring-1 ring-neon-cyan/30"
                    : "hover:bg-slate-900/50"
                }`}
              >
                {/* Active Indicator Bar */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 h-4 w-1 -translate-y-1/2 rounded-r bg-neon-cyan shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                )}

                <div className="flex flex-1 flex-col items-start overflow-hidden">
                  <div className="flex w-full items-center justify-between">
                    <span
                      className={`truncate text-[11px] font-bold uppercase tracking-wider ${isActive ? "text-neon-cyan" : "text-slate-200"}`}
                    >
                      {city.display_name}
                    </span>
                    <span className="text-[10px] font-medium text-slate-500">
                      {city.icao}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div
                      className={`h-1.5 w-1.5 rounded-full ${
                        city.risk_level === "high"
                          ? "bg-rose-500 shadow-[0_0_4px_rgba(244,63,94,0.6)]"
                          : city.risk_level === "medium"
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                      }`}
                    />
                    <span className="truncate text-[10px] text-slate-500 font-medium">
                      {city.airport.replace("Airport", "Intl")}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 px-1">
                  <Sparkline
                    data={[10, 12, 11, 13, 12]}
                    width={40}
                    height={15}
                    strokeWidth={1.5}
                    color="#475569"
                  />
                </div>

                <div className="flex flex-col items-end gap-1">
                  <ChevronRight
                    className={`h-3 w-3 transition-transform ${isActive ? "translate-x-0.5 text-neon-cyan" : "text-slate-700 opacity-0 group-hover:opacity-100"}`}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Terminal Status */}
      <div className="border-t border-terminal-border bg-slate-950 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            UPLINK STATUS
          </span>
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.8)]" />
            <span className="text-[10px] font-bold text-emerald-500">LIVE</span>
          </div>
        </div>
        <div className="rounded-md border border-terminal-border bg-slate-900/50 p-2">
          <div className="flex items-center gap-2 text-[9px] font-mono text-slate-400">
            <Activity className="h-3 w-3 text-neon-cyan" />
            <span>LATENCY: 12ms</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
