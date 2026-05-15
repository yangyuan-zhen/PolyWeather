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
  const source = fs.readFileSync(workspacePath, "utf8");

  assert(
    !source.includes("waitForDeepAnalysisQueue"),
    "decision-card deep analysis hydration must not add an artificial queue delay",
  );
  assert(
    /store\.ensureCityDetail\(\s*nextCity,\s*false,\s*"full",?\s*\)/.test(source),
    "automatic deep analysis hydration should use cache-friendly full detail requests",
  );
}
