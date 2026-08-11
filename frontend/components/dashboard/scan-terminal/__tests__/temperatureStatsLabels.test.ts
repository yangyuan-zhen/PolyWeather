import {
  __buildDebEnsembleLabelForTest,
  __buildDebQualityClassForTest,
  __buildDebQualityLabelForTest,
  __buildDebQualityTitleForTest,
  __buildTemperatureStatsLabelsForTest,
} from "@/components/dashboard/scan-terminal/TemperatureStatsBars";
import { temp } from "@/components/dashboard/scan-terminal/utils";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const hongKong = __buildTemperatureStatsLabelsForTest({
    isEn: true,
    isShenzhen: false,
    metarRedundant: false,
    obsHeaderLabel: "参考站点 (1分钟)",
    metarHeaderLabel: "天文台实测 (10分钟)",
    obsHighLabel: "参考站点",
    metarHighLabel: "天文台",
  });

  assert(hongKong.primary === "Reference Station (1m)", "Hong Kong English primary label should match 参考站点 (1分钟)");
  assert(hongKong.compactSecondary === "HKO Live (10m)", "Hong Kong compact secondary label should match 天文台实测 (10分钟)");
  assert(hongKong.expandedSecondary === "HKO Live (10m) · Daily High", "Hong Kong expanded secondary label should include HKO plus Daily High");
  assert(hongKong.obsHigh === "Reference Station", "Hong Kong high summary should translate 参考站点");
  assert(hongKong.metarHigh === "HKO", "Hong Kong high summary should translate 天文台");

  const shenzhen = __buildTemperatureStatsLabelsForTest({
    isEn: true,
    isShenzhen: true,
    metarRedundant: false,
    obsHeaderLabel: "天文台实测 (10分钟)",
    metarHeaderLabel: "天文台实测 (10分钟)",
    obsHighLabel: "天文台实测",
    metarHighLabel: "天文台",
  });

  assert(shenzhen.primary === "HKO Live (10m)", "Shenzhen English primary label should match 天文台实测 (10分钟)");
  assert(shenzhen.compactSecondary === "Daily High", "Shenzhen compact secondary label should match 当日最高");
  assert(shenzhen.expandedSecondary === "HKO Live (10m) · Daily High", "Shenzhen expanded secondary label should match 天文台实测 + 当日最高");
  assert(shenzhen.obsHigh === "HKO Live", "Shenzhen high summary should translate 天文台实测");
  assert(shenzhen.metarHigh === "HKO", "Shenzhen high summary should translate 天文台");


  const zh = __buildTemperatureStatsLabelsForTest({
    isEn: false,
    isShenzhen: true,
    metarRedundant: false,
    obsHeaderLabel: "天文台实测 (10分钟)",
    metarHeaderLabel: "天文台实测 (10分钟)",
    obsHighLabel: "天文台实测",
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
  const supportingSignal = {
    available: true,
    stance: "supporting",
    label_zh: "集合支撑",
    label_en: "Ensemble support",
    reason_zh: "集合区间较窄",
    reason_en: "Ensemble spread is tight",
  };
  assert(
    __buildDebEnsembleLabelForTest(supportingSignal, false) === "集+",
    "supporting ensemble signal should render a compact Chinese marker",
  );
  const plainMetar = __buildTemperatureStatsLabelsForTest({
    isEn: false,
    isShenzhen: false,
    metarRedundant: true,
    obsHeaderLabel: "机场报文",
    metarHeaderLabel: "METAR 结算 (30分钟)",
    obsHighLabel: "机场报文",
    metarHighLabel: "METAR 官方",
  });
  assert(
    plainMetar.expandedSecondary === "当日最高" && plainMetar.compactSecondary === "当日最高",
    "plain METAR cities must collapse the secondary METAR block to the daily high instead of duplicating it",
  );

  assert(
    __buildDebEnsembleLabelForTest({ ...supportingSignal, stance: "caution" }, true) === "Ens!",
    "caution ensemble signal should render a compact English marker",
  );
  assert(
    __buildDebQualityClassForTest({
      recommendation: "primary",
      quality_tier: "high",
      ensemble_signal: { ...supportingSignal, stance: "caution" },
    }).includes("amber"),
    "ensemble caution should override the DEB quality badge color",
  );
  assert(
    __buildDebQualityTitleForTest(
      { recommendation: "primary", ensemble_signal: supportingSignal },
      false,
    ).includes("集合支撑"),
    "DEB badge title should include the ensemble signal reason",
  );
}
