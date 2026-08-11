import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const overlaySource = fs.readFileSync(
    path.join(projectRoot, "components", "subscription", "UnlockProOverlay.tsx"),
    "utf8",
  );

  const legacyPhrases = [
    ["全球", "最精准"].join(""),
    ["全平台", "覆盖"].join(""),
    ["全平台", "智能气象", "推送"].join(""),
    ["High-precision weather intelligence", "delivered everywhere."].join(", "),
    ["Cross-platform", "alerts"].join(" "),
  ];

  for (const legacyPhrase of legacyPhrases) {
    assert(
      !overlaySource.includes(legacyPhrase),
      `UnlockProOverlay must not show legacy marketing copy: ${legacyPhrase}`,
    );
  }

  for (const expectedPhrase of [
    "确认开通 PolyWeather Pro",
    "结算源优先",
    "机场实测",
    "DEB 路径",
    "Activate PolyWeather Pro",
    "settlement-source-first",
  ]) {
    assert(
      overlaySource.includes(expectedPhrase),
      `UnlockProOverlay must explain the current Pro checkout value: ${expectedPhrase}`,
    );
  }
}
