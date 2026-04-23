"use client";

import React, { useState } from "react";
import {
  Crosshair,
  Clock,
  Zap,
  TrendingUp,
  SlidersHorizontal,
  Search,
} from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import styles from "./Dashboard.module.css";

interface FilterState {
  mode: "tradable" | "early" | "touch" | "trend";
  priceRange: [number, number];
  minEdge: number;
  highLiquidityOnly: boolean;
  marketType: "maxtemp" | "all";
  timeRange: "today" | "tomorrow" | "week";
}

const SCAN_MODES = [
  {
    key: "tradable" as const,
    icon: Crosshair,
    labelEn: "Tradable",
    labelZh: "可交易机会",
    descEn: "Markets with immediate trading value",
    descZh: "交易价值最高的市场",
  },
  {
    key: "early" as const,
    icon: Clock,
    labelEn: "Early",
    labelZh: "早期机会",
    descEn: "Long-horizon positions",
    descZh: "长周期布局",
  },
  {
    key: "touch" as const,
    icon: Zap,
    labelEn: "Touch Play",
    labelZh: "触达博弈",
    descEn: "Approaching settle threshold",
    descZh: "触达博弈最高的市场",
  },
  {
    key: "trend" as const,
    icon: TrendingUp,
    labelEn: "Trend",
    labelZh: "趋势确认",
    descEn: "Trend-confirmed opportunities",
    descZh: "趋势确认、顺势加仓",
  },
] as const;

export function ScanFilterPanel({
  onScan,
  isScanning,
}: {
  onScan?: (filters: FilterState) => void;
  isScanning?: boolean;
}) {
  const { locale } = useI18n();
  const isEn = locale === "en-US";

  const [filters, setFilters] = useState<FilterState>({
    mode: "tradable",
    priceRange: [0.05, 0.95],
    minEdge: 2,
    highLiquidityOnly: false,
    marketType: "maxtemp",
    timeRange: "today",
  });

  const updateFilter = <K extends keyof FilterState>(
    key: K,
    value: FilterState[K],
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <aside className="scan-filter-panel">
      {/* === Scan Mode Section === */}
      <div className="scan-filter-section">
        <div className="scan-filter-label">
          {isEn ? "Scan Mode" : "扫描模式"}
        </div>
        <div className="scan-mode-tabs">
          {SCAN_MODES.map((mode) => {
            const Icon = mode.icon;
            const isActive = filters.mode === mode.key;
            return (
              <button
                key={mode.key}
                className={`scan-mode-tab ${isActive ? "active" : ""}`}
                onClick={() => updateFilter("mode", mode.key)}
                title={isEn ? mode.descEn : mode.descZh}
              >
                <Icon size={16} />
                <span className="scan-mode-tab-label">
                  {isEn ? mode.labelEn : mode.labelZh}
                </span>
                {isActive && <span className="scan-mode-tab-indicator" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* === Filter Controls === */}
      <div className="scan-filter-section">
        <div className="scan-filter-label">
          <SlidersHorizontal size={14} />
          {isEn ? "Filter Criteria" : "筛选条件"}
        </div>

        {/* Price Range */}
        <div className="scan-filter-row">
          <span className="scan-filter-row-label">
            {isEn ? "Price Range" : "价格范围"}
          </span>
          <div className="scan-range-display">
            <span>{filters.priceRange[0].toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={filters.priceRange[0] * 100}
              onChange={(e) =>
                updateFilter("priceRange", [
                  Number(e.target.value) / 100,
                  filters.priceRange[1],
                ])
              }
              className="scan-range-slider"
            />
            <input
              type="range"
              min={0}
              max={100}
              value={filters.priceRange[1] * 100}
              onChange={(e) =>
                updateFilter("priceRange", [
                  filters.priceRange[0],
                  Number(e.target.value) / 100,
                ])
              }
              className="scan-range-slider"
            />
            <span>{filters.priceRange[1].toFixed(2)}</span>
          </div>
        </div>

        {/* Min Edge */}
        <div className="scan-filter-row">
          <span className="scan-filter-row-label">
            {isEn ? "Min Edge" : "最小边际优势"}
          </span>
          <div className="scan-range-display">
            <span>{filters.minEdge}%</span>
            <input
              type="range"
              min={0}
              max={20}
              value={filters.minEdge}
              onChange={(e) => updateFilter("minEdge", Number(e.target.value))}
              className="scan-range-slider"
            />
          </div>
        </div>

        {/* High Liquidity Only */}
        <div className="scan-filter-row">
          <span className="scan-filter-row-label">
            {isEn ? "High Liquidity Only" : "只看高流动性"}
          </span>
          <button
            className={`scan-toggle ${filters.highLiquidityOnly ? "active" : ""}`}
            onClick={() =>
              updateFilter("highLiquidityOnly", !filters.highLiquidityOnly)
            }
          >
            <span className="scan-toggle-knob" />
          </button>
        </div>

        {/* Market Type */}
        <div className="scan-filter-row">
          <span className="scan-filter-row-label">
            {isEn ? "Market Type" : "市场类型"}
          </span>
          <select
            className="scan-select"
            value={filters.marketType}
            onChange={(e) =>
              updateFilter(
                "marketType",
                e.target.value as FilterState["marketType"],
              )
            }
          >
            <option value="maxtemp">
              {isEn ? "Max Temperature" : "最高温度"}
            </option>
            <option value="all">{isEn ? "All Markets" : "所有市场"}</option>
          </select>
        </div>

        {/* Time Range */}
        <div className="scan-filter-row">
          <span className="scan-filter-row-label">
            {isEn ? "Time Range" : "时间周期"}
          </span>
          <select
            className="scan-select"
            value={filters.timeRange}
            onChange={(e) =>
              updateFilter(
                "timeRange",
                e.target.value as FilterState["timeRange"],
              )
            }
          >
            <option value="today">{isEn ? "Today" : "今天"}</option>
            <option value="tomorrow">{isEn ? "Tomorrow" : "明天"}</option>
            <option value="week">{isEn ? "This Week" : "本周"}</option>
          </select>
        </div>
      </div>

      {/* === CTA === */}
      <button
        className="scan-cta-button"
        onClick={() => onScan?.(filters)}
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
