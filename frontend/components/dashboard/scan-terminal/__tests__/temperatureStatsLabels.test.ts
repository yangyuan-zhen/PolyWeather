import { __buildDebQualityLabelForTest, __buildTemperatureStatsLabelsForTest } from "@/components/dashboard/scan-terminal/TemperatureStatsBars";
import { temp } from "@/components/dashboard/scan-terminal/utils";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const hongKong = __buildTemperatureStatsLabelsForTest({
    isEn: true,
    isShenzhen: false,
    runwayHeaderLabel: "参考站点 (1分钟)",
    metarHeaderLabel: "天文台实测 (10分钟)",
    runwayHighLabel: "参考站点",
    metarHighLabel: "天文台",
  });

  assert(hongKong.primary === "Reference Station (1m)", "Hong Kong English primary label should match 参考站点 (1分钟)");
  assert(hongKong.compactSecondary === "HKO Live (10m)", "Hong Kong compact secondary label should match 天文台实测 (10分钟)");
  assert(hongKong.expandedSecondary === "HKO Live (10m) · Daily High", "Hong Kong expanded secondary label should include HKO plus Daily High");
  assert(hongKong.runwayHigh === "Reference Station", "Hong Kong high summary should translate 参考站点");
  assert(hongKong.metarHigh === "HKO", "Hong Kong high summary should translate 天文台");

  const shenzhen = __buildTemperatureStatsLabelsForTest({
    isEn: true,
    isShenzhen: true,
    runwayHeaderLabel: "天文台实测 (10分钟)",
    metarHeaderLabel: "天文台实测 (10分钟)",
    runwayHighLabel: "天文台实测",
    metarHighLabel: "天文台",
  });

  assert(shenzhen.primary === "HKO Live (10m)", "Shenzhen English primary label should match 天文台实测 (10分钟)");
  assert(shenzhen.compactSecondary === "Daily High", "Shenzhen compact secondary label should match 当日最高");
  assert(shenzhen.expandedSecondary === "HKO Live (10m) · Daily High", "Shenzhen expanded secondary label should match 天文台实测 + 当日最高");
  assert(shenzhen.runwayHigh === "HKO Live", "Shenzhen high summary should translate 天文台实测");
  assert(shenzhen.metarHigh === "HKO", "Shenzhen high summary should translate 天文台");

  const shanghai = __buildTemperatureStatsLabelsForTest({
    isEn: true,
    isShenzhen: false,
    runwayHeaderLabel: "跑道实测 (3分钟)",
    metarHeaderLabel: "METAR 结算 (30分钟)",
    runwayHighLabel: "跑道实测",
    metarHighLabel: "METAR 官方",
  });

  assert(shanghai.primary === "Runway Live (3m)", "AMSC English primary label should match 跑道实测 (3分钟)");
  assert(shanghai.runwayHigh === "Runway", "AMSC runway high label should remain Runway");

  const zh = __buildTemperatureStatsLabelsForTest({
    isEn: false,
    isShenzhen: true,
    runwayHeaderLabel: "天文台实测 (10分钟)",
    metarHeaderLabel: "天文台实测 (10分钟)",
    runwayHighLabel: "天文台实测",
    metarHighLabel: "天文台",
  });

  assert(zh.primary === "天文台实测 (10分钟)", "Chinese primary label should remain unchanged");
  assert(zh.compactSecondary === "当日最高", "Chinese Shenzhen compact secondary label should remain 当日最高");

  assert(temp(null, "°C") === "--", "empty temperature values should not render as 0.0°C while city detail is loading");
  assert(temp(undefined, "°C") === "--", "undefined temperature values should not render as 0.0°C while city detail is loading");
  assert(temp("", "°C") === "--", "blank temperature values should not render as 0.0°C while city detail is loading");
  assert(
    __buildDebQualityLabelForTest({ recommendation: "context_only" }, true) === "Context",
    "low-confidence DEB should render as context-only guidance in English",
  );
  assert(
    __buildDebQualityLabelForTest({ recommendation: "insufficient" }, false) === "样本少",
    "thin-sample DEB should render a Chinese low-sample label",
  );
}
