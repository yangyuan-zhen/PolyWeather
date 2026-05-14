import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const accountCenterPath = path.join(
    projectRoot,
    "components",
    "account",
    "AccountCenter.tsx",
  );
  const serviceWorkerPath = path.join(projectRoot, "public", "sw.js");

  const accountCenterSource = fs.readFileSync(accountCenterPath, "utf8");
  const serviceWorkerSource = fs.readFileSync(serviceWorkerPath, "utf8");

  assert(
    accountCenterSource.includes(
      'import { UnlockProOverlay } from "@/components/subscription/UnlockProOverlay";',
    ),
    "checkout overlay must be in the account bundle, not lazy-loaded after the user clicks pay",
  );
  assert(
    !/const\s+UnlockProOverlay\s*=\s*dynamic\s*\(/.test(accountCenterSource),
    "checkout overlay must not be dynamically imported; stale deployments can make the lazy chunk fail at pay time",
  );
  assert(
    !/STATIC_ASSETS\s*=\s*\[[^\]]*["']\/_next\//s.test(serviceWorkerSource),
    "service worker must not cache-first the whole /_next/ tree; stale chunks break checkout after deploys",
  );
}
