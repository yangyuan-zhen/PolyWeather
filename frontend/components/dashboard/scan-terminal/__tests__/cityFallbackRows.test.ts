import { cityListItemsToScanRows } from "@/components/dashboard/scan-terminal/city-fallback-rows";
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
  assert(
    dashboardSource.includes("cityListItemsToScanRows") &&
      dashboardSource.includes("/api/cities") &&
      dashboardSource.includes("cityFallbackRows"),
    "terminal dashboard should use /api/cities fallback rows when scan terminal rows are not ready",
  );
}
