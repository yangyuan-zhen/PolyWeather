"use client";

import { ChevronDown, RefreshCw, X } from "lucide-react";
import type { MouseEvent } from "react";
import {
  CityStatusTags,
  type CityStatusTag,
  type StatusTone,
} from "@/components/dashboard/scan-terminal/CityStatusTags";
import {
  DataFreshnessBar,
  type DataFreshnessRow,
} from "@/components/dashboard/scan-terminal/DataFreshnessBar";

export function CityCardHeader({
  aiStatusLabel,
  aiStatusTone,
  collapseId,
  collapsed,
  currentTempText,
  dataFreshnessRows,
  debText,
  detailLocalTime,
  displayName,
  expectedHighText,
  freshnessSeparator,
  isEn,
  isRefreshing,
  modelRange,
  onRefresh,
  onRemove,
  onToggleCollapsed,
  peakWindow,
  removing,
  rowLocalTime,
  statusTags,
}: {
  aiStatusLabel: string;
  aiStatusTone: StatusTone;
  collapseId: string;
  collapsed: boolean;
  currentTempText: string;
  dataFreshnessRows: DataFreshnessRow[];
  debText: string;
  detailLocalTime?: string | null;
  displayName: string;
  expectedHighText: string;
  freshnessSeparator: string;
  isEn: boolean;
  isRefreshing: boolean;
  modelRange: string;
  onRefresh: (event: MouseEvent<HTMLButtonElement>) => void;
  onRemove: (event: MouseEvent<HTMLButtonElement>) => void;
  onToggleCollapsed: () => void;
  peakWindow: string;
  removing?: boolean;
  rowLocalTime?: string | null;
  statusTags: CityStatusTag[];
}) {
  return (
    <header className="scan-ai-city-hero">
      <div>
        <span className="scan-ai-city-kicker">
          {isEn ? "Deep analysis" : "城市深度分析"}
        </span>
        <h3>{displayName}</h3>
        <div className="scan-ai-city-mobile-priority" aria-label={isEn ? "Key city decision metrics" : "城市决策重点"}>
          <span>
            <small>{isEn ? "Observed" : "当前温度"}</small>
            <b>{currentTempText}</b>
          </span>
          <span>
            <small>{isEn ? "Expected high" : "预测高点"}</small>
            <b>{expectedHighText}</b>
          </span>
          <span>
            <small>{isEn ? "Peak" : "峰值时间"}</small>
            <b>{peakWindow}</b>
          </span>
        </div>
        <CityStatusTags tags={statusTags} />
        <div className="scan-ai-city-pills">
          <span>{detailLocalTime || rowLocalTime || "--"}</span>
          <span>DEB {debText}</span>
          <span>{isEn ? "Model" : "模型"} {modelRange}</span>
          <span>{isEn ? "Peak" : "峰值"} {peakWindow}</span>
        </div>
        <DataFreshnessBar
          aiStatusLabel={aiStatusLabel}
          aiStatusTone={aiStatusTone}
          freshnessSeparator={freshnessSeparator}
          isEn={isEn}
          rows={dataFreshnessRows}
        />
      </div>
      <div className="scan-ai-city-hero-side">
        <span>{isEn ? "Expected high" : "预计最高温"}</span>
        <strong>{expectedHighText}</strong>
        <div className="scan-ai-city-actions">
          <button
            type="button"
            className="scan-ai-city-icon-button"
            onClick={onRefresh}
            aria-label={isEn ? `Refresh ${displayName} analysis` : `刷新 ${displayName} 深度分析`}
            title={
              isEn
                ? "Refresh city data, chart and AI analysis"
                : "刷新城市数据、温度走势图和 AI 分析"
            }
            disabled={isRefreshing}
          >
            <RefreshCw size={15} className={isRefreshing ? "spin" : undefined} />
          </button>
          <button
            type="button"
            className="scan-ai-city-icon-button danger"
            onClick={onRemove}
            aria-label={isEn ? `Remove ${displayName}` : `移除 ${displayName}`}
            title={isEn ? "Remove city" : "移除城市"}
            disabled={removing}
          >
            <X size={15} />
          </button>
          <button
            type="button"
            className="scan-ai-city-collapse"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls={collapseId}
          >
            <ChevronDown size={15} />
            {collapsed ? (isEn ? "Expand" : "展开") : (isEn ? "Collapse" : "收起")}
          </button>
        </div>
      </div>
    </header>
  );
}
