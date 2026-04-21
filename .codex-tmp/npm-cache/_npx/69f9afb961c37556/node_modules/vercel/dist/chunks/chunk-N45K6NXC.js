import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_ } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_(__filename);
import {
  CertConfigurationError,
  CertError,
  DeploymentNotFound,
  DeploymentPermissionDenied,
  DomainNotFound,
  InvalidDeploymentId,
  TooManyRequests,
  isAPIError
} from "./chunk-ECRBC4HL.js";

// src/util/to-host.ts
function toHost(url) {
  return url.replace(/^(?:.*?\/\/)?([^/]+).*/, "$1");
}

// src/util/certs/map-cert-error.ts
function mapCertError(error, cns) {
  const errorCode = error.code;
  if (errorCode === "too_many_requests") {
    const retryAfter = typeof error.retryAfterMs === "number" ? error.retryAfterMs : 0;
    return new TooManyRequests("certificates", retryAfter);
  }
  if (errorCode === "not_found") {
    return new DomainNotFound(error.domain);
  }
  if (errorCode === "configuration_error") {
    return new CertConfigurationError({
      cns: cns || error.cns || [],
      message: error.message,
      external: error.external,
      helpUrl: error.helpUrl,
      type: error.statusCode === 449 ? "http-01" : "dns-01"
    });
  }
  if (errorCode === "bad_domains" || errorCode === "challenge_still_pending" || errorCode === "common_name_domain_name_mismatch" || errorCode === "conflicting_caa_record" || errorCode === "domain_not_verified" || errorCode === "invalid_cn" || errorCode === "invalid_domain" || errorCode === "rate_limited" || errorCode === "should_share_root_domain" || errorCode === "unauthorized_request_error" || errorCode === "unsupported_challenge_priority" || errorCode === "wildcard_not_allowed" || errorCode === "validation_running" || errorCode === "dns_error" || errorCode === "challenge_error" || errorCode === "txt_record_not_found") {
    return new CertError({
      cns: cns || error.cns || [],
      code: errorCode,
      message: error.message,
      helpUrl: error.helpUrl
    });
  }
  return null;
}

// src/util/get-deployment.ts
async function getDeployment(client, contextName, hostOrId) {
  if (hostOrId.includes(".")) {
    hostOrId = toHost(hostOrId);
  }
  try {
    return await client.fetch(
      `/v13/deployments/${encodeURIComponent(hostOrId)}`
    );
  } catch (err) {
    if (isAPIError(err)) {
      if (err.status === 404) {
        throw new DeploymentNotFound({ id: hostOrId, context: contextName });
      }
      if (err.status === 403) {
        throw new DeploymentPermissionDenied(hostOrId, contextName);
      }
      if (err.status === 400 && err.message.includes("`id`")) {
        throw new InvalidDeploymentId(hostOrId);
      }
      const certError = mapCertError(err);
      if (certError) {
        throw certError;
      }
    }
    throw err;
  }
}

export {
  mapCertError,
  toHost,
  getDeployment
};
