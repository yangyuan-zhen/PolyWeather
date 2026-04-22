"use client";
import clsx from "clsx";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import styles from "./Dashboard.module.css";
import detailChromeStyles from "./DetailPanelChrome.module.css";
import modalChromeStyles from "./ModalChrome.module.css";
import {
  DashboardStoreProvider,
  useDashboardStore,
} from "@/hooks/useDashboardStore";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import { CitySidebar } from "@/components/dashboard/CitySidebar";
import { DetailPanel } from "@/components/dashboard/DetailPanel";
import { HeaderBar } from "@/components/dashboard/HeaderBar";
import type {
  CityDetail,
  CityListItem,
  CitySummary,
  RiskLevel,
} from "@/lib/dashboard-types";

const loadHistoryModal = () =>
  import("@/components/dashboard/HistoryModal").then(
    (module) => module.HistoryModal,
  );

const loadFutureForecastModal = () =>
  import("@/components/dashboard/FutureForecastModal").then(
    (module) => module.FutureForecastModal,
  );

const MapCanvas = dynamic(
  () =>
    import("@/components/dashboard/MapCanvas").then((module) => module.MapCanvas),
  {
    ssr: false,
    loading: () => <div className="map" aria-hidden="true" />,
  },
);

const HistoryModal = dynamic(
  loadHistoryModal,
  {
    ssr: false,
    loading: () => null,
  },
);

const FutureForecastModal = dynamic(
  loadFutureForecastModal,
  {
    ssr: false,
    loading: () => null,
  },
);

type CitySnapshot = {
  city: CityListItem;
  detail?: CityDetail | null;
  score: number;
  summary?: CitySummary | null;
};

const RISK_SCORE: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function getRiskCopy(level: RiskLevel | undefined, locale: string) {
  if (level === "high") return locale === "en-US" ? "High variance" : "高波动";
  if (level === "medium") return locale === "en-US" ? "Watch list" : "重点观察";
  if (level === "low") return locale === "en-US" ? "Stable" : "低波动";
  return locale === "en-US" ? "Unrated" : "待评级";
}

function getTempSymbol(
  city: CityListItem,
  summary?: CitySummary | null,
  detail?: CityDetail | null,
) {
  if (summary?.temp_symbol) return summary.temp_symbol;
  if (detail?.temp_symbol) return detail.temp_symbol;
  return city.temp_unit === "fahrenheit" ? "°F" : "°C";
}

function formatTemperature(value: number | null | undefined, symbol: string) {
  if (!Number.isFinite(Number(value))) return "--";
  return `${Math.round(Number(value))}${symbol}`;
}

function formatPercent(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "--";
  return `${Math.round(Number(value) * 100)}%`;
}

