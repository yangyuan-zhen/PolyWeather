"use client";

import React from "react";
import {
  Crosshair,
  Clock,
  Zap,
  TrendingUp,
  SlidersHorizontal,
  Search,
} from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { ScanTerminalFilters } from "@/lib/dashboard-types";

export interface FilterState extends ScanTerminalFilters {}

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
      {/* === Scan Mode Section === */}
      <div className="scan-filter-section">
        <div className="scan-filter-label">
          {isEn ? "Scan Mode" : "扫描模式"}
        </div>
        <div className="scan-mode-tabs">
          {SCAN_MODES.map((mode) => {
            const Icon = mode.icon;
            const isActive = value.scan_mode === mode.key;
            return (
              <button
                key={mode.key}
                className={`scan-mode-tab ${isActive ? "active" : ""}`}
                onClick={() => updateFilter("scan_mode", mode.key)}
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
            <span>{value.min_price.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={value.min_price * 100}
              onChange={(e) =>
                updateFilter(
                  "min_price",
                  Math.min(Number(e.target.value) / 100, value.max_price),
                )
              }
              className="scan-range-slider"
            />
            <input
              type="range"
              min={0}
              max={100}
              value={value.max_price * 100}
              onChange={(e) =>
                updateFilter(
                  "max_price",
                  Math.max(Number(e.target.value) / 100, value.min_price),
                )
              }
              className="scan-range-slider"
            />
            <span>{value.max_price.toFixed(2)}</span>
          </div>
        </div>

        {/* Min Edge */}
        <div className="scan-filter-row">
          <span className="scan-filter-row-label">
            {isEn ? "Min Edge" : "最小边际优势"}
          </span>
          <div className="scan-range-display">
            <span>{value.min_edge_pct}%</span>
            <input
              type="range"
              min={0}
              max={20}
              value={value.min_edge_pct}
              onChange={(e) =>
                updateFilter("min_edge_pct", Number(e.target.value))
              }
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
            className={`scan-toggle ${value.high_liquidity_only ? "active" : ""}`}
            onClick={() => {
              const nextValue = !value.high_liquidity_only;
              onChange?.({
                ...value,
                high_liquidity_only: nextValue,
                min_liquidity: nextValue
                  ? Math.max(value.min_liquidity, 5000)
                  : 500,
              });
            }}
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
            value={value.market_type}
            onChange={(e) =>
              updateFilter(
                "market_type",
                e.target.value as FilterState["market_type"],
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
            value={value.time_range}
            onChange={(e) =>
              updateFilter(
                "time_range",
                e.target.value as FilterState["time_range"],
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
