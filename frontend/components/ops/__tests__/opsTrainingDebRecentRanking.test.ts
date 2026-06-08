import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readFrontend(...parts: string[]) {
  return fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

export function runTests() {
  const trainingPage = readFrontend("components", "ops", "training", "TrainingPageClient.tsx");
  const charts = readFrontend("components", "ops", "training", "TrainingAccuracyCharts.tsx");

  assert.match(
    trainingPage,
    /buildDebRecentRankingRows/,
    "ops training page should share the DEB usable-recent ranking helper with the terminal dashboard",
  );
  assert.match(
    trainingPage,
    /debRecentRanked/,
    "ops training page should build chart rows from the usable-recent DEB ranking",
  );
  assert.match(
    trainingPage,
    /debRecentRankIndex/,
    "ops training detail table should follow the same usable-recent DEB order before falling back to historical scores",
  );
  assert.doesNotMatch(
    trainingPage,
    /sort\(\s*\(a,\s*b\)\s*=>\s*\(\(b\.deb\?\.hit_rate/,
    "ops training DEB chart must not regress to sorting by long-term historical hit rate",
  );

  assert.match(
    charts,
    /DEB 可用近期命中率 by 城市/,
    "ops DEB hit-rate chart should label the metric as usable recent accuracy",
  );
  assert.match(
    charts,
    /DEB 可用近期 MAE by 城市/,
    "ops DEB MAE chart should label the metric as usable recent MAE",
  );
  assert.match(
    charts,
    /可用近期命中率/,
    "ops DEB hit-rate tooltip should describe the usable recent metric",
  );
}
