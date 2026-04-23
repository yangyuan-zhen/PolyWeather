"use client";

import Image from "next/image";
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

const LIQUIDITY_OPTIONS = [500, 1000, 5000, 10000];
const EDGE_OPTIONS = [1, 2, 3, 5, 8];

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
        <div className="scan-sidebar-brand-mark">
          <Image
            src="/favicon-32x32.png"
            alt=""
            width={24}
            height={24}
            priority
          />
        </div>
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

      <section className="scan-filter-section">
        <div className="scan-filter-heading">
          <span>{isEn ? "Filters" : "筛选条件"}</span>
          <Info size={14} />
        </div>

        <div className="scan-range-card">
          <div className="scan-filter-row-title">
            {isEn ? "Price Range" : "价格范围"}
          </div>
          <div className="scan-range-track-wrap">
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(value.min_price * 100)}
              onChange={(e) =>
                updateFilter(
                  "min_price",
                  Math.min(Number(e.target.value) / 100, value.max_price),
                )
              }
              className="scan-range-slider min"
            />
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(value.max_price * 100)}
              onChange={(e) =>
                updateFilter(
                  "max_price",
                  Math.max(Number(e.target.value) / 100, value.min_price),
                )
              }
              className="scan-range-slider max"
            />
          </div>
          <div className="scan-range-labels">
            <span>{value.min_price.toFixed(2)}</span>
            <span>{value.max_price.toFixed(2)}</span>
          </div>
        </div>

        <label className="scan-filter-row">
          <span className="scan-filter-row-label">
            {isEn ? "Min Liquidity" : "最小成交量"}
          </span>
          <select
            className="scan-select"
            value={value.min_liquidity}
            onChange={(e) => updateFilter("min_liquidity", Number(e.target.value))}
          >
            {LIQUIDITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                ${option.toLocaleString("en-US")}
              </option>
            ))}
          </select>
        </label>

        <label className="scan-filter-row">
          <span className="scan-filter-row-label">
            {isEn ? "Min Edge" : "最小边际优势"}
          </span>
          <select
            className="scan-select"
            value={value.min_edge_pct}
            onChange={(e) => updateFilter("min_edge_pct", Number(e.target.value))}
          >
            {EDGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}%
              </option>
            ))}
          </select>
        </label>

        <div className="scan-filter-row inline">
          <span className="scan-filter-row-label">
            {isEn ? "High Liquidity Only" : "只看高流动性"}
          </span>
          <button
            type="button"
            className={`scan-toggle ${value.high_liquidity_only ? "active" : ""}`}
            onClick={() => {
              const nextValue = !value.high_liquidity_only;
              onChange?.({
                ...value,
                high_liquidity_only: nextValue,
                min_liquidity: nextValue
                  ? Math.max(value.min_liquidity, 5000)
                  : value.min_liquidity,
              });
            }}
            aria-pressed={value.high_liquidity_only}
          >
            <span className="scan-toggle-knob" />
          </button>
        </div>

        <label className="scan-filter-row">
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
        </label>

        <label className="scan-filter-row">
          <span className="scan-filter-row-label">
            {isEn ? "Time Range" : "时间范围"}
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
        </label>
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
