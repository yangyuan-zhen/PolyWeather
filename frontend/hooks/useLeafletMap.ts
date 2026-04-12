"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import {
  CityDetail,
  CityListItem,
  CitySummary,
  NearbyStation,
} from "@/lib/dashboard-types";
import { pickMapNearbyStations } from "@/lib/dashboard-utils";

interface UseLeafletMapArgs {
  cities: CityListItem[];
  cityDetailsByName: Record<string, CityDetail>;
  citySummariesByName: Record<string, CitySummary>;
  onClosePanel: () => void;
  onEnsureCityDetail: (
    cityName: string,
    force?: boolean,
    depth?: "panel" | "nearby" | "full",
  ) => Promise<CityDetail>;
  onMapInteractionChange: (active: boolean) => void;
  onRegisterStopMotion: (stopMotion: () => void) => void;
  onSelectCity: (cityName: string) => void;
  selectedCity: string | null;
  selectedDetail: CityDetail | null;
  suspendMotion: boolean;
  isLoadingDetail: boolean;
}

const AUTO_NEARBY_MIN_ZOOM = 8;
const AUTO_NEARBY_MAX_DISTANCE_M = 120000;
const AUTO_NEARBY_IDLE_REFRESH_DELAY_MS = 20_000;
const AUTO_NEARBY_MIN_REFRESH_INTERVAL_MS = 90_000;
const MAP_MAX_ZOOM = 19;
const CITY_MARKER_DISPLAY_OFFSETS: Record<
  string,
  { x: number; y: number; zIndexOffset?: number }
> = {
  // Shek Kong sits between the Hong Kong and Shenzhen cards and gets visually buried
  // by their wide marker bubbles. Shift only the rendered marker, not the true point.
  "shek kong": { x: 34, y: -26, zIndexOffset: 320 },
  "lau fau shan": { x: -40, y: 14, zIndexOffset: 300 },
};

function getMarkerDisplayOffset(cityName: string) {
  return CITY_MARKER_DISPLAY_OFFSETS[String(cityName || "").toLowerCase()] || {
    x: 0,
    y: 0,
    zIndexOffset: 0,
  };
}

function createMarkerIcon(
  city: CityListItem,
  snapshot?: Pick<CityDetail, "current" | "temp_symbol"> | CitySummary,
) {
  const riskClass = `risk-${city.risk_level}`;
  const label = city.display_name;
  const unit = city.temp_unit === "fahrenheit" ? "°F" : "°C";
  const shortName = label.length > 10 ? `${label.substring(0, 8)}...` : label;
  const tempText =
    snapshot?.current?.temp != null ? `${snapshot.current.temp}${unit}` : "--";
  const offset = getMarkerDisplayOffset(city.name);
  const styleAttr =
    offset.x || offset.y
      ? ` style="transform: translate(${offset.x}px, ${offset.y}px);"`
      : "";

  return L.divIcon({
    className: "",
    html: `
      <div class="city-marker" data-city="${city.name}"${styleAttr}>
        <div class="marker-bubble ${riskClass}">${tempText}</div>
        <div class="marker-name">${shortName}</div>
      </div>
    `,
    iconAnchor: [40, 22],
    iconSize: [80, 44],
  });
}

function getMarkerSignature(
  city: CityListItem,
  snapshot?: Pick<CityDetail, "current" | "temp_symbol"> | CitySummary,
) {
  return [
    city.display_name,
    city.risk_level,
    city.temp_unit,
    city.lat,
    city.lon,
    snapshot?.current?.temp ?? "",
  ].join("|");
}

