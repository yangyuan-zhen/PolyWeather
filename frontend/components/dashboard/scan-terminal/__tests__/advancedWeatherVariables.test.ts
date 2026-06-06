import * as Chart from "@/components/dashboard/scan-terminal/LiveTemperatureThresholdChart";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const buildItems = (Chart as any).__buildAdvancedWeatherVariableItemsForTest;
  assert(typeof buildItems === "function", "advanced weather variable item builder should be exported for tests");
  const buildCadence = (Chart as any).__buildSourceCadenceSummaryForTest;
  assert(typeof buildCadence === "function", "source cadence summary builder should be exported for tests");

  const items = buildItems(
    {
      metar_context: {
        airport_wind_speed_kt: 7,
        airport_wind_dir: 220,
        airport_humidity: 68,
      },
    },
    {
      current: { dewpoint: 18.2 },
      airportPrimary: {
        wind_speed_kt: 9,
        wind_dir: 240,
        humidity: 64,
        pressure_hpa: 1009.4,
        source_label: "MADIS HFMETAR",
      },
    },
    false,
  );

  assert(items.length === 5, `expected five advanced variable items, got ${items.length}`);
  assert(items.some((item: any) => item.key === "wind_dir" && item.value === "240°"), "wind direction should prefer airport-primary detail data");
  assert(items.some((item: any) => item.key === "wind_speed" && item.value === "9 kt"), "wind speed should include kt units");
  assert(items.some((item: any) => item.key === "dewpoint" && item.value === "18.2°C"), "dew point should render from current conditions");
  assert(items.some((item: any) => item.key === "humidity" && item.value === "64%"), "humidity should render as a percentage");
  assert(items.some((item: any) => item.key === "pressure" && item.value === "1009.4 hPa"), "pressure should render as hPa");

  const emptyItems = buildItems({}, {}, true);
  assert(emptyItems.length === 0, "advanced variables should stay hidden when no source fields exist");

  const backendCadence = buildCadence(
    {},
    {
      airportPrimary: {
        source_code: "custom_source",
        source_label: "Custom Feed",
        freshness: { native_update_interval_sec: 420, freshness_status: "fresh" },
      },
    },
    true,
  );
  assert(backendCadence?.cadence === "420s", "source cadence should prefer backend native_update_interval_sec");
  assert(backendCadence?.label.includes("Custom Feed"), "source cadence should include the source label");

  const amscCadence = buildCadence({}, { airportPrimary: { source: "amsc_awos" } }, false);
  assert(amscCadence?.cadence === "180s", "AMSC AWOS should fall back to 180s source cadence");

  const amosCadence = buildCadence({}, { airportPrimary: { source_label: "AMOS runway" } }, false);
  assert(amosCadence?.cadence === "60s", "AMOS should fall back to 60s source cadence");

  const madisCadence = buildCadence({}, { airportPrimary: { source_code: "madis_hfmetar" } }, false);
  assert(madisCadence?.cadence === "300s", "MADIS should fall back to 300s source cadence");
}
