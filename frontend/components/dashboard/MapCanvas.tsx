"use client";

import "leaflet/dist/leaflet.css";

import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useLeafletMap } from "@/hooks/useLeafletMap";

export function MapCanvas({
  onCitySelect,
}: {
  onCitySelect?: (cityName: string) => void;
} = {}) {
  const store = useDashboardStore();
  const { containerRef } = useLeafletMap({
    cities: store.cities,
    cityDetailsByName: store.cityDetailsByName,
    citySummariesByName: store.citySummariesByName,
    onClosePanel: store.closePanel,
    onEnsureCityDetail: store.ensureCityDetail,
    onMapInteractionChange: store.setMapInteractionActive,
    onRegisterStopMotion: store.registerMapStopMotion,
    onSelectCity: (cityName) => {
      onCitySelect?.(cityName);
      void store.focusCity(cityName);
    },
    selectedCity: store.selectedCity,
    selectedDetail: store.selectedDetail,
    suspendMotion:
      Boolean(store.futureModalDate) ||
      store.historyState.isOpen,
    isLoadingDetail: store.loadingState.cityDetail,
  });

  return <div ref={containerRef} className="map" />;
}
