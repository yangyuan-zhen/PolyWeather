"use client";

import "leaflet/dist/leaflet.css";

import { useDashboardStore } from "@/hooks/useDashboardStore";
import { useLeafletMap } from "@/hooks/useLeafletMap";

export function MapCanvas({
  onCitySelect,
  selectionMode = "focus",
}: {
  onCitySelect?: (cityName: string) => void;
  selectionMode?: "focus" | "select";
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
      if (selectionMode === "select") {
        void store.selectCity(cityName);
        return;
      }
      void store.focusCity(cityName);
    },
    selectedCity: store.selectedCity,
    selectedDetail: store.selectedDetail,
    suspendMotion: Boolean(store.futureModalDate),
    isLoadingDetail: store.loadingState.cityDetail,
  });

  return <div ref={containerRef} className="map" />;
}
