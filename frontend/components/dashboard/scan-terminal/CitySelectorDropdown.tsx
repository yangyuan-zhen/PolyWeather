"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { REGIONS, getCityRegion } from "./continent-grouping";
import { rowName } from "./utils";

interface CitySelectorDropdownProps {
  isEn: boolean;
  rows: ScanOpportunityRow[];
  onSelectCity: (city: string) => void;
  onClose: () => void;
  className?: string;
}

// Map each city to its airport code (IATA) to match the financial symbol style of Koyfin
const CITY_IATA_MAP: Record<string, string> = {
  beijing: "PEK",
  shanghai: "SHA",
  shenzhen: "SZX",
  guangzhou: "CAN",
  chengdu: "CTU",
  chongqing: "CKG",
  wuhan: "WUH",
  taipei: "TPE",
  "hong kong": "HKG",
  tokyo: "HND",
  seoul: "ICN",
  singapore: "SIN",
  "kuala lumpur": "KUL",
  manila: "MNL",
  jakarta: "CGK",
  karachi: "KHI",
  lucknow: "LKO",
  london: "LHR",
  paris: "CDG",
  munich: "MUC",
  milan: "MXP",
  madrid: "MAD",
  amsterdam: "AMS",
  warsaw: "WAW",
  helsinki: "HEL",
  "cape town": "CPT",
  jeddah: "JED",
  toronto: "YYZ",
  "new york": "LGA",
  "los angeles": "LAX",
  "san francisco": "SFO",
  denver: "DEN",
  austin: "AUS",
  houston: "HOU",
  dallas: "DAL",
  miami: "MIA",
  atlanta: "ATL",
  seattle: "SEA",
  "mexico city": "MEX",
  "panama city": "PAC",
  "buenos aires": "EZE",
  "sao paulo": "GRU",
  wellington: "WLG",
};

// Map each city to its ICAO code to prevent referencing non-existent field row.icao in TypeScript
const CITY_ICAO_MAP: Record<string, string> = {
  beijing: "ZBAA",
  shanghai: "ZSPD",
  shenzhen: "LFS",
  guangzhou: "ZGGG",
  chengdu: "ZUUU",
  chongqing: "ZUCK",
  wuhan: "ZHHH",
  taipei: "RCSS",
  "hong kong": "VHHH",
  tokyo: "RJTT",
  seoul: "RKSI",
  singapore: "WSSS",
  "kuala lumpur": "WMKK",
  manila: "RPLL",
  jakarta: "WIHH",
  karachi: "OPKC",
  lucknow: "VILK",
  london: "EGLC",
  paris: "LFPB",
  munich: "EDDM",
  milan: "LIMC",
  madrid: "LEMD",
  amsterdam: "EHAM",
  warsaw: "EPWA",
  helsinki: "EFHK",
  "cape town": "FACT",
  jeddah: "OEJN",
  toronto: "CYYZ",
  "new york": "KLGA",
  "los angeles": "KLAX",
  "san francisco": "KSFO",
  denver: "KBKF",
  austin: "KAUS",
  houston: "KHOU",
  dallas: "KDAL",
  miami: "KMIA",
  atlanta: "KATL",
  seattle: "KSEA",
  "mexico city": "MMMX",
  "panama city": "MPMG",
  "buenos aires": "SAEZ",
  "sao paulo": "SBGR",
  wellington: "NZWN",
};

const getCityCode = (city: string): string => {
  const normalized = String(city || "").toLowerCase().trim();
  return CITY_IATA_MAP[normalized] || normalized.substring(0, 3).toUpperCase();
};

