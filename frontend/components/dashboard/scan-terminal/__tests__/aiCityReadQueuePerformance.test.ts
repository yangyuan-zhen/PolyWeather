import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const clientPath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "scan-terminal",
    "scan-terminal-client.ts",
  );
  const source = fs.readFileSync(clientPath, "utf8");
  const concurrencyMatch = source.match(/AI_CITY_READ_MAX_CONCURRENT_STREAMS\s*=\s*(\d+)/);
  const concurrency = Number(concurrencyMatch?.[1]);

  assert(
    Number.isFinite(concurrency) && concurrency >= 4,
    "AI airport-read streams should allow at least 4 concurrent cards to avoid slow decision-card evidence queues",
  );
  assert(
    source.includes("queuedAiCityReadTasks.unshift(run)") &&
      source.includes("queuedAiCityReadTasks.pop()"),
    "newer AI airport-read requests should be prioritized instead of waiting behind older pinned cards",
  );
}
