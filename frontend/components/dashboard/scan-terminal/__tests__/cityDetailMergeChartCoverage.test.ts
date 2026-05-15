import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const source = fs.readFileSync(
    path.join(process.cwd(), "hooks", "useDashboardStore.tsx"),
    "utf8",
  );

  assert(
    source.includes("function pickRicherHourly"),
    "city detail merge should have an explicit hourly-series preservation helper",
  );
  assert(
    /hourly:\s*pickRicherHourly\(\s*current\.hourly,\s*incoming\.hourly\s*\)/.test(
      source,
    ),
    "deep-analysis refresh must not let sparse incoming hourly data overwrite chart-capable cached hourly data",
  );
}
