"use client";

import React from "react";
import {
  CircleDot,
  Clock3,
  Info,
  Search,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { ScanTerminalFilters } from "@/lib/dashboard-types";

export interface FilterState extends ScanTerminalFilters {}

const SCAN_MODES = [
  {
    key: "tradable" as const,
    icon: Zap,
    labelEn: "Tradable",
    labelZh: "可交易机会",
    descEn: "Find the best immediate trade",
    descZh: "发现当前最值得交易的市场",
  },
  {
    key: "early" as const,
    icon: Clock3,
    labelEn: "Early",
    labelZh: "早期机会",
    descEn: "Long-horizon, lower-priced setups",
    descZh: "长时间布局，低价市场",
  },
  {
    key: "touch" as const,
    icon: CircleDot,
    labelEn: "Touch Play",
    labelZh: "触达博弈",
    descEn: "Markets approaching the settle line",
    descZh: "接近决策，博弈是否触达",
  },
  {
    key: "trend" as const,
    icon: TrendingUp,
    labelEn: "Trend",
    labelZh: "趋势确认",
    descEn: "Trend-confirmed follow-through",
    descZh: "趋势明朗，顺势交易",
  },
] as const;

export function ScanFilterPanel({
  value,
  onChange,
  onScan,
  isScanning,
}: {
  value: FilterState;
  onChange?: (filters: FilterState) => void;
  onScan?: (filters: FilterState) => void;
  isScanning?: boolean;
}) {
  const { locale } = useI18n();
  const isEn = locale === "en-US";

  const updateFilter = <K extends keyof FilterState>(
    key: K,
    nextValue: FilterState[K],
  ) => {
    onChange?.({
      ...value,
      [key]: nextValue,
    });
  };

  return (
    <aside className="scan-filter-panel">
      <div className="scan-sidebar-brand">
        <div>
          <div className="scan-sidebar-brand-name">PolyWeather</div>
        </div>
      </div>

      <section className="scan-filter-section">
        <div className="scan-filter-heading">
          <span>{isEn ? "Scan Mode" : "扫描模式"}</span>
          <Info size={14} />
        </div>
        <div className="scan-mode-tabs">
          {SCAN_MODES.map((mode) => {
            const Icon = mode.icon;
            const isActive = value.scan_mode === mode.key;
            return (
              <button
                key={mode.key}
                type="button"
                className={`scan-mode-tab ${isActive ? "active" : ""}`}
                onClick={() => updateFilter("scan_mode", mode.key)}
              >
                <span className="scan-mode-icon">
                  <Icon size={16} />
                </span>
                <span className="scan-mode-copy">
                  <span className="scan-mode-tab-label">
                    {isEn ? mode.labelEn : mode.labelZh}
                  </span>
                  <span className="scan-mode-tab-sub">
                    {isEn ? mode.descEn : mode.descZh}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <button
        type="button"
        className="scan-cta-button"
        onClick={() => onScan?.(value)}
        disabled={isScanning}
      >
        <Search size={16} />
        {isScanning
          ? isEn
            ? "Scanning..."
            : "扫描中..."
          : isEn
            ? "Start Scan"
            : "开始扫描"}
      </button>
    </aside>
  );
}
