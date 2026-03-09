"use client";

import { ChartConfiguration } from "chart.js/auto";
import { useMemo } from "react";
import { useChart } from "@/hooks/useChart";
import { useDashboardStore, useHistoryData } from "@/hooks/useDashboardStore";
import { getHistorySummary } from "@/lib/dashboard-utils";

function HistoryChart() {
  const store = useDashboardStore();
  const { data } = useHistoryData();
  const summary = useMemo(
    () => getHistorySummary(data, store.selectedDetail?.local_date),
    [data, store.selectedDetail?.local_date],
  );
  const hasMgm =
    store.selectedCity === "ankara" &&
    summary.mgms.some((value) => value != null);

  const canvasRef = useChart(
    () => {
      const datasets: NonNullable<ChartConfiguration<"line">["data"]>["datasets"] = [
        {
          backgroundColor: "rgba(248, 113, 113, 0.1)",
          borderColor: "#f87171",
          borderWidth: 2,
          data: summary.actuals,
          label: "实测最高温",
          pointBackgroundColor: "#f87171",
          pointBorderColor: "#fff",
          pointRadius: 4,
          tension: 0.2,
        },
        {
          backgroundColor: "transparent",
          borderColor: "#34d399",
          borderDash: [5, 4],
          borderWidth: 2,
          data: summary.debs,
          label: "DEB 融合",
          pointRadius: 3,
          tension: 0.2,
        },
      ];

      if (hasMgm) {
        datasets.push({
          backgroundColor: "transparent",
          borderColor: "#fb923c",
          borderWidth: 2,
          data: summary.mgms,
          label: "MGM 官方预报",
          pointRadius: 3,
          tension: 0.2,
        });
      }

      return {
        data: {
          datasets,
          labels: summary.dates,
        },
        options: {
          interaction: { intersect: false, mode: "index" },
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: {
                color: "#94a3b8",
                font: { family: "Inter", size: 12 },
              },
            },
            tooltip: {
              backgroundColor: "rgba(15, 23, 42, 0.9)",
              borderColor: "rgba(255, 255, 255, 0.1)",
              borderWidth: 1,
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}°`,
              },
            },
          },
          responsive: true,
          scales: {
            x: {
              grid: { color: "rgba(255,255,255,0.04)" },
              ticks: { color: "#64748b", font: { family: "Inter", size: 10 } },
            },
            y: {
              grid: { color: "rgba(255,255,255,0.04)" },
              ticks: { color: "#64748b", font: { family: "Inter", size: 10 } },
            },
          },
        },
        type: "line",
      } satisfies ChartConfiguration<"line">;
    },
    [hasMgm, summary],
  );

  if (!summary.recentData.length) return null;

  return (
    <div className="history-chart-wrapper">
      <canvas ref={canvasRef} />
    </div>
  );
}

export function HistoryModal() {
  const store = useDashboardStore();
  const { data, error, isLoading, isOpen } = useHistoryData();
  const summary = useMemo(
    () => getHistorySummary(data, store.selectedDetail?.local_date),
    [data, store.selectedDetail?.local_date],
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
      <div className="modal-content">
        <div className="modal-header">
          <h2 id="history-modal-title">
            📊 历史准确率对账 - {store.selectedCity?.toUpperCase()}
          </h2>
          <button
            type="button"
            className="modal-close"
            aria-label="关闭历史对账"
            onClick={store.closeHistory}
          >
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="history-stats">
            {isLoading ? (
              <span style={{ color: "var(--text-muted)" }}>正在获取历史数据...</span>
            ) : error ? (
              <span style={{ color: "var(--accent-red)" }}>获取历史信息失败</span>
            ) : !summary.recentData.length ? (
              <span style={{ color: "var(--text-muted)" }}>近 15 天暂无该城市历史数据</span>
            ) : (
              <>
                <div className="h-stat-card">
                  <span className="label">DEB 结算胜率 (WU)</span>
                  <span className="val">
                    {summary.hitRate != null ? `${summary.hitRate}%` : "--"}
                  </span>
                </div>
                <div className="h-stat-card">
                  <span className="label">DEB MAE</span>
                  <span className="val">
                    {summary.debMae != null ? `${summary.debMae}°` : "--"}
                  </span>
                </div>
                <div className="h-stat-card">
                  <span className="label">近 15 天已结算样本</span>
                  <span className="val">{summary.settledCount} 天</span>
                </div>
              </>
            )}
          </div>
          {!isLoading && !error && <HistoryChart />}
        </div>
      </div>
    </div>
  );
}
