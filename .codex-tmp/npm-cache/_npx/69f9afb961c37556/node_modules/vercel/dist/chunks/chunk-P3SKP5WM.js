import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);

// src/util/routes/edit-route.ts
async function editRoute(client, projectId, routeId, input, options = {}) {
  const { teamId } = options;
  const query = new URLSearchParams();
  if (teamId)
    query.set("teamId", teamId);
  const queryString = query.toString();
  const url = `/v1/projects/${projectId}/routes/${routeId}${queryString ? `?${queryString}` : ""}`;
  return await client.fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
}

export {
  editRoute
};
