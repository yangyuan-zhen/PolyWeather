"use client";

import React, { useMemo } from "react";
import Image from "next/image";
import { Star } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import type {
  CityDetail,
  CityListItem,
  CitySummary,
} from "@/lib/dashboard-types";
import { getLocalizedCityDisplay } from "@/lib/dashboard-home-copy";

interface OpportunityRow {
  rank: number;
  city: CityListItem;
  summary?: CitySummary | null;
  detail?: CityDetail | null;
  score: number;
  tradable: boolean;
}

function getTodayHighLabel(detail?: CityDetail | null, symbol = "°C"): string {
  const current = detail?.current;
  if (current?.temp != null) return `${current.temp.toFixed(1)}${symbol}`;
  return "--";
}

function getTimeLabel(detail?: CityDetail | null): string {
  if (!detail?.local_time) return "--";
  return detail.local_time;
}

function getTimezone(detail?: CityDetail | null): string {
  if (detail?.utc_offset_seconds != null) {
    const hours = Math.round(detail.utc_offset_seconds / 3600);
    return `UTC${hours >= 0 ? "+" : ""}${hours}`;
  }
  return "";
}

function getMarketVolume(detail?: CityDetail | null): string {
  const vol =
    detail?.market_scan?.volume ?? detail?.market_scan?.primary_market?.volume;
  if (vol == null) return "--";
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${Math.round(vol / 1_000)}K`;
  return `$${vol.toFixed(0)}`;
}

function getScanStatus(
  detail?: CityDetail | null,
  locale = "zh-CN",
): { label: string; tone: string } {
  const scan = detail?.market_scan;
  if (!scan?.available)
    return {
      label: locale === "en-US" ? "No Market" : "无盘口",
      tone: "neutral",
    };
  const pa = scan?.price_analysis;
  const bestSide = pa?.best_side;
  const sideView = bestSide === "no" ? pa?.no : pa?.yes;
  const edgeVal =
    sideView?.edge != null
      ? Math.abs(Number(sideView.edge)) > 1
        ? Number(sideView.edge) / 100
        : Number(sideView.edge)
      : null;
  if (edgeVal != null && edgeVal >= 0.05)
    return {
      label: locale === "en-US" ? "Touch Play" : "触达博弈",
      tone: "amber",
    };
  if (edgeVal != null && edgeVal >= 0.02)
    return {
      label: locale === "en-US" ? "Tradable" : "即时确认",
      tone: "green",
    };
  if (edgeVal != null && edgeVal > 0)
    return { label: locale === "en-US" ? "Early" : "早期机会", tone: "purple" };
  return { label: locale === "en-US" ? "Market" : "市场", tone: "neutral" };
}

function getBestAction(detail?: CityDetail | null, locale = "zh-CN"): string {
  const scan = detail?.market_scan;
  if (!scan?.available) return "--";
  const pa = scan?.price_analysis;
  const side = pa?.best_side;
  const topBucket = scan?.top_buckets?.[0];
  const label = topBucket?.label || topBucket?.slug || "";
  if (side === "yes" && label)
    return `${locale === "en-US" ? "Buy" : "买入"} Yes ${label}`;
  if (side === "no" && label)
    return `${locale === "en-US" ? "Buy" : "买入"} No ${label}`;
  return "--";
}

function getEdge(detail?: CityDetail | null): number | null {
  const pa = detail?.market_scan?.price_analysis;
  const bestSide = pa?.best_side;
  const sideView = bestSide === "no" ? pa?.no : pa?.yes;
  const edge = sideView?.edge;
  if (edge == null) return null;
  const val = Number(edge);
  return Math.abs(val) > 1 ? val / 100 : val;
}

function getProbabilityBuckets(
  detail?: CityDetail | null,
): Array<{ label: string; probability: number }> {
  const view = detail?.probabilities?.distribution || [];
  if (!Array.isArray(view)) return [];
  return view.slice(0, 8).map((b) => ({
    label: String(b.label || b.value || ""),
    probability: Number(b.probability || 0),
  }));
}

function MiniProbabilityChart({
  buckets,
}: {
  buckets: Array<{ label: string; probability: number }>;
}) {
  if (!buckets.length) return <span className="scan-no-data">--</span>;
  const maxProb = Math.max(...buckets.map((b) => b.probability), 0.01);
  return (
    <div className="scan-mini-chart">
      {buckets.map((bucket, i) => (
        <div key={i} className="scan-mini-bar-col">
          <div
            className="scan-mini-bar"
            style={{
              height: `${Math.max((bucket.probability / maxProb) * 100, 4)}%`,
            }}
            title={`${bucket.label}: ${(bucket.probability * 100).toFixed(1)}%`}
          />
          <span className="scan-mini-bar-label">
            {bucket.label.replace(/[°CF]/g, "")}
          </span>
        </div>
      ))}
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color = score >= 80 ? "#00E0A4" : score >= 60 ? "#FFB020" : "#FF4D6A";

  return (
    <div className="scan-score-ring">
      <svg viewBox="0 0 48 48" width={48} height={48}>
        <circle
          cx={24}
          cy={24}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={3}
        />
        <circle
          cx={24}
          cy={24}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeDasharray={`${progress} ${circumference - progress}`}
          strokeLinecap="round"
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span className="scan-score-value" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

export function OpportunityTable({ rows }: { rows: OpportunityRow[] }) {
  const { locale } = useI18n();
  const store = useDashboardStore();
  const isEn = locale === "en-US";

  return (
    <div className="scan-table-container">
      {/* Header */}
      <div className="scan-table-header">
        <span className="scan-th scan-th-rank">#</span>
        <span className="scan-th scan-th-city">
          {isEn ? "City / Market" : "城市 / 市场"}
        </span>
        <span className="scan-th scan-th-time">
          {isEn ? "Local Time / Status" : "当前时间 / 阶段"}
        </span>
        <span className="scan-th scan-th-prob">
          {isEn ? "Prob. Dist. vs Market" : "模型分布 vs 市场分布"}
        </span>
        <span className="scan-th scan-th-action">
          {isEn ? "Best Action" : "最佳机会"}
        </span>
        <span className="scan-th scan-th-edge">
          {isEn ? "Edge" : "边际优势"}
        </span>
        <span className="scan-th scan-th-score">
          {isEn ? "Score" : "综合得分"}
        </span>
        <span className="scan-th scan-th-fav" />
      </div>

      {/* Rows */}
      {rows.map((row) => {
        const cityName = getLocalizedCityDisplay(
          row.city,
          locale,
          row.summary,
          row.detail,
        );
        const status = getScanStatus(row.detail, locale);
        const edge = getEdge(row.detail);
        const buckets = getProbabilityBuckets(row.detail);
        const isSelected = store.selectedCity === row.city.name;
        const symbol = row.detail?.temp_symbol || "°C";

        return (
          <div
            key={row.city.name}
            className={`scan-table-row ${isSelected ? "selected" : ""} ${row.tradable ? "tradable" : ""}`}
            onClick={() => store.focusCity(row.city.name)}
          >
            {/* Rank */}
            <span className={`scan-td scan-td-rank rank-${status.tone}`}>
              <span className="scan-rank-circle">{row.rank}</span>
            </span>

            {/* City */}
            <span className="scan-td scan-td-city">
              <span className="scan-city-thumb">
                <span className="scan-city-img-placeholder" />
              </span>
              <span className="scan-city-info">
                <span className="scan-city-name">{cityName}</span>
                <span className="scan-city-sub">
                  {isEn ? "Today's high" : "今日最高温"} ·{" "}
                  {getMarketVolume(row.detail)}
                </span>
              </span>
            </span>

            {/* Time + Status */}
            <span className="scan-td scan-td-time">
              <span className="scan-time-text">
                {getTimeLabel(row.detail)} ({getTimezone(row.detail)})
              </span>
              <span className={`scan-status-badge tone-${status.tone}`}>
                {status.label}
              </span>
            </span>

            {/* Probability Chart */}
            <span className="scan-td scan-td-prob">
              <MiniProbabilityChart buckets={buckets} />
            </span>

            {/* Best Action */}
            <span className="scan-td scan-td-action">
              <span className="scan-action-text">
                {getBestAction(row.detail, locale)}
              </span>
            </span>

            {/* Edge */}
            <span className="scan-td scan-td-edge">
              <span
                className={`scan-edge-value ${edge != null && edge > 0 ? "positive" : "neutral"}`}
              >
                {edge != null
                  ? `${edge > 0 ? "+" : ""}${(edge * 100).toFixed(1)}%`
                  : "--"}
              </span>
            </span>

            {/* Score */}
            <span className="scan-td scan-td-score">
              <ScoreRing score={row.score} />
            </span>

            {/* Favorite */}
            <span className="scan-td scan-td-fav">
              <Star size={16} className="scan-fav-icon" />
            </span>
          </div>
        );
      })}
    </div>
  );
}
