import { memo, useMemo } from "react";
import clsx from "clsx";
import type { ScanOpportunityRow, ScanTerminalResponse } from "@/lib/dashboard-types";
import { formatTemperatureValue } from "@/lib/temperature-utils";
import { LoadingSignal } from "@/components/dashboard/scan-terminal/LoadingSignal";
import {
  formatRowPrice,
  formatRowProbability,
  formatRowSignedPercent,
  getPeakCountdownMeta,
  getRowDecisionMeta,
  getRowTemperatureBucket,
  pickOpportunitySections,
} from "@/components/dashboard/scan-terminal/decision-utils";

const OpportunityDecisionCard = memo(function OpportunityDecisionCard({
  row,
  locale,
  selected,
  onOpenDecision,
  onSelectRow,
}: {
  row: ScanOpportunityRow;
  locale: string;
  selected: boolean;
  onOpenDecision: (row: ScanOpportunityRow) => void;
  onSelectRow: (row: ScanOpportunityRow) => void;
}) {
  const isEn = locale === "en-US";
  const displayName = row.city_display_name || row.display_name || row.city;
  const unit = row.temp_symbol || row.target_unit || "°C";
  const decision = getRowDecisionMeta(row, locale);
  const phase = getPeakCountdownMeta(row, locale);
  const modelProb = row.model_event_probability ?? row.model_probability ?? row.peak_probability ?? null;
  const marketProb = row.market_event_probability ?? row.market_probability ?? null;
  const price = row.yes_ask ?? row.ask ?? row.yes_bid ?? row.bid ?? row.midpoint ?? null;
  const confidence =
    row.ai_confidence ||
    row.ai_city_confidence ||
    row.ai_forecast_confidence ||
    (row.signal_confidence != null ? formatRowProbability(row.signal_confidence) : "--");
  const predicted =
    row.ai_predicted_max ??
    row.deb_prediction ??
    row.cluster_center ??
    row.current_max_so_far ??
    null;
  const reason = decision.reason.length > 128 ? `${decision.reason.slice(0, 125)}…` : decision.reason;

  return (
    <article
      className={clsx("scan-opportunity-decision-card", decision.tone, selected && "selected")}
      onClick={() => onSelectRow(row)}
    >
      <div className="scan-opportunity-decision-head">
        <div>
          <span>{phase.title}</span>
          <strong>{displayName}</strong>
        </div>
        <b>{decision.action}</b>
      </div>
      <div className="scan-opportunity-decision-primary">
        <span>
          {isEn ? "Forecast high" : "预测最高温"}
          <b>{predicted != null ? formatTemperatureValue(predicted, unit, { digits: 1 }) : "--"}</b>
        </span>
        <span>
          {isEn ? "Bucket" : "推荐温度桶"}
          <b>{getRowTemperatureBucket(row)}</b>
        </span>
        <span>
          {isEn ? "Edge" : "概率差"}
          <b>{formatRowSignedPercent(row.edge_percent ?? row.gap ?? row.signed_gap)}</b>
        </span>
      </div>
      <p>{reason}</p>
      <div className="scan-opportunity-decision-foot">
        <small>{isEn ? "Model" : "模型"} {formatRowProbability(modelProb)}</small>
        <small>{isEn ? "Market" : "市场"} {formatRowProbability(marketProb)}</small>
        <small>{isEn ? "YES" : "YES"} {formatRowPrice(price)}</small>
        <small>{isEn ? "Confidence" : "信心"} {confidence}</small>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenDecision(row);
        }}
      >
        {isEn ? "Open decision card" : "打开决策卡"}
      </button>
    </article>
  );
});

export const OpportunityOverview = memo(function OpportunityOverview({
  rows,
  terminalData,
  loading,
  error,
  locale,
  selectedRowId,
  onOpenDecision,
  onSelectRow,
  onOpenMap,
}: {
  rows: ScanOpportunityRow[];
  terminalData: ScanTerminalResponse | null;
  loading: boolean;
  error: string | null;
  locale: string;
  selectedRowId: string | null;
  onOpenDecision: (row: ScanOpportunityRow) => void;
  onSelectRow: (row: ScanOpportunityRow) => void;
  onOpenMap: () => void;
}) {
  const isEn = locale === "en-US";
  const sections = useMemo(() => pickOpportunitySections(rows, locale), [locale, rows]);
  const visibleSections = useMemo(
    () => sections.filter((section) => section.rows.length > 0),
    [sections],
  );
  const summary = terminalData?.summary;

  if (loading) {
    return (
      <div className="scan-opportunity-overview loading">
        <LoadingSignal
          title={isEn ? "Building today’s opportunity board" : "正在生成今日机会榜"}
          description={
            isEn
              ? "Syncing market prices, model edge and peak-window timing."
              : "正在同步市场价格、模型概率差和峰值窗口。"
          }
          compact
        />
      </div>
    );
  }

  if (error || rows.length === 0) {
    return (
      <div className="scan-opportunity-overview empty">
        <strong>{isEn ? "No opportunity snapshot yet" : "暂无机会快照"}</strong>
        <p>
          {error ||
            (isEn
              ? "Use the map to add cities, or refresh after the scan backend is ready."
              : "可以先用地图添加城市；扫描后端就绪后会显示今日机会榜。")}
        </p>
        <button type="button" onClick={onOpenMap}>
          {isEn ? "Explore map" : "去地图探索"}
        </button>
      </div>
    );
  }

  return (
    <div className="scan-opportunity-overview">
      <div className="scan-opportunity-hero">
        <div>
          <span>{isEn ? "Today AI opportunity board" : "今日 AI 机会榜"}</span>
          <strong>{isEn ? "Decide first, verify second" : "先看决策，再展开证据"}</strong>
          <p>
            {isEn
              ? "Cards translate weather, METAR and Polymarket pricing into action states."
              : "把天气、METAR 与 Polymarket 报价先翻译成行动状态，再让你展开验证。"}
          </p>
        </div>
        <div className="scan-opportunity-summary">
          <span>{isEn ? "Candidates" : "候选"} <b>{summary?.candidate_total ?? rows.length}</b></span>
          <span>{isEn ? "Tradable" : "可交易市场"} <b>{summary?.tradable_market_count ?? "--"}</b></span>
          <span>{isEn ? "Avg edge" : "平均概率差"} <b>{formatRowSignedPercent(summary?.avg_edge_percent)}</b></span>
          <span>
            {isEn ? "Updated" : "更新时间"}{" "}
            <b>
              {terminalData?.generated_at
                ? new Date(terminalData.generated_at).toLocaleTimeString(isEn ? "en-US" : "zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "--"}
            </b>
          </span>
        </div>
      </div>

      <div className="scan-opportunity-lanes">
        {visibleSections.map((section) => (
          <section key={section.key} className="scan-opportunity-lane">
            <div className="scan-opportunity-lane-head">
              <div>
                <strong>{section.title}</strong>
                <p>{section.subtitle}</p>
              </div>
              <span>{section.rows.length}</span>
            </div>
            <div className="scan-opportunity-card-grid">
              {section.rows.map((row) => (
                <OpportunityDecisionCard
                  key={`${section.key}-${row.id}`}
                  row={row}
                  locale={locale}
                  selected={selectedRowId === row.id}
                  onOpenDecision={onOpenDecision}
                  onSelectRow={onSelectRow}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
});

