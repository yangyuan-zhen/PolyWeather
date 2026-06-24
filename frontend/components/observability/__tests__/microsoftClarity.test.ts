import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const componentPath = path.join(projectRoot, "components", "observability", "MicrosoftClarity.tsx");
  const layoutPath = path.join(projectRoot, "app", "layout.tsx");

  assert(fs.existsSync(componentPath), "Microsoft Clarity component must exist");

  const component = fs.readFileSync(componentPath, "utf8");
  const layout = fs.readFileSync(layoutPath, "utf8");

  assert(
    component.includes('import Script from "next/script"') &&
      component.includes('strategy="afterInteractive"'),
    "Microsoft Clarity must use next/script and load after hydration",
  );
  assert(
    component.includes("xbydcq2lu2") &&
      component.includes("https://www.clarity.ms/tag/") &&
      component.includes('window, document, "clarity", "script"'),
    "Microsoft Clarity must use the configured PolyWeather project script",
  );
  assert(
    layout.includes("@/components/observability/MicrosoftClarity") &&
      layout.includes("<MicrosoftClarity />"),
    "root layout must render Microsoft Clarity globally",
  );
}