function formatDelta(
  current: number | null | undefined,
  forecast: number | null | undefined,
  symbol: string,
) {
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(forecast))) {
    return "--";
  }
  const delta = Number(current) - Number(forecast);
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}${symbol}`;
}

function buildSnapshot(
  city: CityListItem,
  summary?: CitySummary | null,
  detail?: CityDetail | null,
): CitySnapshot {
  const tier =
    city.deb_recent_tier ||
    city.risk_level ||
    summary?.risk?.level ||
    detail?.risk?.level;
  const hitRate = Number(city.deb_recent_hit_rate ?? 0);
  const sampleCount = Number(city.deb_recent_sample_count ?? 0);
  const score =
    (RISK_SCORE[String(tier || "")] || 0) * 100 +
    hitRate * 100 +
    Math.min(sampleCount, 60) / 10;
  return { city, detail, score, summary };
}

function HomeIntelligencePanel({ snapshots }: { snapshots: CitySnapshot[] }) {
  const store = useDashboardStore();
  const { locale } = useI18n();
  const selectedSnapshot = store.selectedCity
    ? snapshots.find((snapshot) => snapshot.city.name === store.selectedCity)
    : null;
  const spotlight = selectedSnapshot || snapshots[0] || null;

  if (!spotlight) return null;

  const { city, detail, summary } = spotlight;
  const symbol = getTempSymbol(city, summary, detail);
  const currentTemp = summary?.current?.temp ?? detail?.current?.temp;
  const debPrediction = summary?.deb?.prediction ?? detail?.deb?.prediction;
  const localTime = summary?.local_time || detail?.local_time || "--";
  const riskLevel =
    city.deb_recent_tier ||
    city.risk_level ||
    summary?.risk?.level ||
    detail?.risk?.level;
  const deviation = summary?.deviation_monitor || detail?.deviation_monitor;
  const deviationLabel =
    locale === "en-US" ? deviation?.label_en : deviation?.label_zh;
  const observationSource =
    summary?.current?.settlement_source_label ||
    detail?.current?.settlement_source_label ||
    city.settlement_source_label ||
    city.airport;
  const isPro = store.proAccess.subscriptionActive;
  const heading = locale === "en-US" ? "Decision radar" : "决策雷达";
  const subtitle =
    locale === "en-US"
      ? "Live weather, model variance and paid intelligence stay in one workflow."
      : "把实时天气、模型偏差和付费情报放在同一个工作流里。";

  return (
    <aside className="home-intelligence-panel" aria-label={heading}>
      <div className="home-panel-glow" aria-hidden="true" />
      <div className="home-panel-kicker">
        <span className="home-panel-pulse" aria-hidden="true" />
        <span>{heading}</span>
      </div>

      <div className="home-panel-city">
        <div>
          <span className="home-panel-airport">{city.icao || city.airport}</span>
          <h2>{summary?.display_name || detail?.display_name || city.display_name}</h2>
        </div>
        <span className={clsx("home-risk-badge", String(riskLevel || "other"))}>
          {getRiskCopy(riskLevel, locale)}
        </span>
      </div>

      <p className="home-panel-subtitle">{subtitle}</p>

      <div className="home-metric-grid">
        <div className="home-metric-card primary">
          <span>{locale === "en-US" ? "Now" : "当前"}</span>
          <strong>{formatTemperature(currentTemp, symbol)}</strong>
        </div>
        <div className="home-metric-card">
          <span>{locale === "en-US" ? "DEB high" : "DEB 高点"}</span>
          <strong>{formatTemperature(debPrediction, symbol)}</strong>
        </div>
        <div className="home-metric-card">
          <span>{locale === "en-US" ? "Delta" : "偏差"}</span>
          <strong>{formatDelta(currentTemp, debPrediction, symbol)}</strong>
        </div>
        <div className="home-metric-card">
          <span>{locale === "en-US" ? "Local" : "当地"}</span>
          <strong>{localTime}</strong>
        </div>
      </div>

      <div className="home-signal-card">
        <div className="home-signal-line" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <span className="home-signal-label">
            {locale === "en-US" ? "Observation anchor" : "观测锚点"}
          </span>
          <strong>{observationSource}</strong>
          <p>
            {deviationLabel ||
              (locale === "en-US"
                ? "Waiting for model deviation monitor."
                : "等待模型偏差监控信号。")}
          </p>
        </div>
      </div>

      <div className={clsx("home-pro-card", isPro && "active")}>
        <div>
          <span>{isPro ? "PRO SIGNAL" : "PRO LOCKED"}</span>
          <strong>
            {isPro
              ? locale === "en-US"
                ? "Market, history and future days are unlocked."
                : "市场、历史和未来日情报已解锁。"
              : locale === "en-US"
                ? "Market edge, history review and future dates stay paid."
                : "市场优势、历史复盘和未来日期保持付费。"}
          </strong>
        </div>
        {isPro ? (
          <button type="button" onClick={() => void store.selectCity(city.name)}>
            {locale === "en-US" ? "Open detail" : "打开详情"}
          </button>
        ) : (
          <Link href="/account">{locale === "en-US" ? "Upgrade" : "升级"}</Link>
        )}
      </div>
    </aside>
  );
}

function OpportunityStrip({ snapshots }: { snapshots: CitySnapshot[] }) {
  const store = useDashboardStore();
  const { locale } = useI18n();
  const items = snapshots.slice(0, 4);

  if (!items.length) return null;

  return (
    <section
      className="home-opportunity-strip"
      aria-label={locale === "en-US" ? "Opportunity strip" : "机会条"}
    >
      <div className="opportunity-strip-heading">
        <span>{locale === "en-US" ? "Today focus" : "今日焦点"}</span>
        <strong>
          {locale === "en-US" ? "Cities worth opening first" : "优先打开的城市"}
        </strong>
      </div>
      <div className="opportunity-card-grid">
        {items.map(({ city, detail, summary }) => {
          const symbol = getTempSymbol(city, summary, detail);
          const currentTemp = summary?.current?.temp ?? detail?.current?.temp;
          const debPrediction = summary?.deb?.prediction ?? detail?.deb?.prediction;
          const tier =
            city.deb_recent_tier ||
            city.risk_level ||
            summary?.risk?.level ||
            detail?.risk?.level;
          return (
            <button
              key={city.name}
              type="button"
              className="opportunity-card"
              onClick={() => void store.focusCity(city.name)}
            >
              <span className={clsx("opportunity-risk-dot", String(tier || "other"))} />
              <span className="opportunity-city">{city.display_name}</span>
              <span className="opportunity-meta">
                {formatTemperature(currentTemp, symbol)} / DEB{" "}
                {formatTemperature(debPrediction, symbol)}
              </span>
              <span className="opportunity-hit">
                {locale === "en-US" ? "Hit" : "命中"}{" "}
                {formatPercent(city.deb_recent_hit_rate)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DashboardScreen() {
  const store = useDashboardStore();
  const { t } = useI18n();
  const activeSummary = store.selectedCity
    ? store.citySummariesByName[store.selectedCity] || null
    : null;
  const activeCityName =
    store.selectedDetail?.display_name ||
    activeSummary?.display_name ||
    store.cities.find((city) => city.name === store.selectedCity)?.display_name ||
    store.selectedCity ||
    "";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (store.futureModalDate) {
        store.closeFutureModal();
        return;
      }
      if (store.historyState.isOpen) {
        store.closeHistory();
        return;
      }
      if (store.isPanelOpen) {
        store.closePanel();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [store]);

  // Avoid full-page flashing on initial load; only show this overlay for manual refresh.
  const showLoading =
    store.loadingState.cities ||
    store.loadingState.refresh;
  const showCitySyncToast =
    store.loadingState.cityDetail &&
    activeCityName &&
    !store.selectedDetail &&
    !activeSummary;
  const homepageSnapshots = useMemo(
    () =>
      store.cities
        .map((city) =>
          buildSnapshot(
            city,
            store.citySummariesByName[city.name] || null,
            store.cityDetailsByName[city.name] || null,
          ),
        )
        .sort(
          (a, b) =>
            b.score - a.score ||
            a.city.display_name.localeCompare(b.city.display_name),
        ),
    [store.cities, store.cityDetailsByName, store.citySummariesByName],
  );
  const showHomepageChrome =
    !store.isPanelOpen && !store.historyState.isOpen && !store.futureModalDate;

  return (
    <div
      className={clsx(
        styles.root,
        detailChromeStyles.root,
        modalChromeStyles.root,
      )}
    >
      <MapCanvas />
      <HeaderBar />
      <CitySidebar />
      {showHomepageChrome ? (
        <>
          <HomeIntelligencePanel snapshots={homepageSnapshots} />
          <OpportunityStrip snapshots={homepageSnapshots} />
        </>
      ) : null}
      <DetailPanel />
      {showCitySyncToast ? (
        <div className="city-loading-toast" role="status" aria-live="polite">
          <span className="city-loading-dot" aria-hidden="true" />
          <span className="city-loading-copy">
            {t("dashboard.loading")} {activeCityName}
          </span>
        </div>
      ) : null}
      {store.historyState.isOpen && <HistoryModal />}
      {store.futureModalDate && <FutureForecastModal />}
      {showLoading && (
        <div className="loading-overlay">
          <div className="loading-card">
            <div className="loading-clouds" aria-hidden="true">
              <span className="loading-cloud loading-cloud-1" />
              <span className="loading-cloud loading-cloud-2" />
            </div>
            <div className="loading-windfield" aria-hidden="true">
              <span className="loading-windline loading-windline-1" />
              <span className="loading-windline loading-windline-2" />
              <span className="loading-windline loading-windline-3" />
            </div>
            <div className="loading-radar" aria-hidden="true">
              <div className="loading-radar-core" />
              <div className="loading-radar-ring loading-radar-ring-1" />
              <div className="loading-radar-ring loading-radar-ring-2" />
              <div className="loading-radar-sweep" />
              <div className="loading-radar-blip loading-radar-blip-1" />
              <div className="loading-radar-blip loading-radar-blip-2" />
            </div>
            <div className="loading-thermals" aria-hidden="true">
              <span className="loading-thermal loading-thermal-1" />
              <span className="loading-thermal loading-thermal-2" />
              <span className="loading-thermal loading-thermal-3" />
              <span className="loading-thermal loading-thermal-4" />
            </div>
            <div className="loading-drizzle" aria-hidden="true">
              <span className="loading-drizzle-drop loading-drizzle-drop-1" />
              <span className="loading-drizzle-drop loading-drizzle-drop-2" />
              <span className="loading-drizzle-drop loading-drizzle-drop-3" />
              <span className="loading-drizzle-drop loading-drizzle-drop-4" />
              <span className="loading-drizzle-drop loading-drizzle-drop-5" />
            </div>
            <div className="loading-copy">
              <strong>PolyWeather</strong>
              <span>{t("dashboard.loading")}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PolyWeatherDashboard() {
  return (
    <I18nProvider>
      <DashboardStoreProvider>
        <DashboardScreen />
      </DashboardStoreProvider>
    </I18nProvider>
  );
}
