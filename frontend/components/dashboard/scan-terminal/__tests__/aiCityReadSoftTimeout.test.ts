import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const hookPath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "scan-terminal",
    "use-ai-city-forecast.ts",
  );
  const source = fs.readFileSync(hookPath, "utf8");

  assert(
    source.includes("AI_CITY_READ_SOFT_TIMEOUT_MS") &&
      source.includes("softTimeoutId"),
    "AI city read hook must use a soft timeout so airport-read loading does not linger",
  );
  assert(
    source.includes("ai_soft_timeout_fallback") &&
      source.includes("buildAiCityErrorForecastState"),
    "AI city read soft timeout must switch to the fast fallback state while allowing later merge",
  );
  assert(
    !source.includes("controller.abort()"),
    "AI city read soft timeout should not abort the stream; late AI results should still merge",
  );
}
