import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const shell = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "layout", "AdminShell.tsx"),
    "utf8",
  );
  const sidebar = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "layout", "AdminSidebar.tsx"),
    "utf8",
  );
  const css = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "layout", "AdminShell.module.css"),
    "utf8",
  );

  assert(
    shell.includes("AdminShell.module.css") &&
      shell.includes("styles.root") &&
      shell.includes("styles.main") &&
      shell.includes("styles.content"),
    "ops shell must use scoped terminal-style admin theme classes",
  );
  assert(
    sidebar.includes("bg-white") &&
      sidebar.includes("bg-blue-50") &&
      sidebar.includes("shadow-[inset_3px_0_0_#2563eb]"),
    "ops sidebar must use the light terminal navigation treatment with blue active state",
  );
  assert(
    css.includes("#eef2f7") &&
      css.includes("[class~=\"text-white\"]") &&
      css.includes("[class*=\"bg-[#0f172a]\"]") &&
      css.includes("[class~=\"rounded-3xl\"]") &&
      css.includes("[class*=\"border-white/\"]") &&
      css.includes(".recharts-cartesian-grid line"),
    "ops scoped CSS must map legacy dark ops utility classes to the light terminal workbench palette",
  );
}
