"use client";

import { useEffect } from "react";
import styles from "./Dashboard.module.css";
import {
  DashboardStoreProvider,
  useDashboardStore,
} from "@/hooks/useDashboardStore";
import { CitySidebar } from "@/components/dashboard/CitySidebar";
import { DetailPanel } from "@/components/dashboard/DetailPanel";
import { FutureForecastModal } from "@/components/dashboard/FutureForecastModal";
import { GuideModal } from "@/components/dashboard/GuideModal";
import { HeaderBar } from "@/components/dashboard/HeaderBar";
import { HistoryModal } from "@/components/dashboard/HistoryModal";
import { MapCanvas } from "@/components/dashboard/MapCanvas";

function DashboardScreen() {
  const store = useDashboardStore();

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
      if (store.isGuideOpen) {
        store.closeGuide();
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
      <HeaderBar />
      <CitySidebar />
      <DetailPanel />
      <GuideModal />
      <HistoryModal />
      <FutureForecastModal />
      {showLoading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <span>正在获取气象数据，请稍候...</span>
        </div>
      )}
    </div>
  );
}

export function PolyWeatherDashboard() {
  return (
    <DashboardStoreProvider>
      <DashboardScreen />
    </DashboardStoreProvider>
  );
}
