import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);

// src/util/routes/get-route-versions.ts
async function getRouteVersions(client, projectId, options = {}) {
  const { teamId, count } = options;
  const query = new URLSearchParams();
  if (teamId)
    query.set("teamId", teamId);
  if (count)
    query.set("count", count.toString());
  const queryString = query.toString();
  const url = `/v1/projects/${projectId}/routes/versions${queryString ? `?${queryString}` : ""}`;
  const response = await client.fetch(url);
  return response;
}

export {
  getRouteVersions
};
