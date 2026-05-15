import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const hookPath = path.join(projectRoot, "hooks", "useLeafletMap.ts");
  const source = fs.readFileSync(hookPath, "utf8");

  assert(
    source.includes("bindMarkerTouchSelect") &&
      source.includes('"touchend"') &&
      source.includes('"pointerup"'),
    "Leaflet city markers must bind touch/pointer selection events for mobile taps",
  );
  assert(
    source.includes("L.DomEvent.stopPropagation") &&
      source.includes("L.DomEvent.preventDefault"),
    "mobile marker tap handling must stop map click propagation and prevent browser touch defaults",
  );
}
