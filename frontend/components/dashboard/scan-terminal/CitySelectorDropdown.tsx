"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import { REGIONS, getCityRegion } from "./continent-grouping";
import { rowName, temp } from "./utils";

interface CitySelectorDropdownProps {
  isEn: boolean;
  rows: ScanOpportunityRow[];
  onSelectCity: (city: string) => void;
  onClose: () => void;
  className?: string;
}

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

  // Tab definitions
  const tabs = useMemo(() => {
    return [
      { key: "all", labelEn: "ALL", labelZh: "全部" },
      ...REGIONS.map((r) => ({
        key: r.key,
        labelEn: r.labelEn.replace("Asia", "").replace("America", "").trim() || r.labelEn,
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
      const haystack = [
        row.city,
        row.city_display_name,
        row.display_name,
        row.airport,
      ]
        .filter(Boolean)
        .map((s) => s!.toLowerCase());
      return haystack.some((s) => s.includes(q));
    });
  }, [rows, searchQuery, activeTab]);

  return (
    <div
      ref={containerRef}
      className={clsx(
        "flex flex-col bg-white border border-slate-200 rounded-md shadow-2xl overflow-hidden text-xs text-[#202833] animate-in fade-in-50 zoom-in-95 duration-100",
        className
      )}
      onClick={(e) => e.stopPropagation()} // Prevent card activation
    >
      {/* Search Input Area */}
      <div className="flex items-center gap-2 p-2 border-b border-slate-100 bg-[#f8fafc]">
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={isEn ? "Search city or airport..." : "搜索城市、机场..."}
          className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
        />
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 px-1 font-mono"
        >
          ✕
        </button>
      </div>

      {/* Region filter tabs */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-slate-100 bg-slate-50/50 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                "px-2 py-0.5 text-[10px] font-bold rounded whitespace-nowrap transition-all",
                isActive
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
              )}
            >
              {isEn ? tab.labelEn : tab.labelZh}
            </button>
          );
        })}
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto max-h-[220px] divide-y divide-slate-50">
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

            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onSelectCity(String(row.city || "").toLowerCase())}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-blue-50/50 transition-colors group"
              >
                <div className="min-w-0 flex-1 pr-3">
                  <div className="font-bold text-slate-800 group-hover:text-blue-600 truncate">
                    {cityName}
                  </div>
                  {row.airport && (
                    <div className="text-[10px] text-slate-400 font-mono truncate">
                      {row.airport}
                    </div>
                  )}
                </div>

                {/* Weather info */}
                <div className="flex items-center gap-3 font-mono text-[11px] shrink-0 text-slate-500">
                  {obsTemp !== undefined && obsTemp !== null && (
                    <div className="flex flex-col items-end">
                      <span className="text-[8px] text-slate-400 font-sans scale-90 uppercase">Obs</span>
                      <strong className="text-slate-700 font-bold">
                        {obsTemp}
                        <span className="text-[9px] font-normal font-sans">{symbol}</span>
                      </strong>
                    </div>
                  )}
                  {debPrediction !== undefined && debPrediction !== null && (
                    <div className="flex flex-col items-end">
                      <span className="text-[8px] text-slate-400 font-sans scale-90 uppercase">DEB</span>
                      <strong className="text-orange-600 font-bold">
                        {debPrediction}
                        <span className="text-[9px] font-normal font-sans">{symbol}</span>
                      </strong>
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
