"use client";

import clsx from "clsx";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import { getCityScenery } from "@/lib/dashboard-scenery";
import {
  getCityProfileStats,
  getClimateDrivers,
  getRiskBadgeLabel,
  getSettlementRiskNarrative,
} from "@/lib/dashboard-utils";
import { ForecastTable } from "@/components/dashboard/PanelSections";

export function DetailPanel() {
  const store = useDashboardStore();
  const detail = store.selectedDetail;
  const isOverlayOpen =
    Boolean(store.futureModalDate) ||
    store.historyState.isOpen ||
    store.isGuideOpen;
  const isVisible =
    store.isPanelOpen &&
    Boolean(store.selectedCity) &&
    Boolean(detail) &&
    !store.loadingState.cityDetail &&
    !isOverlayOpen;
  const profileStats = detail ? getCityProfileStats(detail) : [];
  const riskLines = detail ? getSettlementRiskNarrative(detail) : [];
  const climateDrivers = detail ? getClimateDrivers(detail) : [];
  const scenery = getCityScenery(detail?.name);

  return (
    <aside
      className={clsx("detail-panel", isVisible && "visible")}
      aria-hidden={!isVisible}
    >
      <div className="panel-header">
        <button
          type="button"
          className="panel-close"
          aria-label="关闭城市详情面板"
          onClick={store.closePanel}
        >
          ×
        </button>
        <div className="panel-title-area">
          <h2>{detail?.display_name?.toUpperCase() || "—"}</h2>
          <div className="panel-meta">
            <span className={clsx("risk-badge", detail?.risk?.level || "low")}>
              {getRiskBadgeLabel(detail?.risk?.level)}
            </span>
            <span className="local-time">
              {detail
                ? `${detail.local_date} ${detail.local_time}`
                : "等待选择城市"}
            </span>
            <button
              type="button"
              className="history-btn"
              title="查看今日日内分析"
              onClick={store.openTodayModal}
              disabled={!detail}
            >
              今日日内分析
            </button>
            <button
              type="button"
              className="history-btn"
              title="查看历史对账"
              onClick={() => void store.openHistory()}
              disabled={!detail}
            >
              历史对账
            </button>
          </div>
        </div>
      </div>

      <div className="panel-body">
        {!detail ? (
          <section>
            <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              {store.loadingState.cityDetail
                ? "正在加载城市详情..."
                : "从左侧城市列表选择一个城市查看详情。"}
            </div>
          </section>
        ) : (
          <>
            <section className="detail-scenery-card">
              {scenery ? (
                <>
                  <img
                    className="detail-scenery-image"
                    src={scenery.imageUrl}
                    alt={`${detail.display_name} 风景照`}
                  />
                  <div className="detail-scenery-overlay">
                    <div className="detail-scenery-copy">
                      <span className="detail-scenery-kicker">
                        {detail.display_name}
                      </span>
                    </div>
                    <a
                      className="detail-scenery-credit"
                      href={scenery.creditUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {scenery.creditLabel}
                    </a>
                  </div>
                </>
              ) : (
                <div className="detail-scenery-fallback">
                  <span className="detail-scenery-kicker">
                    {detail.display_name}
                  </span>
                  <strong className="detail-scenery-title">
                    城市风景与微气候
                  </strong>
                  <span className="detail-scenery-subtitle">
                    当前没有匹配到风景图，仍可从下方档案与风险说明查看城市特征。
                  </span>
                </div>
              )}
            </section>

            <section className="detail-section">
              <h3>城市档案</h3>
              <div className="detail-grid">
                {profileStats.map((item) => (
                  <div key={item.label} className="detail-card">
                    <span className="detail-label">{item.label}</span>
                    <span className="detail-value">{item.value}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="detail-section">
              <h3>结算与偏差风险</h3>
              <div className="risk-info">
                {riskLines.map((line) => (
                  <div key={line} className="risk-row">
                    <span style={{ color: "var(--accent-cyan)", opacity: 0.6 }}>
                      •
                    </span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="detail-section">
              <h3>当地气候主要受什么影响</h3>
              <div className="insight-list">
                {climateDrivers.map((driver) => (
                  <div key={driver.label} className="insight-item">
                    <div className="insight-title">{driver.label}</div>
                    <div className="insight-text">{driver.text}</div>
                  </div>
                ))}
              </div>
            </section>
            <ForecastTable />
          </>
        )}
      </div>
    </aside>
  );
}
