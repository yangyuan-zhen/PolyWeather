import assert from "node:assert/strict";
import { formatHttpErrorMessage } from "@/lib/http-error";

export function runTests() {
  assert.equal(formatHttpErrorMessage(502), "HTTP 502");
  assert.equal(
    formatHttpErrorMessage(403, "Forbidden", '{"detail":"missing entitlement"}'),
    "HTTP 403 Forbidden: missing entitlement",
  );
  assert.equal(
    formatHttpErrorMessage(500, null, '{"error":{"code":"boom"}}'),
    'HTTP 500: {"code":"boom"}',
  );
  assert.equal(
    formatHttpErrorMessage(504, "Gateway Timeout", " upstream timed out\n"),
    "HTTP 504 Gateway Timeout: upstream timed out",
  );
}
