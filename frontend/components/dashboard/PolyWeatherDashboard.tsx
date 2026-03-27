"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
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

const WeatherAuraLayer = dynamic(
  () =>
    import("@/components/dashboard/WeatherAuraLayer").then(
      (module) => module.WeatherAuraLayer,
    ),
  {
    ssr: false,
    loading: () => null,
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

  useEffect(() => {
    void import("@/components/dashboard/HistoryModal");
    void import("@/components/dashboard/FutureForecastModal");
  }, []);

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
    store.loadingState.cityDetail ||
    store.loadingState.refresh;

  return (
    <div className={styles.root}>
      <MapCanvas />
      <WeatherAuraLayer />
      <HeaderBar />
      <CitySidebar />
      <DetailPanel />
      {store.historyState.isOpen && <HistoryModal />}
      {store.futureModalDate && <FutureForecastModal />}
      {showLoading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <span>{t("dashboard.loading")}</span>
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