function buildNearbyIconHtml(detail: CityDetail, station: NearbyStation) {
  const sanitizeWindText = (value?: string | null) => {
    const text = String(value || "").trim();
    if (!text || text === "9999") return "";
    return text;
  };
  const symbol = detail.temp_symbol || "°C";
  const rawLabel =
    station.station_label ||
    station.name ||
    station.station_code ||
    station.icao ||
    "实测 (OBS)";
  const label =
    String(station.source_code || station.source_label || "").trim().toLowerCase() === "nmc" &&
    /\(NMC\)$/i.test(String(rawLabel)) &&
    !String(rawLabel).includes("区域实况")
      ? String(rawLabel).replace(/\s*\(NMC\)$/i, "区域实况 (NMC)")
      : rawLabel;
  let windHtml = "";
  const windDirectionText = sanitizeWindText(station.wind_direction_text);
  const windPowerText = sanitizeWindText(station.wind_power_text);

  if (station.wind_dir != null) {
    const rotation = (Number(station.wind_dir) + 180) % 360;
    const speedRaw = Number(station.wind_speed ?? station.wind_speed_kt);
    const speed = Number.isFinite(speedRaw) ? `${speedRaw.toFixed(1)}k` : "";
    windHtml = `
      <div class="nearby-wind">
        <span class="wind-arrow" style="transform: rotate(${rotation}deg)">↑</span>
        <span class="wind-val">${speed}</span>
      </div>
    `;
  } else if (windDirectionText || windPowerText) {
    const windText = [windDirectionText, windPowerText].filter(Boolean).join(" ");
    windHtml = `
      <div class="nearby-wind">
        <span class="wind-val">${windText}</span>
      </div>
    `;
  }

  return `
    <div class="nearby-marker-premium">
      <div class="nearby-pulse">
        <div class="pulse-ring"></div>
        <div class="pulse-core"></div>
      </div>
      <div class="nearby-content">
        <span class="nearby-label">${label}</span>
        <div class="nearby-stats">
          <span class="nearby-temp-val">${station.temp ?? "--"}</span>
          <span class="nearby-temp-unit">${symbol}</span>
        </div>
      </div>
      ${windHtml}
    </div>
  `;
}

function getNearbyMarkerDisplayOffset(
  detail: CityDetail,
  station: NearbyStation,
  index: number,
) {
  const cityLat = Number(detail.lat);
  const cityLon = Number(detail.lon);
  const stationLat = Number(station.lat);
  const stationLon = Number(station.lon);

  if (
    !Number.isFinite(cityLat) ||
    !Number.isFinite(cityLon) ||
    !Number.isFinite(stationLat) ||
    !Number.isFinite(stationLon)
  ) {
    return { x: 0, y: 0 };
  }

  const latDiff = Math.abs(cityLat - stationLat);
  const lonDiff = Math.abs(cityLon - stationLon);
  const isNearCityAnchor = latDiff < 0.02 && lonDiff < 0.02;

  if (!isNearCityAnchor) {
    return { x: 0, y: 0 };
  }

  const presets = [
    { x: 0, y: -58 },
    { x: 76, y: -34 },
    { x: -76, y: -34 },
    { x: 72, y: 34 },
    { x: -72, y: 34 },
  ];

  return presets[index % presets.length];
}

