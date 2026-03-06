"use client";

import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CitySummary } from "@/lib/types";

type MapCanvasProps = {
  cities: CitySummary[];
  selectedCity: string | null;
  onSelectCity: (cityName: string) => void;
};

const tempIcon = (risk: CitySummary["risk_level"]) =>
  L.divIcon({
    className: "",
    html: `<div style="
      background:${risk === "high" ? "#ef4444" : risk === "medium" ? "#f59e0b" : "#10b981"};
      color:#fff;
      padding:6px 10px;
      border-radius:999px;
      font-size:12px;
      font-weight:700;
      box-shadow:0 2px 10px rgba(0,0,0,.4);
    ">${risk.toUpperCase()}</div>`,
    iconSize: [56, 28],
    iconAnchor: [28, 14],
  });

export function MapCanvas({ cities, selectedCity, onSelectCity }: MapCanvasProps) {
  return (
    <MapContainer center={[30, 10]} zoom={3} minZoom={2} className="h-full w-full">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      {cities.map((city) => (
        <Marker
          key={city.name}
          position={[city.lat, city.lon]}
          icon={tempIcon(city.risk_level)}
          eventHandlers={{ click: () => onSelectCity(city.name) }}
        >
          <Popup>
            <div className="text-sm">
              <p className="font-semibold">{city.display_name}</p>
              <p>Risk: {city.risk_level}</p>
              <p>{selectedCity === city.name ? "Selected" : "Click to open"}</p>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
