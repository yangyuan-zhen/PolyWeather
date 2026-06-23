import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const source = fs.readFileSync(
    path.join(projectRoot, "components", "docs", "DocsScreen.tsx"),
    "utf8",
  );
  const css = fs.readFileSync(
    path.join(projectRoot, "components", "docs", "DocsLayout.module.css"),
    "utf8",
  );

  assert(
    source.includes("Search") &&
      source.includes("searchQuery") &&
      source.includes("searchResults") &&
      source.includes("DOCS_PAGES.flatMap") &&
      source.includes("block.type === \"paragraph\""),
    "docs screen must build a local search index from page titles, sections, and paragraph text",
  );
  assert(
    css.includes(".searchWrap") &&
      css.includes(".searchInput") &&
      css.includes(".searchResults"),
    "docs layout must style the search input and result list",
  );
}
