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

  for (const legacyPhrase of [
    "全球最精准",
    "全平台覆盖",
    "全平台智能气象推送",
    "High-precision weather intelligence, delivered everywhere.",
    "Cross-platform alerts",
  ]) {
    assert(
      !overlaySource.includes(legacyPhrase),
      `UnlockProOverlay must not show legacy marketing copy: ${legacyPhrase}`,
    );
  }

  for (const expectedPhrase of [
    "确认开通 PolyWeather Pro",
    "结算源优先",
    "机场 / 跑道实测",
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
