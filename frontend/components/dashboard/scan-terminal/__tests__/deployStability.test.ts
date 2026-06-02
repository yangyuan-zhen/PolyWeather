import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function readRepoFile(...parts: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), "..", ...parts), "utf8");
}

export function runTests() {
  const workflow = readRepoFile(".github", "workflows", "ci.yml");
  const deployScript = readRepoFile("deploy.sh");

  assert(
    workflow.includes("group: polyweather-production-deploy") &&
      workflow.includes("cancel-in-progress: false"),
    "production deploy job must be serialized so overlapping pushes cannot restart the VPS concurrently",
  );
  assert(
    deployScript.includes("POLYWEATHER_DEPLOY_LOCK_FILE") &&
      deployScript.includes("flock -n"),
    "VPS deploy script must take a host-level deploy lock for manual or retried deploys",
  );
  assert(
    deployScript.includes("wait_for_local_service") &&
      deployScript.includes("http://127.0.0.1:3001/terminal"),
    "deploy script must wait for the local frontend before relying on Cloudflare/public smoke checks",
  );
  assert(
    deployScript.includes("warm_public_route") &&
      deployScript.includes("https://polyweather.top/terminal") &&
      deployScript.includes("https://polyweather.top/api/auth/me?prefer_snapshot=1"),
    "deploy script must warm terminal and auth snapshot routes after container replacement",
  );
  assert(
    deployScript.includes("validate_frontend_api_base_url") &&
      deployScript.includes("POLYWEATHER_API_BASE_URL must not point at the frontend site") &&
      deployScript.indexOf("validate_frontend_api_base_url") <
        deployScript.indexOf('echo "Updating Redis dependency..."'),
    "deploy script must reject frontend POLYWEATHER_API_BASE_URL values that point at polyweather.top and would recurse through the frontend proxy",
  );
}