export function useLeafletMap({
  cities,
  cityDetailsByName,
  citySummariesByName,
  onClosePanel,
  onEnsureCityDetail,
  onMapInteractionChange,
  onRegisterStopMotion,
  onSelectCity,
  selectedCity,
  selectedDetail,
  suspendMotion,
  isLoadingDetail,
}: UseLeafletMapArgs) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<
    Record<string, { city: CityListItem; marker: L.Marker }>
  >({});
  const nearbyLayerRef = useRef<L.LayerGroup | null>(null);
  const autoNearbyCityRef = useRef<string | null>(null);
  const loadingAutoNearbyRef = useRef(false);
  const handlingAutoNearbyRef = useRef(false);
  const lastMovedCityRef = useRef<string | null>(null);
  const suspendMotionRef = useRef(suspendMotion);
  const hasFittedInitialBoundsRef = useRef(false);
  const onClosePanelRef = useRef(onClosePanel);
  const onRegisterStopMotionRef = useRef(onRegisterStopMotion);
  const onSelectCityRef = useRef(onSelectCity);
  const onEnsureCityDetailRef = useRef(onEnsureCityDetail);
  const onMapInteractionChangeRef = useRef(onMapInteractionChange);
  const interactionIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const nearbyRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastNearbyRefreshAtRef = useRef<Record<string, number>>({});

  useEffect(() => {
    onClosePanelRef.current = onClosePanel;
  }, [onClosePanel]);

  useEffect(() => {
    onRegisterStopMotionRef.current = onRegisterStopMotion;
  }, [onRegisterStopMotion]);

  useEffect(() => {
    onSelectCityRef.current = onSelectCity;
  }, [onSelectCity]);

  useEffect(() => {
    onEnsureCityDetailRef.current = onEnsureCityDetail;
  }, [onEnsureCityDetail]);

  useEffect(() => {
    onMapInteractionChangeRef.current = onMapInteractionChange;
  }, [onMapInteractionChange]);

  useEffect(() => {
    suspendMotionRef.current = suspendMotion;
  }, [suspendMotion]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      attributionControl: true,
      bounceAtZoomLimits: false,
      center: [30, 10],
      maxZoom: MAP_MAX_ZOOM,
      minZoom: 2,
      zoom: 3,
      zoomControl: false,
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 19,
        subdomains: "abcd",
      },
    ).addTo(map);

    const nearbyLayer = L.layerGroup().addTo(map);
    mapRef.current = map;
    nearbyLayerRef.current = nearbyLayer;

    // Track which city we've already moved to for the current selection
    onRegisterStopMotionRef.current(() => {
      map.stop();
    });

    const handleMapClick = () => {
      onClosePanelRef.current();
    };
    map.on("click", handleMapClick);

    const markInteracting = () => {
      if (interactionIdleTimerRef.current) {
        clearTimeout(interactionIdleTimerRef.current);
        interactionIdleTimerRef.current = null;
      }
      if (nearbyRefreshTimerRef.current) {
        clearTimeout(nearbyRefreshTimerRef.current);
        nearbyRefreshTimerRef.current = null;
      }
      onMapInteractionChangeRef.current(true);
    };

    const markIdleSoon = () => {
      if (interactionIdleTimerRef.current) {
        clearTimeout(interactionIdleTimerRef.current);
      }
      interactionIdleTimerRef.current = setTimeout(() => {
        interactionIdleTimerRef.current = null;
        onMapInteractionChangeRef.current(false);
      }, 700);
    };

    map.on("movestart", markInteracting);
    map.on("zoomstart", markInteracting);
    map.on("dragstart", markInteracting);
    map.on("moveend", markIdleSoon);
    map.on("zoomend", markIdleSoon);

    return () => {
      onRegisterStopMotionRef.current(() => {});
      if (interactionIdleTimerRef.current) {
        clearTimeout(interactionIdleTimerRef.current);
        interactionIdleTimerRef.current = null;
      }
      if (nearbyRefreshTimerRef.current) {
        clearTimeout(nearbyRefreshTimerRef.current);
        nearbyRefreshTimerRef.current = null;
      }
      onMapInteractionChangeRef.current(false);
      map.off("movestart", markInteracting);
      map.off("zoomstart", markInteracting);
      map.off("dragstart", markInteracting);
      map.off("moveend", markIdleSoon);
      map.off("zoomend", markIdleSoon);
      map.off("click", handleMapClick);
      map.remove();
      mapRef.current = null;
      nearbyLayerRef.current = null;
      markersRef.current = {};
    };
  }, []);

  // Handle initial view if cities are loaded
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !cities.length || hasFittedInitialBoundsRef.current) return;

    // Only run fitBounds once for the initial list of cities
    const bounds = cities.map((city) => [city.lat, city.lon]) as [
      number,
      number,
    ][];
    if (bounds.length) {
      map.fitBounds(bounds, {
        animate: false,
        maxZoom: 4,
        padding: [60, 60],
      });
      hasFittedInitialBoundsRef.current = true;
    }
  }, [cities]);

  const lastCityDataRef = useRef<
    Record<string, string>
  >({});

  // Handle marker synchronization
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !cities.length) return;
    let canceled = false;
    const frameId =
      typeof window !== "undefined"
        ? window.requestAnimationFrame(() => {
            if (canceled) return;

            const currentMarkers = markersRef.current;
            const cityNames = new Set(cities.map((city) => city.name));

            Object.entries(currentMarkers).forEach(([name, entry]) => {
              if (cityNames.has(name)) return;
              map.removeLayer(entry.marker);
              delete currentMarkers[name];
              delete lastCityDataRef.current[name];
            });

            cities.forEach((city) => {
              const detail = cityDetailsByName[city.name];
              const summary = citySummariesByName[city.name];
              const snapshot = detail || summary;
              const existing = currentMarkers[city.name];
              const signature = getMarkerSignature(city, snapshot);
              const previousSignature = lastCityDataRef.current[city.name];

              if (existing) {
                if (existing.city.lat !== city.lat || existing.city.lon !== city.lon) {
                  existing.marker.setLatLng([city.lat, city.lon]);
                }
                if (previousSignature !== signature) {
                  existing.marker.setIcon(createMarkerIcon(city, snapshot));
                }
                currentMarkers[city.name] = { city, marker: existing.marker };
                lastCityDataRef.current[city.name] = signature;
                return;
              }

              // Create new marker
              const marker = L.marker([city.lat, city.lon], {
                icon: createMarkerIcon(city, snapshot),
                zIndexOffset: getMarkerDisplayOffset(city.name).zIndexOffset || 0,
              }).addTo(map);

              marker.on("click", () => {
                const currentMap = mapRef.current;
                currentMap?.stop();
                if (currentMap && !suspendMotion) {
                  currentMap.flyTo([city.lat, city.lon], 11, {
                    animate: true,
                    duration: 1.05,
                    easeLinearity: 0.22,
                  });
                  lastMovedCityRef.current = city.name;
                } else {
                  lastMovedCityRef.current = null;
                }
                onSelectCityRef.current(city.name);
              });

              currentMarkers[city.name] = { city, marker };
              lastCityDataRef.current[city.name] = signature;
            });
          })
        : null;

    return () => {
      canceled = true;
      if (frameId != null && typeof window !== "undefined") {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [cities, cityDetailsByName, citySummariesByName]);

  useEffect(() => {
    Object.entries(markersRef.current).forEach(([name, entry]) => {
      const element = entry.marker.getElement();
      if (!element) return;
      const markerRoot = element.querySelector(".city-marker");
      markerRoot?.classList.toggle("selected", name === selectedCity);
    });
  }, [selectedCity]);

  useEffect(() => {
    if (!mapRef.current || !nearbyLayerRef.current) return;
    const map = mapRef.current;
    const layer = nearbyLayerRef.current;
    const clearNearbyRefreshTimer = () => {
      if (nearbyRefreshTimerRef.current) {
        clearTimeout(nearbyRefreshTimerRef.current);
        nearbyRefreshTimerRef.current = null;
      }
    };

    function renderNearbyStations(detail: CityDetail, preserveView = false) {
      layer.clearLayers();

      const nearbyStations = pickMapNearbyStations(detail);

      if (!nearbyStations.length) {
        if (!preserveView && detail.lat != null && detail.lon != null) {
          map.flyTo([detail.lat, detail.lon], 10, {
            animate: true,
            duration: 1.5,
            easeLinearity: 0.25,
          });
        }
        return;
      }

      const latLngs: Array<[number, number]> = [];
      if (detail.lat != null && detail.lon != null) {
        latLngs.push([detail.lat, detail.lon]);
      }

      nearbyStations.forEach((station) => {
        const sLat = Number(station.lat);
        const sLon = Number(station.lon);
        // Ignore invalid (0,0) or null coordinates which cause global zoom-out
        if (!Number.isFinite(sLat) || !Number.isFinite(sLon)) return;
      if (Math.abs(sLat) < 0.1 && Math.abs(sLon) < 0.1) return;

        const displayOffset = getNearbyMarkerDisplayOffset(detail, station, latLngs.length);
        const styleAttr =
          displayOffset.x || displayOffset.y
            ? ` style="transform: translate(${displayOffset.x}px, ${displayOffset.y}px);"`
            : "";

        const icon = L.divIcon({
          className: "",
          html: `
            <div class="nearby-marker-shell"${styleAttr}>
              ${buildNearbyIconHtml(detail, station)}
            </div>
          `,
          iconAnchor: [16, 19],
          iconSize: [240, 38],
        });
        L.marker([sLat, sLon], {
          icon,
          interactive: false,
          keyboard: false,
          bubblingMouseEvents: false,
        }).addTo(layer);
        latLngs.push([sLat, sLon]);
      });

      if (preserveView) return;

      // Note: Movement for selected cities is now handled by the centralized effect.
      // This section is primarily for auto-discovery movement if needed.
    }

    function scheduleIdleNearbyRefresh(targetCity: string | null) {
      clearNearbyRefreshTimer();
      if (!targetCity || suspendMotion) return;
      if (map.getZoom() < AUTO_NEARBY_MIN_ZOOM) return;

      nearbyRefreshTimerRef.current = setTimeout(async () => {
        nearbyRefreshTimerRef.current = null;
        if (loadingAutoNearbyRef.current || handlingAutoNearbyRef.current) return;
        if (!mapRef.current || mapRef.current.getZoom() < AUTO_NEARBY_MIN_ZOOM) return;
        if (autoNearbyCityRef.current !== targetCity) return;

        const lastRefreshAt = lastNearbyRefreshAtRef.current[targetCity] || 0;
        if (Date.now() - lastRefreshAt < AUTO_NEARBY_MIN_REFRESH_INTERVAL_MS) {
          return;
        }

        loadingAutoNearbyRef.current = true;
        lastNearbyRefreshAtRef.current[targetCity] = Date.now();
        try {
          const detail = await onEnsureCityDetailRef.current(
            targetCity,
            true,
            "nearby",
          );
          if (autoNearbyCityRef.current !== targetCity) return;
          renderNearbyStations(detail, true);
        } catch {
        } finally {
          loadingAutoNearbyRef.current = false;
        }
      }, AUTO_NEARBY_IDLE_REFRESH_DELAY_MS);
    }

    async function maybeAutoShowNearbyStations() {
      if (handlingAutoNearbyRef.current) {
        return;
      }
      handlingAutoNearbyRef.current = true;
      try {
        if (selectedDetail) {
          const selectedNearbyStations = pickMapNearbyStations(selectedDetail);
          if (selectedNearbyStations.length) {
            // Just render stations, no camera move from here
            renderNearbyStations(selectedDetail, true);
            autoNearbyCityRef.current = selectedCity || selectedDetail.name || null;
            scheduleIdleNearbyRefresh(autoNearbyCityRef.current);
            return;
          }
        }

        if (suspendMotion) {
          clearNearbyRefreshTimer();
          return;
        }

        // If no city selected, reset the move tracker
        lastMovedCityRef.current = null;

        if (map.getZoom() < AUTO_NEARBY_MIN_ZOOM) {
          autoNearbyCityRef.current = null;
          clearNearbyRefreshTimer();
          layer.clearLayers();
          return;
        }

        const center = map.getCenter();
        let best: { cityName: string; distance: number } | null = null;
        for (const [cityName, entry] of Object.entries(markersRef.current)) {
          const distance = map.distance(
            center,
            L.latLng(entry.city.lat, entry.city.lon),
          );
          if (distance > AUTO_NEARBY_MAX_DISTANCE_M) continue;
          if (!best || distance < best.distance) {
            best = { cityName, distance };
          }
        }

        const targetCity = selectedCity || best?.cityName || null;
        if (!targetCity) {
          autoNearbyCityRef.current = null;
          clearNearbyRefreshTimer();
          layer.clearLayers();
          return;
        }

        if (
          autoNearbyCityRef.current === targetCity &&
          layer.getLayers().length > 0
        ) {
          scheduleIdleNearbyRefresh(targetCity);
          return;
        }

        autoNearbyCityRef.current = targetCity;
        const cachedDetail = cityDetailsByName[targetCity];
        if (cachedDetail && pickMapNearbyStations(cachedDetail).length) {
          renderNearbyStations(cachedDetail, true);
          scheduleIdleNearbyRefresh(targetCity);
          return;
        }

        if (loadingAutoNearbyRef.current) return;
        loadingAutoNearbyRef.current = true;
        try {
          const detail = await onEnsureCityDetailRef.current(
            targetCity,
            false,
            "nearby",
          );
          renderNearbyStations(detail, true);
          scheduleIdleNearbyRefresh(targetCity);
        } catch {
        } finally {
          loadingAutoNearbyRef.current = false;
        }
      } finally {
        handlingAutoNearbyRef.current = false;
      }
    }

    const syncVisibility = () => {
      if (map.getZoom() < 7) {
        if (map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      } else if (!map.hasLayer(layer)) {
        map.addLayer(layer);
      }
      void maybeAutoShowNearbyStations();
    };

    syncVisibility();
    map.on("zoomend", syncVisibility);
    map.on("moveend", maybeAutoShowNearbyStations);

    return () => {
      clearNearbyRefreshTimer();
      map.off("zoomend", syncVisibility);
      map.off("moveend", maybeAutoShowNearbyStations);
    };
  }, [cityDetailsByName, selectedCity, selectedDetail, suspendMotion]);

  // Centralized City Selection Zoom Effect
  // Higher level than selection: we only flyTo once the data is loaded (selectedDetail)
  // This satisfies "loading之后再出现动画吧"
  useEffect(() => {
    if (!selectedCity) {
      lastMovedCityRef.current = null;
      return;
    }

    const map = mapRef.current;
    if (!map || suspendMotion || !selectedDetail || isLoadingDetail) return;

    // Check if the detail matches the selection (case-insensitive)
    if (selectedDetail.name?.toLowerCase() !== selectedCity.toLowerCase()) {
      return;
    }

    if (lastMovedCityRef.current === selectedCity) return;

    const entry = markersRef.current[selectedCity];
    if (!entry) return;

    // Lock the move
    lastMovedCityRef.current = selectedCity;

    // We use a micro-delay (50ms) to allow the browser to settle
    // after the loading overlay disappears and the detail panel renders.
    const timer = setTimeout(() => {
      const currentMap = mapRef.current;
      if (
        !currentMap ||
        lastMovedCityRef.current !== selectedCity ||
        suspendMotion
      )
        return;

      currentMap.stop();
      currentMap.flyTo([entry.city.lat, entry.city.lon], 11, {
        animate: true,
        duration: 1.1,
        easeLinearity: 0.22,
      });
    }, 50);

    return () => clearTimeout(timer);
  }, [selectedCity, selectedDetail, suspendMotion, isLoadingDetail]);

  useEffect(() => {
    if (!suspendMotion) return;
    mapRef.current?.stop();
  }, [suspendMotion]);

  return { containerRef };
}
