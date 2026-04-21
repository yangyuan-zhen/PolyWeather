import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);

// src/util/routes/update-route-version.ts
async function updateRouteVersion(client, projectId, versionId, action, options = {}) {
  const { teamId } = options;
  const query = new URLSearchParams();
  if (teamId)
    query.set("teamId", teamId);
  const queryString = query.toString();
  const url = `/v1/projects/${projectId}/routes/versions${queryString ? `?${queryString}` : ""}`;
  return await client.fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      id: versionId,
      action
    })
  });
}

export {
  updateRouteVersion
};
