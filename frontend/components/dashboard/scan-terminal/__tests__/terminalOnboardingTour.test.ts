import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const source = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "TerminalOnboardingTour.tsx"),
    "utf8",
  );

  assert(
    source.includes("export function TerminalOnboardingTour"),
    "TerminalOnboardingTour must be exported",
  );

  assert(
    source.includes("polyweather_terminal_onboarding_v1"),
    "onboarding must use a versioned localStorage key (bump to re-show after redesign)",
  );

  // Three trader-oriented steps: live anchor, DEB center, market probability.
  for (const expected of ["实况锚点", "DEB 预测中枢", "市场概率"]) {
    assert(
      source.includes(expected),
      `onboarding must include the "${expected}" step copy`,
    );
  }
  assert(
    source.includes("Start with live evidence") &&
      source.includes("Then the DEB center") &&
      source.includes("Finally, market odds"),
    "onboarding must provide English step copy",
  );

  // Must persist the dismissed marker so the tour does not loop every visit.
  assert(
    source.includes("localStorage.setItem(ONBOARDING_STORAGE_KEY"),
    "finishing or skipping the tour must persist the dismissed marker",
  );
  assert(
    source.includes('aria-label={isEn ? "Terminal guide"'),
    "the tour dialog must expose an accessible label",
  );
}
