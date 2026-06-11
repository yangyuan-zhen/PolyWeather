import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function collectRouteFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectRouteFiles(fullPath);
    return entry.name === "route.ts" ? [fullPath] : [];
  });
}

export function runTests() {
  const projectRoot = process.cwd();
  const apiRoot = path.join(projectRoot, "app", "api");
  const unsafeRoutes = collectRouteFiles(apiRoot)
    .filter((routePath) =>
      /\.\.\.\s*(?:\(\s*)?auth\.headers/.test(fs.readFileSync(routePath, "utf8")),
    )
    .map((routePath) => path.relative(projectRoot, routePath));

  assert(
    unsafeRoutes.length === 0,
    `backend auth Headers must not be object-spread because that drops authorization headers: ${unsafeRoutes.join(", ")}`,
  );

  const helperSource = fs.readFileSync(
    path.join(projectRoot, "lib", "backend-auth.ts"),
    "utf8",
  );
  assert(
    helperSource.includes("buildJsonBackendRequestHeaders") &&
      helperSource.includes("new Headers(headers)") &&
      helperSource.includes('result.set("Content-Type", "application/json")'),
    "backend auth must expose a safe JSON header builder",
  );
}
