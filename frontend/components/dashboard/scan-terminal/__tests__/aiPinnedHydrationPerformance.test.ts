import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const workspacePath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "scan-terminal",
    "use-ai-pinned-city-workspace.ts",
  );
  const storePath = path.join(projectRoot, "hooks", "useDashboardStore.tsx");
  const cardPath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "scan-terminal",
    "AiPinnedCityCard.tsx",
  );
  const source = fs.readFileSync(workspacePath, "utf8");
  const storeSource = fs.readFileSync(storePath, "utf8");
  const cardSource = fs.readFileSync(cardPath, "utf8");

  assert(
    !source.includes("waitForDeepAnalysisQueue"),
    "decision-card deep analysis hydration must not add an artificial queue delay",
  );
  assert(
    /store\.ensureCityDetail\(\s*nextCity,\s*false,\s*"full",?\s*\)/.test(source),
    "automatic deep analysis hydration should use cache-friendly full detail requests",
  );
  assert(
    storeSource.includes("row.model_cluster_sources") &&
      storeSource.includes("deb_prediction") &&
      storeSource.includes("multi_model: multiModel"),
    "decision-card preload must hydrate model cluster and DEB data from the scan row",
  );
  assert(
    cardSource.includes("getRowModelEntries") &&
      cardSource.includes("row?.ai_predicted_max") &&
      cardSource.includes("row?.cluster_median") &&
      cardSource.includes("detailModelEntries.length ? detailModelEntries : getRowModelEntries(row)"),
    "decision card should render model support and AI predicted max from the row before full detail/AI stream arrives",
  );
}
