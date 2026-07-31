import fs from "node:fs";
import path from "node:path";
import {
  MODEL_SUMMARY_MODEL_COLUMNS,
  buildModelSummaryRows,
  filterModelSummaryRows,
  formatModelSummaryProbability,
  formatModelSummaryLocalTime,
  formatModelSummaryTemp,
  hasModelSummaryForecastData,
} from "@/lib/model-summary";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const rows = [
    {
      city: "beijing",
      city_display_name: "Beijing",
      trading_region_label: "East Asia",
      trading_region_label_zh: "东亚",
      trading_region_sort: 1,
      temp_symbol: "°C",
      current_max_so_far: 28,
      deb_prediction: 29.1,
      local_time: "18:46",
      tz_offset_seconds: 28800,
      model_cluster_sources: {
        ECMWF: 28.8,
        GFS: 29.4,
      },
    },
    {
      city: "paris",
      city_display_name: "Paris",
      trading_region_label: "Europe / Africa",
      trading_region_label_zh: "欧洲 / 非洲",
      trading_region_sort: 5,
      temp_symbol: "°C",
      current_max_so_far: 32,
      deb_prediction: 31.6,
      local_time: "2026-06-29T10:00",
      model_cluster_sources: {
        ECMWF: 32.2,
        "ECMWF AIFS": 31.9,
        GFS: 33.4,
        ICON: 31.2,
        "ICON-EU": 31.4,
        GEM: 32.8,
        GDPS: 32.5,
        JMA: 30.9,
        "AROME HD": 32.1,
      },
      distribution_full: [
        { value: 32, model_probability: 0.41, range: "[31.5~32.5)" },
        { value: 33, model_probability: 0.56, range: "[32.5~33.5)" },
        { value: 34, model_probability: 0.03, range: "[33.5~34.5)" },
      ],
      probability_engine: "deb_normal",
      all_buckets: [
        {
          label: "32°C",
          lower: 31.5,
          upper: 32.5,
        },
        {
          label: "33°C",
          lower: 32.5,
          upper: 33.5,
        },
        {
          label: "34°C",
          lower: 33.5,
          upper: 34.5,
        },
      ],
    },
    {
      city: "madrid",
      city_display_name: "Madrid",
      trading_region_label: "Europe / Africa",
      trading_region_label_zh: "欧洲 / 非洲",
      trading_region_sort: 5,
      temp_symbol: "°C",
      current_max_so_far: 34.2,
      deb_prediction: null,
      local_time: "2026-06-29T10:05",
      model_cluster_sources: {
        ECMWF: 37,
        GFS: 38.2,
      },
      distribution_preview: [
        { value: 35, probability: 0.18 },
        { value: 36, probability: 0.52 },
      ],
    },
    {
      city: "houston",
      city_display_name: "Houston",
      trading_region_label: "North America",
      trading_region_label_zh: "北美",
      trading_region_sort: 7,
      temp_symbol: "°F",
      current_max_so_far: 90,
      deb_prediction: 94.2,
      local_time: "09:30",
      model_cluster_sources: {
        ECMWF: 94,
        GFS: 96,
      },
      distribution_full: [
        { value: 94, probability: 0.4 },
        { value: 95, probability: 0.25 },
        { value: 96, probability: 0.08 },
        { value: 97, probability: 0.02 },
      ],
    },
    {
      city: "amsterdam",
      city_display_name: "Amsterdam",
      trading_region_label: "West Asia / Middle East",
      trading_region_label_zh: "西亚 / 中东",
      trading_region_sort: 4,
      temp_symbol: "°C",
      current_max_so_far: 16,
      deb_prediction: 17.1,
      local_time: "12:11",
      model_cluster_sources: {
        ECMWF: 15.6,
        GFS: 17.2,
      },
    },
  ] as any;
  const originalFirstModelSources = rows[0].model_cluster_sources;
  const summaryRows = buildModelSummaryRows(rows, false);
  const amsterdamRow = summaryRows.find((row) => row.cityName === "Amsterdam");
  const beijingRow = summaryRows.find((row) => row.cityName === "Beijing");
  const madridRow = summaryRows.find((row) => row.cityName === "Madrid");
  const parisRow = summaryRows.find((row) => row.cityName === "Paris");
  const houstonRow = summaryRows.find((row) => row.cityName === "Houston");

  assert(
    MODEL_SUMMARY_MODEL_COLUMNS.map((column) => column.key).includes("AROME HD") &&
      MODEL_SUMMARY_MODEL_COLUMNS.map((column) => column.key).includes("HRRR") &&
      MODEL_SUMMARY_MODEL_COLUMNS.map((column) => column.key).includes("NAM"),
    "model summary must expose the fixed model columns including optional short-range models",
  );
  assert(summaryRows.length === 5, "model summary should keep one row per city");
  assert(summaryRows[0].cityName === "Beijing", "model summary should sort by resolved region then city name");
  assert(amsterdamRow?.regionLabel === "欧洲 / 非洲", "model summary should override stale backend timezone regions for known European cities");
  if (!madridRow || !parisRow) throw new Error("model summary should keep European rows");
  assert(beijingRow?.localTime === "18:46", "model summary should keep stale source local_time only as a fallback");
  assert(
    beijingRow &&
      formatModelSummaryLocalTime(beijingRow, Date.parse("2026-06-29T12:05:00Z")) === "20:05",
    "model summary should display live local time from timezone offset instead of stale cached local_time",
  );
  assert(parisRow.debPrediction === 31.6, "model summary should preserve DEB prediction");
  assert(parisRow.models.GFS === 33.4, "model summary should preserve model high temperature");
  assert(parisRow.models.HRRR === null, "missing models should be normalized to null");
  assert(parisRow.modelMedian === 32.1, "model median should use available model values only");
  assert(parisRow.modelSpread === 2.5, "model spread should use available model min/max only");
  assert(parisRow.gaussianMu === 32.6, "model summary should compute distribution mu from probability buckets");
  assert(parisRow.probabilityEngine === "deb_normal", "model summary should preserve probability engine metadata");
  assert(parisRow.probabilityBuckets.length === 3, "model summary should keep every market-option probability bucket");
  assert(
    parisRow.probabilityBucketMap["32°C"]?.probability === 0.41 &&
      parisRow.probabilityBucketMap["33°C"]?.probability === 0.56 &&
      parisRow.topProbabilityBucketKey === "33°C" &&
      !parisRow.probabilityBucketMap["31.5-32.5°C"],
    "model summary should map Celsius probabilities to market option labels instead of half-degree ranges",
  );
  assert(
    houstonRow?.probabilityBucketMap["94-95°F"]?.probability === 0.65 &&
      houstonRow.probabilityBucketMap["96-97°F"]?.probability === 0.1 &&
      houstonRow.topProbabilityBucketKey === "94-95°F",
    "model summary should aggregate Fahrenheit probabilities into two-degree market option labels",
  );
  assert(parisRow.marketMatches.length === 3, "model summary should keep every Polymarket tradable bucket");
  assert(
    parisRow.marketMatches[0].label === "32°C" &&
      parisRow.marketMatches[0].modelProbability === null &&
      parisRow.marketMatches[0].marketUrl === null,
    "model summary should expose model probability for market-matched buckets without requiring market price",
  );
  assert(
    parisRow.marketMatches[1].label === "33°C" &&
      parisRow.marketMatches[1].modelProbability === null,
    "model summary should keep low-probability tradable buckets for manual NO review",
  );
  assert(formatModelSummaryProbability(null) === "—", "missing probability should render as an em dash");
  assert(formatModelSummaryProbability(0.424) === "42%", "probability buckets should render as rounded percentages");
  assert(formatModelSummaryTemp(null, "°C") === "—", "missing model temperatures should render as an em dash");
  assert(formatModelSummaryTemp(32.16, "°C") === "32.2°C", "model temperatures should render to one decimal");
  assert(hasModelSummaryForecastData(summaryRows), "model summary should recognize populated forecast rows");
  assert(
    !hasModelSummaryForecastData(
      buildModelSummaryRows([
        {
          id: "fallback:beijing",
          city: "beijing",
          city_display_name: "Beijing",
          trading_region_label: "East Asia",
          trading_region_label_zh: "东亚",
          trading_region_sort: 1,
          local_time: "21:11",
          tz_offset_seconds: 28800,
        },
      ] as any, false),
    ),
    "model summary should recognize fallback-only rows without DEB or model forecasts",
  );

  const searched = filterModelSummaryRows(summaryRows, {
    debOnly: true,
    query: "par",
    wideSpreadOnly: false,
  });
  assert(searched.length === 1 && searched[0].cityName === "Paris", "model summary search and DEB filter should compose");
  const wideSpread = filterModelSummaryRows(summaryRows, {
    debOnly: false,
    query: "",
    wideSpreadOnly: true,
  });
  assert(
    wideSpread.length === 2 &&
      wideSpread.some((row) => row.cityName === "Paris") &&
      wideSpread.some((row) => row.cityName === "Houston"),
    "wide-spread filter should only keep rows with model spread >= 2°C",
  );
  assert(rows[0].model_cluster_sources === originalFirstModelSources, "model summary filters must not mutate source rows");

  const projectRoot = process.cwd();
  const dashboardSource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "ScanTerminalDashboard.tsx"),
    "utf8",
  );
  const modelSummarySource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "ModelSummaryDashboard.tsx"),
    "utf8",
  );
  assert(
    dashboardSource.includes("modelSummary") &&
      dashboardSource.includes("模型汇总") &&
      dashboardSource.includes("Model Summary") &&
      dashboardSource.includes("Table2"),
    "terminal sidebar must expose the model summary nav item",
  );
  assert(
    dashboardSource.includes("<ModelSummaryDashboard") &&
      dashboardSource.includes("rows={modelSummaryRows}") &&
      dashboardSource.includes("cacheScope: \"model-summary\"") &&
      dashboardSource.includes("modelSummary: true") &&
      dashboardSource.includes("hasTerminalForecastRows(rows)") &&
      dashboardSource.includes("generatedText={modelSummaryGeneratedText}"),
    "terminal model summary view must use direct scan terminal rows without city fallback rows",
  );
  assert(
      modelSummarySource.includes("MODEL_SUMMARY_MODEL_COLUMNS") &&
      modelSummarySource.includes("lastGoodSummaryRowsRef") &&
      modelSummarySource.includes("hasModelSummaryForecastData") &&
      modelSummarySource.includes("DEB μ") &&
      modelSummarySource.includes("DEB 分布概率") &&
      modelSummarySource.includes("expandedCityKeys") &&
      modelSummarySource.includes("toggleExpandedCity") &&
      modelSummarySource.includes("aria-expanded") &&
      modelSummarySource.includes("ChevronRight") &&
      modelSummarySource.includes("probabilityBuckets.map") &&
      !modelSummarySource.includes("Market Option Probability") &&
      !modelSummarySource.includes("市场选项概率") &&
      !modelSummarySource.includes("Detailed Probability") &&
      !modelSummarySource.includes("详细概率分布") &&
      !modelSummarySource.includes("Market Match") &&
      !modelSummarySource.includes("市场匹配") &&
      !modelSummarySource.includes("marketMatches.map") &&
      !modelSummarySource.includes("formatModelSummaryEdge") &&
      !modelSummarySource.includes("marketProbability") &&
      !modelSummarySource.includes("edgePercent") &&
      !modelSummarySource.includes("Probability Distribution") &&
      !modelSummarySource.includes("probabilityColumns") &&
      modelSummarySource.includes("min-w-[96px]") &&
      modelSummarySource.includes("Local Time") &&
      modelSummarySource.includes("当地时间") &&
      !modelSummarySource.includes("Current High") &&
      !modelSummarySource.includes("当前最高") &&
      modelSummarySource.includes("Only DEB") &&
      modelSummarySource.includes("仅 DEB") &&
      modelSummarySource.includes("Large spread") &&
      modelSummarySource.includes("分歧较大"),
    "model summary dashboard must render the fixed model table and filters",
  );
}
