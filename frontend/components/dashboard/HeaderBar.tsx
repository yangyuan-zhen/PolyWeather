"use client";

import clsx from "clsx";
import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useI18n } from "@/hooks/useI18n";

export function HeaderBar() {
  const store = useDashboardStore();
  const { locale, setLocale, t } = useI18n();

  return (
    <header className="header">
      <div className="brand">
        <h1>PolyWeather</h1>
        <span className="subtitle">{t("header.subtitle")}</span>
      </div>

      <div className="header-right">
        <div className="lang-switch" role="group" aria-label={t("header.langAria")}>
          <button
            type="button"
            className={clsx("lang-btn", locale === "zh-CN" && "active")}
            onClick={() => setLocale("zh-CN")}
          >
            {t("header.langZh")}
          </button>
          <button
            type="button"
            className={clsx("lang-btn", locale === "en-US" && "active")}
            onClick={() => setLocale("en-US")}
          >
            {t("header.langEn")}
          </button>
        </div>

        <button
          type="button"
          className="info-btn"
          title={t("header.infoAria")}
          aria-label={t("header.infoAria")}
          onClick={store.openGuide}
        >
          {t("header.info")}
        </button>

        <div className="live-badge" id="liveBadge">
          <span className="pulse-dot" />
          <span>{t("header.live")}</span>
        </div>

        <button
          type="button"
          className={clsx("refresh-btn", store.loadingState.refresh && "spinning")}
          title={t("header.refreshAria")}
          aria-label={t("header.refreshAria")}
          onClick={() => void store.refreshAll()}
        >
          ↻
        </button>
      </div>
    </header>
  );
}
