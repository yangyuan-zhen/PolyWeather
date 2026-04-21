import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);

// src/util/agent-output-constants.ts
var AGENT_STATUS = {
  ERROR: "error",
  ACTION_REQUIRED: "action_required",
  OK: "ok"
};
var AGENT_REASON = {
  // Common (use across dns, flags, routes, env, domains, link)
  MISSING_ARGUMENTS: "missing_arguments",
  INVALID_ARGUMENTS: "invalid_arguments",
  CONFIRMATION_REQUIRED: "confirmation_required",
  LOGIN_REQUIRED: "login_required",
  PROJECT_SETTINGS_REQUIRED: "project_settings_required",
  NOT_LINKED: "not_linked",
  NOT_FOUND: "not_found",
  MISSING_SCOPE: "missing_scope",
  API_ERROR: "api_error",
  // Env
  MISSING_REQUIREMENTS: "missing_requirements",
  MISSING_NAME: "missing_name",
  MISSING_VALUE: "missing_value",
  MISSING_ENVIRONMENT: "missing_environment",
  ENV_NOT_FOUND: "env_not_found",
  MULTIPLE_ENVS: "multiple_envs",
  ENV_FILE_EXISTS: "env_file_exists",
  GIT_BRANCH_REQUIRED: "git_branch_required",
  ENV_KEY_SENSITIVE: "env_key_sensitive",
  // Routes
  AMBIGUOUS_ROUTE: "ambiguous_route",
  ROUTE_CREATE_FAILED: "route_create_failed",
  ROUTE_GENERATION_FAILED: "route_generation_failed",
  // DNS
  DOMAIN_NOT_FOUND: "domain_not_found",
  DNS_RECORD_NOT_FOUND: "dns_record_not_found",
  INCOMPLETE_RECORD: "incomplete_record",
  PERMISSION_DENIED: "permission_denied",
  INVALID_PORT: "invalid_port",
  INVALID_DNS_TYPE: "invalid_dns_type",
  DNS_ADD_FAILED: "dns_add_failed",
  INVALID_DOMAIN: "invalid_domain",
  /** User must accept marketplace integration terms in the browser before install can continue. */
  INTEGRATION_TERMS_ACCEPTANCE_REQUIRED: "integration_terms_acceptance_required",
  /** Integration uninstall blocked because team-scoped resources still exist. */
  HAS_RESOURCES: "has_resources",
  // Tokens
  CLASSIC_TOKEN_REQUIRED: "classic_token_required",
  /** Classic token lacks full user/account scope (e.g. team- or product-scoped token). */
  TOKEN_USER_SCOPE_REQUIRED: "token_user_scope_required",
  // Webhooks
  MISSING_URL: "missing_url",
  MISSING_EVENTS: "missing_events",
  INVALID_URL: "invalid_url",
  INVALID_EVENT: "invalid_event",
  // AI Gateway
  INVALID_BUDGET: "invalid_budget",
  INVALID_REFRESH_PERIOD: "invalid_refresh_period",
  // Redirects
  REDIRECT_NOT_FOUND: "redirect_not_found",
  VERSION_NOT_FOUND: "version_not_found",
  VERSION_ALREADY_LIVE: "version_already_live",
  VERSION_IS_STAGING: "version_is_staging"
};
var AGENT_ACTION = {
  MISSING_ARGUMENTS: "missing_arguments",
  CONFIRMATION_REQUIRED: "confirmation_required",
  LOGIN_REQUIRED: "login_required"
};

export {
  AGENT_STATUS,
  AGENT_REASON,
  AGENT_ACTION
};