export function CitySelectorDropdown({
  isEn,
  rows,
  onSelectCity,
  onClose,
  className,
}: CitySelectorDropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<string>("all");

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle click outside and Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Tab definitions matching the Koyfin pill row style
  const tabs = useMemo(() => {
    return [
      { key: "all", labelEn: "ALL", labelZh: "全部" },
      ...REGIONS.map((r) => ({
        key: r.key,
        labelEn: r.labelEn.replace("Asia", "").replace("America", "").trim().toUpperCase() || r.labelEn,
        labelZh: r.labelZh,
      })),
    ];
  }, []);

  // Filter rows
  const filteredRows = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return rows.filter((row) => {
      // 1. Region filter
      if (activeTab !== "all") {
        const region = getCityRegion(row);
        if (region !== activeTab) return false;
      }

      // 2. Query filter
      if (!q) return true;
      const key = String(row.city || "").toLowerCase().trim();
      const code = getCityCode(row.city || "");
      const icao = CITY_ICAO_MAP[key] || "";
      const haystack = [
        row.city,
        row.city_display_name,
        row.display_name,
        row.airport,
        icao,
        code,
      ]
        .filter(Boolean)
        .map((s) => s!.toLowerCase());
      return haystack.some((s) => s.includes(q));
    });
  }, [rows, searchQuery, activeTab]);

  const getRegionLabel = (regionKey: string): string => {
    const match = REGIONS.find((r) => r.key === regionKey);
    if (!match) return regionKey;
    return isEn ? match.labelEn : match.labelZh;
  };

  return (
    <div
      ref={containerRef}
      className={clsx(
        "flex flex-col bg-white border border-slate-300 rounded shadow-2xl overflow-hidden text-xs text-[#202833] animate-in fade-in-50 zoom-in-95 duration-100",
        className
      )}
      onClick={(e) => e.stopPropagation()} // Prevent triggering slot clicks
    >
      {/* Search Input Area */}
      <div className="p-2 bg-white">
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search..."
          className="w-full px-2.5 py-1.5 border border-[#3b82f6] rounded bg-white text-xs outline-none ring-2 ring-blue-500/10 focus:border-blue-500"
        />
      </div>

      {/* Koyfin-style Category Pills Bar */}
      <div className="flex items-center gap-1 px-2.5 py-1 border-b border-slate-100 bg-[#f8fafc] overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                "px-2 py-0.5 text-[9px] font-bold rounded transition-all uppercase tracking-wider",
                isActive
                  ? "bg-[#0070f3] text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/50"
              )}
            >
              {isEn ? tab.labelEn : tab.labelZh}
            </button>
          );
        })}
      </div>

      {/* Results List */}
      <div className="flex-1 overflow-y-auto max-h-[380px] divide-y divide-slate-100">
        {filteredRows.length === 0 ? (
          <div className="p-4 text-center text-slate-400 font-medium">
            {isEn ? "No matching cities" : "无匹配城市"}
          </div>
        ) : (
          filteredRows.map((row) => {
            const cityName = rowName(row);
            const obsTemp = row.current_temp ?? row.current_max_so_far;
            const debPrediction = row.deb_prediction;
            const symbol = row.temp_symbol || "°C";
            const regionKey = getCityRegion(row) || "unknown";
            const regionLabel = getRegionLabel(regionKey);
            const cityKey = String(row.city || "").toLowerCase().trim();

            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onSelectCity(String(row.city || "").toLowerCase())}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-100 transition-colors group"
              >
                {/* Left Column: Symbol & Name */}
                <div className="min-w-0 flex-1 pr-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-900 text-[12px] tracking-tight group-hover:text-[#0070f3] transition-colors">
                      {getCityCode(row.city || "")}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono font-medium">
                      {CITY_ICAO_MAP[cityKey] || ""}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-medium truncate mt-0.5">
                    {cityName} · {row.airport || ""}
                  </div>
                </div>

                {/* Middle Column: Temps (Obs & DEB) */}
                <div className="flex items-center gap-2.5 font-mono text-[11px] shrink-0 px-2 text-slate-600">
                  {obsTemp !== undefined && obsTemp !== null && (
                    <span title={isEn ? "Observed" : "实测"}>
                      <span className="text-[9px] text-slate-400 font-sans mr-0.5 font-bold">O:</span>
                      <strong className="text-slate-800 font-bold">{obsTemp}{symbol}</strong>
                    </span>
                  )}
                  {debPrediction !== undefined && debPrediction !== null && (
                    <span title={isEn ? "DEB Prediction" : "DEB 预估"}>
                      <span className="text-[9px] text-slate-400 font-sans mr-0.5 font-bold">D:</span>
                      <strong className="text-orange-600 font-bold">{debPrediction}{symbol}</strong>
                    </span>
                  )}
                </div>

                {/* Right Column: Region (matches Equity/Asset Class style) */}
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider text-right min-w-[75px] shrink-0 font-sans">
                  {regionLabel}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
