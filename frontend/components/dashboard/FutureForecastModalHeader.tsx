"use client";

import clsx from "clsx";
import type { Locale } from "@/lib/i18n";

type FutureForecastModalHeaderProps = {
  cityDisplayName: string;
  dateStr: string;
  isAnyLayerSyncing: boolean;
  isPro: boolean;
  isProLoading: boolean;
  isToday: boolean;
  locale: Locale;
  onClose: () => void;
  onRefresh: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

export function FutureForecastModalHeader({
  cityDisplayName,
  dateStr,
  isAnyLayerSyncing,
  isPro,
  isProLoading,
  isToday,
  locale,
  onClose,
  onRefresh,
  t,
}: FutureForecastModalHeaderProps) {
  const cityLabel = cityDisplayName.toUpperCase();
  return (
    <div className="modal-header">
      <div className="modal-title-stack">
        <div className="modal-overline">
          <span>{locale === "en-US" ? "Analysis workspace" : "分析工作台"}</span>
          <span className="modal-overline-sep">•</span>
          <span>{cityLabel}</span>
        </div>
        <h2 id="future-modal-title" className="future-modal-title-with-actions">
          <span>
            {isToday
              ? t("future.todayTitle", {
                  city: cityLabel,
                })
              : t("future.dateTitle", {
                  city: cityLabel,
                  date: dateStr,
                })}
          </span>
          <button
            className={clsx("future-refresh-btn", isAnyLayerSyncing && "spinning")}
            disabled={!isPro || isProLoading}
            onClick={onRefresh}
            title={
              !isPro
                ? locale === "en-US"
                  ? "Pro subscription required"
                  : "需要 Pro 订阅"
                : locale === "en-US"
                  ? "Refresh Data"
                  : "刷新数据"
            }
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        </h2>
        <div className="modal-subtitle">
          {isToday
            ? locale === "en-US"
              ? "Base signal first, then probability and model layers."
              : "先看基础信号，再看概率层和模型层。"
            : locale === "en-US"
              ? "Forward date view with phased model and structure sync."
              : "未来日期视图，模型层与结构层分阶段补齐。"}
        </div>
      </div>
      <button
        type="button"
        className="modal-close"
        aria-label={isToday ? t("future.closeTodayAria") : t("future.closeDateAria")}
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
