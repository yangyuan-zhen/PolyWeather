import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  findProjectsFromPath,
  getLinkFromDir,
  getRepoLink,
  getTeamById,
  getUser,
  getVercelDirectory
} from "./chunk-U7MQBM3F.js";
import {
  TeamDeleted
} from "./chunk-ECRBC4HL.js";
import {
  output_manager_default
} from "./chunk-ZQKJVHXY.js";

// src/util/get-scope.ts
import { relative } from "path";
async function getScope(client, opts = {}) {
  const user = await getUser(client);
  let contextName = user.username || user.email;
  let team = null;
  const defaultTeamId = user.version === "northstar" ? user.defaultTeamId : void 0;
  const currentTeamOrDefaultTeamId = client.config.currentTeam || defaultTeamId;
  if (currentTeamOrDefaultTeamId && opts.getTeam !== false) {
    team = await getTeamById(client, currentTeamOrDefaultTeamId);
    if (!team) {
      throw new TeamDeleted();
    }
    contextName = team.slug;
  }
  if (!opts.resolveLocalScope) {
    return { contextName, team, user };
  }
  const explicitScopeProvided = detectExplicitScope(client);
  const globalTeamId = client.config.currentTeam;
  const cwd = client.cwd;
  let projectLink = null;
  try {
    projectLink = await getLinkFromDir(getVercelDirectory(cwd));
  } catch (_error) {
    projectLink = null;
  }
  let repoLink = null;
  try {
    repoLink = await getRepoLink(client, cwd);
  } catch (_error) {
    repoLink = null;
  }
  let localOrgId;
  if (projectLink) {
    localOrgId = projectLink.orgId;
  } else if (repoLink?.repoConfig) {
    const repoConfig = repoLink.repoConfig;
    const projects = findProjectsFromPath(
      repoConfig.projects,
      relative(repoLink.rootPath, cwd)
    );
    if (projects.length === 1) {
      localOrgId = projects[0].orgId ?? repoLink.repoConfig.orgId ?? void 0;
    } else if (projects.length > 1) {
      const orgIds = new Set(
        projects.map((p) => p.orgId ?? repoConfig.orgId ?? "")
      );
      if (orgIds.size === 1) {
        const [singleOrgId] = orgIds;
        if (singleOrgId) {
          localOrgId = singleOrgId;
        }
      }
    }
  }
  const isCrossTeamRepo = detectCrossTeamRepo(repoLink?.repoConfig);
  const scopeMismatch = Boolean(
    localOrgId && globalTeamId && globalTeamId !== localOrgId
  );
  let resolvedOrg;
  let resolvedContextName = contextName;
  let resolvedTeam = team;
  let linkedRepoResult = null;
  if (repoLink?.repoConfig) {
    linkedRepoResult = {
      repoConfig: repoLink.repoConfig,
      rootPath: repoLink.rootPath
    };
  }
  if (explicitScopeProvided) {
    resolvedOrg = team ? { type: "team", id: team.id, slug: team.slug } : { type: "user", id: user.id, slug: user.username };
  } else if (localOrgId) {
    client.config.currentTeam = localOrgId.startsWith("team_") ? localOrgId : void 0;
    const correctedTeam = client.config.currentTeam ? await getTeamById(client, client.config.currentTeam) : null;
    const correctedUser = await getUser(client);
    resolvedOrg = correctedTeam ? { type: "team", id: correctedTeam.id, slug: correctedTeam.slug } : {
      type: "user",
      id: correctedUser.id,
      slug: correctedUser.username
    };
    resolvedContextName = correctedTeam ? correctedTeam.slug : correctedUser.username || correctedUser.email;
    resolvedTeam = correctedTeam;
  } else {
    if (isCrossTeamRepo) {
      output_manager_default.warn(
        `This repository has projects across multiple teams. Use \`--scope\` to specify which team, or \`cd\` into a project directory.`
      );
    }
    resolvedOrg = team ? { type: "team", id: team.id, slug: team.slug } : { type: "user", id: user.id, slug: user.username };
  }
  return {
    org: resolvedOrg,
    contextName: resolvedContextName,
    user,
    team: resolvedTeam,
    linkedRepo: linkedRepoResult,
    isCrossTeamRepo,
    scopeMismatch,
    explicitScopeProvided
  };
}
function detectExplicitScope(client) {
  const argv = client.argv;
  for (const arg of argv) {
    if (arg === "--scope" || arg === "--team" || arg.startsWith("--scope=") || arg.startsWith("--team=") || arg === "-T") {
      return true;
    }
  }
  if (client.localConfig?.scope) {
    return true;
  }
  return false;
}
function detectCrossTeamRepo(repoConfig) {
  if (!repoConfig?.projects || repoConfig.projects.length < 2) {
    return false;
  }
  const orgIds = /* @__PURE__ */ new Set();
  for (const project of repoConfig.projects) {
    const orgId = project.orgId ?? repoConfig.orgId;
    if (orgId) {
      orgIds.add(orgId);
    }
  }
  return orgIds.size > 1;
}

export {
  getScope
};
