import type { CityDetail } from "@/lib/dashboard-types";
import { normalizeObservationSourceLabel } from "@/lib/source-labels";

export function isTurkishMgmCity(detail: CityDetail) {
  const city = String(detail.name || detail.display_name || "")
    .trim()
    .toLowerCase();
  return city === "ankara" || city === "istanbul";
}

export function getObservationSourceCode(detail: CityDetail): string {
  const source = String(detail.current?.settlement_source || "")
    .trim()
    .toLowerCase();
  if (source) return source;

  const city = String(detail.name || detail.display_name || "")
    .trim()
    .toLowerCase();
  if (
    city === "hong kong" ||
    city === "shek kong" ||
    city === "lau fau shan"
  ) {
    return "hko";
  }
  if (city === "taipei") return "noaa";
  return "metar";
}

export function getObservationSourceTag(detail: CityDetail): string {
  const label = normalizeObservationSourceLabel(
    detail.current?.settlement_source_label,
    "",
  )
    .trim()
    .toUpperCase();
  if (label) return label;
  const code = getObservationSourceCode(detail);
  if (code === "hko") return "HKO";
  if (code === "cwa") return "CWA";
  if (code === "noaa") return "NOAA";
  if (code === "wunderground") {
    const icao = String(detail.risk?.icao || detail.current?.station_code || "")
      .trim()
      .toUpperCase();
    return icao ? `${icao} METAR` : "METAR";
  }
  if (code === "mgm") return "MGM";
  return "METAR";
}

export function getRealtimeObservationTag(detail: CityDetail): string {
  const code = getObservationSourceCode(detail);
  if (code === "wunderground") {
    const icao = String(detail.risk?.icao || "").trim().toUpperCase();
    return icao ? `${icao} METAR` : "METAR";
  }
  return getObservationSourceTag(detail);
}

export function getNoaaStationCode(detail: CityDetail): string {
  return String(detail.current?.station_code || detail.risk?.icao || "NOAA")
    .trim()
    .toUpperCase();
}

export function getNoaaStationName(detail: CityDetail): string {
  return (
    String(detail.current?.station_name || "").trim() ||
    String(detail.risk?.airport || "").trim() ||
    getNoaaStationCode(detail)
  );
}
