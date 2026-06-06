import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const cssPath = path.join(process.cwd(), "components", "docs", "DocsLayout.module.css");
  const source = fs.readFileSync(cssPath, "utf8");

  assert(
    source.includes("background:") && source.includes("#f8fbff") && source.includes("#eef4fb"),
    "docs shell must define a light page background instead of inheriting mixed app styles",
  );
  assert(source.includes(".pageTitle") && source.includes("color: #0f172a"), "docs title must use high-contrast dark text");
  assert(source.includes(".paragraph") && source.includes("color: #334155"), "docs body copy must use readable dark text");
  assert(source.includes(".sidebar") && source.includes("background: #ffffff"), "docs sidebar must use a solid light surface");
  assert(source.includes(".toc") && source.includes("background: #ffffff"), "docs table of contents must use a solid light surface");
  assert(!source.includes("color: rgba(226, 232, 240"), "docs layout must not use dark-theme pale text on a light page");
}
