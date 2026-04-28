"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useDashboardStore, useHistoryData } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";
import { ProFeaturePaywall } from "@/components/dashboard/ProFeaturePaywall";
import { getHistorySummary } from "@/lib/dashboard-utils";

const HistoryChart = dynamic(
  () =>
    import("@/components/dashboard/HistoryChart").then(
      (module) => module.HistoryChart,
    ),
  {
    loading: () => <div className="history-chart-wrapper history-chart-loading" />,
    ssr: false,
  },
);

export function HistoryModal() {
  const store = useDashboardStore();
  const { t, locale } = useI18n();
  const { data, error, isLoading, isOpen, isRecordsLoading, meta } = useHistoryData();
  const isPro = store.proAccess.subscriptionActive;
  const isProLoading = store.proAccess.loading;
  const isNoaaSettlement =
    store.selectedDetail?.current?.settlement_source === "noaa" ||
    store.selectedDetail?.current?.settlement_source_label === "NOAA";
  const noaaStationCode = String(
    store.selectedDetail?.current?.station_code ||
      store.selectedDetail?.risk?.icao ||
      "NOAA",
  )
    .trim()
    .toUpperCase();
  const noaaStationName =
    String(store.selectedDetail?.current?.station_name || "").trim() ||
    String(store.selectedDetail?.risk?.airport || "").trim() ||
    noaaStationCode;
  const summary = useMemo(
    () => getHistorySummary(data, store.selectedDetail?.local_date),
    [data, store.selectedDetail?.local_date],
  );
  const settledPeakRows = useMemo(
    () =>
      summary.recentData
        .filter(
          (row) =>
            row.actual != null &&
            row.actual_peak_time &&
            row.deb_at_peak_minus_12h != null,
        )
        .reverse(),
    [summary.recentData],
  );
  const modelReferenceRows = useMemo(
    () =>
      summary.recentData
        .filter(
          (row) =>
            row.actual != null &&
            row.model_reference?.available &&
            (row.model_reference.models?.length || 0) > 0,
        )
        .slice(-5)
        .reverse(),
    [summary.recentData],
  );

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          store.closeHistory();
        }
      }}
    >
      {isProLoading ? (
        <div
          className="modal-content"
          style={{ padding: "40px", textAlign: "center" }}
        >
          <div style={{ color: "var(--text-muted)" }}>
            {t("dashboard.loading")}
          </div>
        </div>
      ) : !isPro ? (
        <ProFeaturePaywall feature="history" onClose={store.closeHistory} />
      ) : (
        <div className="modal-content history-modal">
          <div className="modal-header">
            <div className="modal-title-stack">
              <div className="modal-overline">
                <span>{locale === "en-US" ? "Audit workspace" : "对账工作台"}</span>
                <span className="modal-overline-sep">•</span>
                <span>{store.selectedCity?.toUpperCase() || ""}</span>
              </div>
              <h2 id="history-modal-title">
                {t("history.title", {
                  city: store.selectedCity?.toUpperCase() || "",
                })}
              </h2>
              <div className="modal-subtitle">
                {locale === "en-US"
                  ? "Observed highs, DEB path, and historical baseline consistency."
                  : "查看实测最高温、DEB 路径与历史基线是否一致。"}
              </div>
              {meta?.mode === "preview" ? (
                <div className="modal-header-meta">
                  <span className="modal-meta-pill">
                    {isRecordsLoading
                      ? locale === "en-US"
                        ? "Full records syncing"
                        : "完整记录补齐中"
                      : meta.hasMore
                        ? locale === "en-US"
                          ? `Preview ${meta.previewCount}/${meta.fullCount}`
                          : `预览 ${meta.previewCount}/${meta.fullCount}`
                        : locale === "en-US"
                          ? "Full set loaded"
                          : "完整记录已到齐"}
                  </span>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="modal-close"
              aria-label={t("history.closeAria")}
              onClick={store.closeHistory}
            >
              ×
            </button>
          </div>
          <div className="modal-body">
            {isNoaaSettlement && (
              <div className="modal-callout modal-callout-info">
                {t("lang") === "en-US"
                  ? `${store.selectedDetail?.display_name || store.selectedCity || "This city"} historical actuals are aligned to NOAA ${noaaStationCode} (${noaaStationName}) settlement rules: use the highest rounded whole-degree Celsius reading after the date is finalized.`
                  : `${store.selectedDetail?.display_name || store.selectedCity || "该城市"}历史对账已按 NOAA ${noaaStationCode}（${noaaStationName}）结算口径对齐：采用该日最终完成质控后的最高整度摄氏值。`}
              </div>
            )}
            {isLoading ? (
              <div className="history-modal-loading">
                <div className="history-fetch-loading">
                  <div className="history-fetch-scan" aria-hidden="true">
                    <span className="history-fetch-ring history-fetch-ring-1" />
                    <span className="history-fetch-ring history-fetch-ring-2" />
                    <span className="history-fetch-sweep" />
                    <span className="history-fetch-core" />
                  </div>
                  <div className="history-fetch-bars" aria-hidden="true">
                    <span className="history-fetch-bar history-fetch-bar-1" />
                    <span className="history-fetch-bar history-fetch-bar-2" />
                    <span className="history-fetch-bar history-fetch-bar-3" />
                    <span className="history-fetch-bar history-fetch-bar-4" />
                  </div>
                  <div className="history-fetch-lines" aria-hidden="true">
                    <span className="history-fetch-line history-fetch-line-1" />
                    <span className="history-fetch-line history-fetch-line-2" />
                    <span className="history-fetch-line history-fetch-line-3" />
                  </div>
                  <div className="history-fetch-copy">
                    <strong>
                      {locale === "en-US"
                        ? "Scanning archived settlement history"
                        : "正在扫描历史结算档案"}
                    </strong>
                    <span>
                      {locale === "en-US"
                        ? "Reconciling settled highs, DEB traces, and baseline forecasts..."
                        : "正在对齐实测高温、DEB 轨迹与基线预报..."}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="modal-section-heading">
                  <div className="modal-section-kicker">
                    {locale === "en-US" ? "Performance snapshot" : "表现快照"}
                  </div>
                  <h3>
                    {locale === "en-US"
                      ? "Recent settlement performance"
                      : "近期结算表现"}
                  </h3>
                  <div className="modal-section-note">
                    {locale === "en-US"
                      ? "Hit rate, MAE, and baseline comparison across recent settled days."
                      : "查看近期已结算样本里的命中率、误差与基线对照。"}
                  </div>
                </div>
                <div className="history-stats">
                  {error ? (
                <span style={{ color: "var(--accent-red)" }}>
                  {t("history.error")}
                </span>
                  ) : !summary.recentData.length ? (
                <span style={{ color: "var(--text-muted)" }}>
                  {t("history.empty")}
                </span>
                  ) : (
                <>
                  <div className="h-stat-card">
                    <span className="label">{t("history.debHitRate")}</span>
                    <span className="val">
                      {summary.hitRate != null ? `${summary.hitRate}%` : "--"}
                    </span>
                  </div>
                  <div className="h-stat-card">
                    <span className="label">{t("history.debMae")}</span>
                    <span className="val">
                      {summary.debMae != null ? `${summary.debMae}°` : "--"}
                    </span>
                  </div>
                  <div className="h-stat-card">
                    <span className="label">{t("history.bestModelMae")}</span>
                    <span className="val">
                      {summary.bestModelMae != null
                        ? `${summary.bestModelMae}°${
                            summary.bestModelName
                              ? ` (${summary.bestModelName})`
                              : ""
                          }`
                        : "--"}
                    </span>
                  </div>
                  <div className="h-stat-card">
                    <span className="label">{t("history.debVsBest")}</span>
                    <span className="val">
                      {summary.debWinRateVsBest != null
                        ? `${summary.debWinRateVsBest}% (${summary.debWinDaysVsBest}/${summary.debVsBestComparableDays})`
                        : "--"}
                    </span>
                  </div>
                  <div className="h-stat-card">
                    <span className="label">{t("history.sample")}</span>
                    <span className="val">
                      {t("history.sampleDays", { count: summary.settledCount })}
                    </span>
                  </div>
                </>
                  )}
                </div>
                {!error && <HistoryChart />}
                {!error && modelReferenceRows.length > 0 && (
              <div className="history-model-reference">
                <div className="modal-section-heading">
                  <div className="modal-section-kicker">
                    {locale === "en-US" ? "Reference layer" : "参考层"}
                  </div>
                  <div className="history-peak-reference-title">
                    {locale === "en-US"
                      ? "Model Reference at Cutoff"
                      : "当时模型参考"}
                  </div>
                  <div className="modal-section-note">
                    {locale === "en-US"
                      ? "These are archived model snapshots used for audit context. Settlement truth still comes only from the finalized observation source."
                      : "这里展示当时归档的模型快照，仅用于解释判断背景；结算真值仍只来自最终实况来源。"}
                  </div>
                </div>
                <div className="history-model-reference-scroll">
                  {modelReferenceRows.map((row) => {
                    const models = (row.model_reference?.models || []).slice(0, 6);
                    return (
                      <div key={row.date} className="history-model-reference-row">
                        <div className="history-peak-reference-date">
                          {row.date}
                        </div>
                        <div className="history-model-reference-body">
                          <div className="history-model-reference-summary">
                            <span>
                              {locale === "en-US" ? "Actual" : "最终实测"}{" "}
                              <strong>
                                {row.actual}
                                {store.selectedDetail?.temp_symbol || "°C"}
                              </strong>
                            </span>
                            <span>
                              DEB{" "}
                              <strong>
                                {row.model_reference?.deb?.value ?? row.deb ?? "--"}
                                {store.selectedDetail?.temp_symbol || "°C"}
                              </strong>
                              {row.model_reference?.deb?.error != null
                                ? ` / ${locale === "en-US" ? "err" : "误差"} ${row.model_reference.deb.error}${store.selectedDetail?.temp_symbol || "°C"}`
                                : ""}
                            </span>
                          </div>
                          <div className="history-model-reference-models">
                            {models.map((model) => (
                              <div
                                key={`${row.date}-${model.model}`}
                                className="history-model-reference-model"
                              >
                                <span className="history-model-name">
                                  {model.model}
                                </span>
                                <span>
                                  {model.value}
                                  {store.selectedDetail?.temp_symbol || "°C"}
                                </span>
                                <span className="history-model-error">
                                  {model.error != null
                                    ? `${locale === "en-US" ? "err" : "误差"} ${model.error}${store.selectedDetail?.temp_symbol || "°C"}`
                                    : locale === "en-US"
                                      ? "pending"
                                      : "待结算"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
                )}
                {!error && settledPeakRows.length > 0 && (
              <div className="history-peak-reference">
                <div className="modal-section-heading">
                  <div className="modal-section-kicker">
                    {locale === "en-US" ? "Reference table" : "参考表"}
                  </div>
                  <div className="history-peak-reference-title">
                    {locale === "en-US"
                      ? "Peak-12h DEB Reference (Approx.)"
                      : "峰值前 12 小时 DEB 参考（近似）"}
                  </div>
                  <div className="modal-section-note">
                    {locale === "en-US"
                      ? "Use peak-minus-12h DEB as a fast sanity check for settled highs."
                      : "用峰值前 12 小时的 DEB 作为历史结算高温的快速校验。"}
                  </div>
                </div>
                <div className="history-peak-reference-scroll">
                  {settledPeakRows.map((row) => (
                    <div key={row.date} className="history-peak-reference-row">
                      <div className="history-peak-reference-date">
                        {row.date}
                      </div>
                      <div className="history-peak-reference-meta">
                        <div>
                          {locale === "en-US" ? "Peak ref" : "峰值参考"}:{" "}
                          <span style={{ color: "var(--text-primary)" }}>
                            {row.actual}
                            {store.selectedDetail?.temp_symbol || "°C"} @{" "}
                            {row.actual_peak_time}
                          </span>
                        </div>
                        <div>
                          {locale === "en-US" ? "DEB@-12h" : "峰值前12小时 DEB"}:{" "}
                          <span style={{ color: "var(--text-primary)" }}>
                            {row.deb_at_peak_minus_12h}
                            {store.selectedDetail?.temp_symbol || "°C"} @{" "}
                            {row.deb_at_peak_minus_12h_time}
                          </span>
                        </div>
                        <div>
                          {locale === "en-US" ? "Actual" : "最终实测"}:{" "}
                          <span style={{ color: "var(--text-primary)" }}>
                            {row.actual}
                            {store.selectedDetail?.temp_symbol || "°C"}
                          </span>
                        </div>
                        <div>
                          {locale === "en-US" ? "Error" : "误差"}:{" "}
                          <span
                            style={{
                              color:
                                (row.deb_at_peak_minus_12h_error ?? 0) > 0
                                  ? "#f59e0b"
                                  : "#34d399",
                            }}
                          >
                            {row.deb_at_peak_minus_12h_error != null
                              ? `${row.deb_at_peak_minus_12h_error > 0 ? "+" : ""}${row.deb_at_peak_minus_12h_error}${store.selectedDetail?.temp_symbol || "°C"}`
                              : "--"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
