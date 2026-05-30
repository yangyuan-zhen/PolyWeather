import {
  cityListItemsToScanRows,
  mergeScanRowsWithCityFallbackRows,
} from "@/components/dashboard/scan-terminal/city-fallback-rows";
import type { CityListItem } from "@/lib/dashboard-types";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const dashboardSource = fs.readFileSync(
    path.join(process.cwd(), "components", "dashboard", "ScanTerminalDashboard.tsx"),
    "utf8",
  );
  const citiesRouteSource = fs.readFileSync(
    path.join(process.cwd(), "app", "api", "cities", "route.ts"),
    "utf8",
  );
  const staticCitiesPath = path.join(process.cwd(), "lib", "static-cities.ts");

  const cities: CityListItem[] = [
    {
      airport: "Taipei Songshan",
      display_name: "Taipei",
      icao: "RCSS",
      lat: 25.0697,
      lon: 121.5525,
      name: "taipei",
      risk_level: "medium",
      temp_unit: "celsius",
      utc_offset_seconds: 28800,
    },
    {
      airport: "LaGuardia",
      display_name: "New York",
      icao: "KLGA",
      lat: 40.7769,
      lon: -73.874,
      name: "new york",
      risk_level: "low",
      temp_unit: "fahrenheit",
      utc_offset_seconds: -14400,
    },
  ];

  const rows = cityListItemsToScanRows(cities);

  assert(rows.length === 2, "fallback rows should preserve every city");
  assert(rows[0].id === "city-fallback:taipei", "fallback row id should be stable");
  assert(rows[0].city === "taipei", "fallback row should keep canonical city key");
  assert(rows[0].city_display_name === "Taipei", "fallback row should keep display name");
  assert(rows[0].airport === "Taipei Songshan", "fallback row should expose airport for selector display");
  assert(rows[0].trading_region === "east_asia", "fallback row should derive region from timezone");
  assert(rows[0].temp_symbol === "°C", "celsius cities should use °C");
  assert(rows[1].trading_region === "north_america", "known cities should keep their configured product region");
  assert(rows[1].temp_symbol === "°F", "fahrenheit cities should use °F");

  const scanRows = [
    {
      id: "scan:paris",
      city: "paris",
      city_display_name: "Paris",
      current_temp: 31,
      deb_prediction: 30.5,
      temp_symbol: "°C",
    },
  ] as any[];
  const fallbackRows = cityListItemsToScanRows([
    {
      airport: "Paris Le Bourget",
      display_name: "Paris",
      icao: "LFPB",
      lat: 48.97,
      lon: 2.44,
      name: "paris",
      risk_level: "medium",
      temp_unit: "celsius",
      utc_offset_seconds: 7200,
    },
    {
      airport: "Munich Airport",
      display_name: "Munich",
      icao: "EDDM",
      lat: 48.35,
      lon: 11.78,
      name: "munich",
      risk_level: "medium",
      temp_unit: "celsius",
      utc_offset_seconds: 7200,
    },
    {
      airport: "Cape Town International",
      display_name: "Cape Town",
      icao: "FACT",
      lat: -33.97,
      lon: 18.6,
      name: "cape town",
      risk_level: "medium",
      temp_unit: "celsius",
      utc_offset_seconds: 7200,
    },
  ]);
  const merged = mergeScanRowsWithCityFallbackRows(scanRows, fallbackRows);
  const mergedCities = merged.map((row) => row.city);

  assert(merged.length === 3, "city selector data should include scan rows plus missing registry cities");
  assert(mergedCities.includes("paris"), "merged rows should keep scan city");
  assert(mergedCities.includes("munich"), "merged rows should include missing registry city");
  assert(mergedCities.includes("cape town"), "merged rows should include another missing registry city");
  assert(
    merged.filter((row) => row.city === "paris").length === 1,
    "merged rows should not duplicate cities already present in scan rows",
  );
  assert(
    merged.find((row) => row.city === "paris")?.current_temp === 31,
    "scan rows should win over fallback rows for cities already present",
  );

  assert(
    dashboardSource.includes("cityListItemsToScanRows") &&
      dashboardSource.includes("STATIC_CITY_LIST") &&
      dashboardSource.includes("useState<ScanOpportunityRow[]>(() =>") &&
      dashboardSource.includes("/api/cities") &&
      dashboardSource.includes("cityFallbackRows"),
    "terminal dashboard should seed fallback rows from the static city snapshot before refreshing /api/cities",
  );
  assert(fs.existsSync(staticCitiesPath), "/api/cities route should have a static city snapshot fallback");
  assert(
    citiesRouteSource.includes("STATIC_CITY_LIST") &&
      citiesRouteSource.includes("AbortController") &&
      citiesRouteSource.includes("x-polyweather-cities-source") &&
      citiesRouteSource.includes("static-fallback"),
    "/api/cities should return a quick static fallback when the backend city registry is cold or unavailable",
  );
}
