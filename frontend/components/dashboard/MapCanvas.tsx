"use client";

import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useLeafletMap } from "@/hooks/useLeafletMap";

export function MapCanvas() {
  const store = useDashboardStore();
  const { containerRef } = useLeafletMap({
    cities: store.cities,
    cityDetailsByName: store.cityDetailsByName,
    citySummariesByName: store.citySummariesByName,
    onClosePanel: store.closePanel,
    onEnsureCityDetail: store.ensureCityDetail,
    onRegisterStopMotion: store.registerMapStopMotion,
    onSelectCity: (cityName) => {
      void store.selectCity(cityName);
    },
    selectedCity: store.selectedCity,
    selectedDetail: store.selectedDetail,
    suspendMotion:
      Boolean(store.futureModalDate) ||
      store.historyState.isOpen ||
      store.isGuideOpen,
    isLoadingDetail: store.loadingState.cityDetail,
  });

  return <div ref={containerRef} className="map" />;
}
