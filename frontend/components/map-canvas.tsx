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

function shortName(name: string) {
  return name.length > 8 ? `${name.slice(0, 7)}.` : name;
}

const tempIcon = (
  city: CitySummary,
  selected: boolean,
) =>
  L.divIcon({
    className: "",
    html: `<div class="map-pill ${city.risk_level} ${selected ? "active" : ""}">${shortName(city.display_name)}</div>`,
    iconSize: [78, 30],
    iconAnchor: [39, 15],
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
          icon={tempIcon(city, selectedCity === city.name)}
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
