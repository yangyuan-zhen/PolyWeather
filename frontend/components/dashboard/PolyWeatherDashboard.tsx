"use client";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import styles from "./Dashboard.module.css";
import {
  DashboardStoreProvider,
  useDashboardStore,
} from "@/hooks/useDashboardStore";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import { CitySidebar } from "@/components/dashboard/CitySidebar";
import { DetailPanel } from "@/components/dashboard/DetailPanel";
import { HeaderBar } from "@/components/dashboard/HeaderBar";

const MapCanvas = dynamic(
  () =>
    import("@/components/dashboard/MapCanvas").then((module) => module.MapCanvas),
  {
    ssr: false,
    loading: () => <div className="map" aria-hidden="true" />,
  },
);

const HistoryModal = dynamic(
  () =>
    import("@/components/dashboard/HistoryModal").then(
      (module) => module.HistoryModal,
    ),
  {
    ssr: false,
    loading: () => null,
  },
);

const FutureForecastModal = dynamic(
  () =>
    import("@/components/dashboard/FutureForecastModal").then(
      (module) => module.FutureForecastModal,
    ),
  {
    ssr: false,
    loading: () => null,
  },
);

function DashboardScreen() {
  const store = useDashboardStore();
  const { t } = useI18n();
  const activeCityName =
    store.selectedDetail?.display_name ||
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

  return (
    <div className={styles.root}>
      <MapCanvas />
      <HeaderBar />
      <CitySidebar />
      <DetailPanel />
      {store.loadingState.cityDetail && activeCityName ? (
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
