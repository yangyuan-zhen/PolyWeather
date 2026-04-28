"use client";

import { BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import React from "react";
import { useI18n } from "@/hooks/useI18n";
import type {
  CityDetail,
  ScanOpportunityRow,
} from "@/lib/dashboard-types";
import {
  formatTemperatureValue,
  normalizeTemperatureSymbol,
} from "@/lib/temperature-utils";
import {
  buildOpportunityGroups,
  formatWindowMinutes,
  getAiMeta,
  getBucketDisplayLabel,
  getDebDistanceSummary,
  getDecisionReasonItems,
  getDetailForRow,
  getForecastRangeLabel,
  getForecastRiskItems,
  getMetarConflictSummary,
  getModelSupportSummary,
  getPaceSignalLabel,
  getThresholdDecision,
  getV4CityForecast,
} from "./OpportunityTable.utils";

export { getWindowPhaseMeta } from "./OpportunityTable.utils";

export const OpportunityTable = React.memo(function OpportunityTable({
  rows,
  status,
  stale,
  staleReason,
  loading,
  selectedRowId,
  onSelectRow,
  cityDetailsByName,
}: {
  rows: ScanOpportunityRow[];
  status?: string | null;
  stale?: boolean;
  staleReason?: string | null;
  loading?: boolean;
  selectedRowId?: string | null;
  onSelectRow?: (row: ScanOpportunityRow) => void;
  cityDetailsByName?: Record<string, CityDetail>;
}) {
  const { locale } = useI18n();
  const isEn = locale === "en-US";
  const hasRows = rows.length > 0;
  const scanInProgress =
    loading || status === "partial" || status === "scanning";
  const groups = React.useMemo(
    () => buildOpportunityGroups(rows, locale, cityDetailsByName),
    [rows, locale, cityDetailsByName],
  );
  const [expandedRowIds, setExpandedRowIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  const toggleExpandedRow = React.useCallback((rowId: string) => {
    setExpandedRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  const ensureExpandedRow = React.useCallback((rowId: string) => {
    setExpandedRowIds((current) => {
      if (current.has(rowId)) return current;
      const next = new Set(current);
      next.add(rowId);
      return next;
    });
  }, []);

  const selectAndOpenRow = React.useCallback(
    (row: ScanOpportunityRow) => {
      ensureExpandedRow(row.id);
      onSelectRow?.(row);
    },
    [ensureExpandedRow, onSelectRow],
  );

  const toggleRowAnalysis = React.useCallback(
    (row: ScanOpportunityRow) => {
      toggleExpandedRow(row.id);
      onSelectRow?.(row);
    },
    [onSelectRow, toggleExpandedRow],
  );

  if (!hasRows) {
    const title =
      scanInProgress
        ? isEn
          ? "Scanning markets"
          : "正在扫描市场"
        : status === "failed"
          ? isEn
            ? "Scan failed"
            : "扫描失败"
          : isEn
            ? "No tradable market right now"
            : "当前暂无可交易市场";
    const copy =
      scanInProgress
        ? isEn
          ? "Waiting for the latest market snapshot. Existing data will stay on screen when available."
          : "正在等待最新市场快照；如果有旧数据，会继续保留在页面上。"
        : status === "failed"
          ? staleReason || (isEn ? "No valid market snapshot is available." : "当前没有可用的市场快照。")
          : isEn
            ? "The current snapshot does not contain a tradable main signal."
            : "当前快照里还没有可交易的主信号。";
    return (
      <div className="scan-table-shell empty">
        <div className="scan-empty-state">
          <div className="scan-empty-title">{title}</div>
          <div className="scan-empty-copy">{copy}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="scan-table-shell">
      {stale ? (
        <div className="scan-table-banner">
          <strong>{isEn ? "Showing delayed snapshot" : "当前显示延迟快照"}</strong>
          <span>{staleReason || (isEn ? "Latest refresh failed, fallback to the last successful scan." : "最新刷新失败，已回退到上次成功扫描结果。")}</span>
        </div>
      ) : null}
      <div className="scan-table-body scan-opportunity-groups scan-forecast-desk">
        {groups.map((group) => {
          const groupSelected = group.rows.some((row) => row.id === selectedRowId);
          const firstRow = group.rows[0];
          const firstTempSymbol = normalizeTemperatureSymbol(
            firstRow?.target_unit || firstRow?.temp_symbol || group.tempSymbol,
          );
          const firstDetail = firstRow
            ? getDetailForRow(firstRow, cityDetailsByName)
            : null;
          const groupForecast = firstRow
            ? getV4CityForecast(firstRow, group, firstDetail, locale, firstTempSymbol)
            : null;
          const groupForecastLabel =
            groupForecast?.predicted != null
              ? formatTemperatureValue(groupForecast.predicted, firstTempSymbol, { digits: 1 })
              : "--";
          const groupRangeLabel = groupForecast
            ? getForecastRangeLabel(groupForecast, firstTempSymbol)
            : group.peakLabel;
          return (
          <section
            key={group.key}
            className={`scan-opportunity-group scan-forecast-city-card ${groupSelected ? "selected" : ""}`}
          >
            <button
              type="button"
              className="scan-opportunity-group-head scan-forecast-city-head"
              onClick={() => {
                const firstRow = group.rows[0];
                if (firstRow) selectAndOpenRow(firstRow);
              }}
            >
              <div className="scan-forecast-city-title">
                <span className="scan-forecast-kicker">
                  {isEn ? "City max-temp read" : "城市最高温判断"}
                </span>
                <strong>{group.cityName}</strong>
                <div className="scan-forecast-city-chips">
                  <span>{group.localTime || "--"}</span>
                  <span>{formatWindowMinutes(group.remainingMinutes, locale)}</span>
                  <span>DEB {group.debLabel}</span>
                  <span>{isEn ? "Models" : "模型"} {group.peakLabel}</span>
                </div>
              </div>
              <div className="scan-forecast-city-read">
                <small>{isEn ? "AI expected high" : "AI 预计最高温"}</small>
                <b>{groupForecastLabel}</b>
                <span>{isEn ? "Range" : "区间"} {groupRangeLabel}</span>
                <b className={`scan-phase-badge ${group.phaseMeta.tone}`}>
                  {group.phaseMeta.label}
                </b>
              </div>
            </button>

            <div className="scan-opportunity-items">
              {group.rows.map((row) => {
                const tempSymbol = normalizeTemperatureSymbol(row.target_unit || row.temp_symbol);
                const detail = getDetailForRow(row, cityDetailsByName);
                const debDistanceLabel = isEn ? "DEB distance" : "DEB 距离";
                const modelSupportLabel = isEn ? "Model support" : "模型支持";
                const metarLabel = "METAR";
                const paceLabel = isEn ? "Path vs DEB" : "路径偏差";
                const debDistanceText = getDebDistanceSummary(row, locale, tempSymbol);
                const modelSupportText = getModelSupportSummary(row, locale);
                const metarConflictText = getMetarConflictSummary(row, detail, locale);
                const cityForecast = getV4CityForecast(
                  row,
                  group,
                  detail,
                  locale,
                  tempSymbol,
                );
                const paceSignalText = getPaceSignalLabel(cityForecast, locale, tempSymbol);
                const aiMeta = getAiMeta(row, locale);
                const thresholdDecision = getThresholdDecision(
                  row,
                  cityForecast,
                  locale,
                  tempSymbol,
                );
                const expanded = expandedRowIds.has(row.id);
                const shortConclusion =
                  `${thresholdDecision.headline}。${thresholdDecision.summary}`;
                const keyReasons = getDecisionReasonItems(
                  row,
                  cityForecast,
                  modelSupportText,
                  locale,
                  tempSymbol,
                );
                const riskItems = getForecastRiskItems(
                  row,
                  detail,
                  cityForecast,
                  locale,
                  tempSymbol,
                );
                const bucketLabel = getBucketDisplayLabel(row, locale, tempSymbol);
                const forecastRangeLabel = getForecastRangeLabel(cityForecast, tempSymbol);
                return (
                  <div
                    key={row.id}
                    className={`scan-opportunity-item scan-forecast-row ${selectedRowId === row.id ? "selected" : ""} ${expanded ? "expanded" : ""} ai-fit-${thresholdDecision.tone} ${aiMeta ? `ai-${aiMeta.tone}` : ""}`}
                    onClick={() => selectAndOpenRow(row)}
                  >
                    <div className="scan-forecast-row-main">
                      <div className="scan-forecast-bucket">
                        <span>{isEn ? "Conclusion" : "最终判断"}</span>
                        <strong>{thresholdDecision.headline}</strong>
                        <small>{thresholdDecision.summary}</small>
                      </div>
                      <div className="scan-forecast-signals">
                        <span>
                          <small>{debDistanceLabel}</small>
                          <b>{debDistanceText}</b>
                        </span>
                        <span>
                          <small>{modelSupportLabel}</small>
                          <b>{modelSupportText}</b>
                        </span>
                        <span>
                          <small>{metarLabel}</small>
                          <b>{metarConflictText}</b>
                        </span>
                        <span>
                          <small>{paceLabel}</small>
                          <b>{paceSignalText}</b>
                        </span>
                      </div>
                      <span className={`scan-forecast-fit ${thresholdDecision.tone}`}>
                        {thresholdDecision.relation}
                      </span>
                      <button
                        type="button"
                        className="scan-opportunity-expand"
                        aria-expanded={expanded}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleRowAnalysis(row);
                        }}
                      >
                        <BarChart3 size={14} />
                        {expanded
                          ? isEn
                            ? "Hide analysis"
                            : "收起分析"
                          : isEn
                            ? "AI analysis"
                            : "AI 分析"}
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                    <div className={`scan-forecast-ai-line ${aiMeta?.tone || "neutral"}`}>
                      <b>{isEn ? "Current read" : "当前判断"}</b>
                      <small>{shortConclusion}</small>
                    </div>
                    {expanded ? (
                      <div className="scan-ai-analysis">
                        <div className="scan-ai-analysis-head">
                          <div>
                            <strong>{isEn ? "Conclusion" : "结论"}</strong>
                            <p>{thresholdDecision.headline}</p>
                            <small>{thresholdDecision.summary}</small>
                          </div>
                          <span className={`scan-ai-forecast-pill ${thresholdDecision.tone}`}>
                            {thresholdDecision.relation}
                          </span>
                        </div>
                        <div className="scan-ai-temperature-line">
                          <span>
                            <small>{isEn ? "Bucket" : "判断对象"}</small>
                            <b>{bucketLabel}</b>
                          </span>
                          <span>
                            <small>{isEn ? "AI forecast" : "AI 预测"}</small>
                            <b>
                              {cityForecast.predicted != null
                                ? formatTemperatureValue(cityForecast.predicted, tempSymbol, { digits: 1 })
                                : "--"}
                            </b>
                          </span>
                          <span>
                            <small>{isEn ? "Forecast range" : "预测区间"}</small>
                            <b>{forecastRangeLabel}</b>
                          </span>
                          <span>
                            <small>{isEn ? "Confidence" : "信心"}</small>
                            <b>{cityForecast.confidence || thresholdDecision.confidence}</b>
                          </span>
                        </div>
                        <div className="scan-ai-evidence-line">
                          <span>
                            <small>DEB</small>
                            <b>{group.debLabel}</b>
                          </span>
                          <span>
                            <small>{modelSupportLabel}</small>
                            <b>{modelSupportText}</b>
                          </span>
                          <span>
                            <small>METAR</small>
                            <b>{metarConflictText}</b>
                          </span>
                          <span>
                            <small>{paceLabel}</small>
                            <b>{paceSignalText}</b>
                          </span>
                        </div>
                        <div className="scan-ai-brief-grid">
                          <section>
                            <strong>{isEn ? "Why" : "为什么"}</strong>
                            <ul>
                              {keyReasons.map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                          </section>
                          <section>
                            <strong>{isEn ? "What can change it" : "可能改变判断的因素"}</strong>
                            <ul>
                              {riskItems.map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                          </section>
                        </div>
                        <div className="scan-ai-airport-read">
                          {cityForecast.airportRead ? (
                            <p>{cityForecast.airportRead}</p>
                          ) : null}
                          {cityForecast.weatherRead ? (
                            <p>{cityForecast.weatherRead}</p>
                          ) : null}
                          {cityForecast.paceRead ? (
                            <p>{cityForecast.paceRead}</p>
                          ) : null}
                          {cityForecast.peakWindow ? (
                            <p>{cityForecast.peakWindow}</p>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
          );
        })}
      </div>
    </div>
  );
});
