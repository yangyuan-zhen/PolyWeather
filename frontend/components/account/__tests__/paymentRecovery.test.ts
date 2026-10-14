import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export async function runTests() {
  const source = fs.readFileSync(path.join(process.cwd(), "components/account/useBilling.ts"), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const txHash = `0x${"2".repeat(64)}`;
  for (const scenario of ["conflict", "server_error", "unauthorized", "pending"]) {
    const requests: string[] = [];
    let refreshes = 0;
    let paymentRefreshes = 0;
    let clearedError = false;
    const exported = { exports: {} as { useBilling?: (params: unknown) => { handleSubmit409: (...args: unknown[]) => Promise<void> } } };
    vm.runInNewContext(code, {
      exports: exported.exports,
      require: (name: string) => {
        if (name === "react") return {
          useCallback: (fn: unknown) => fn,
          useEffect: () => {},
          useMemo: (fn: () => unknown) => fn(),
          useState: (value: unknown) => [value, () => {}],
        };
        if (name === "@/lib/payment-host") return {
          getAllowedPaymentHosts: () => [],
          getCurrentPaymentHost: () => "polyweather.top",
          isPaymentHostAllowed: () => true,
        };
        if (name === "./constants") return { PAYMENT_RECOVERY_TTL_MS: 60000 };
        if (name === "./formatters") return { shortAddress: (value: string) => value };
        throw new Error(`Unexpected import: ${name}`);
      },
      fetch: async (url: string) => {
        requests.push(url);
        return {
          ok: scenario !== "unauthorized",
          json: async () => ({ ok: scenario !== "pending" }),
        };
      },
      encodeURIComponent,
    });
    const billing = exported.exports.useBilling!({
      copy: { walletRecoveryDone: "Recovered", submitTxFailed: "Submit failed: {raw}" },
      authIsAuthenticated: true,
      buildAuthedHeaders: async () => ({ Authorization: "Bearer test-token" }),
      refreshEntitlementAfterPayment: async () => { refreshes += 1; },
      loadPaymentSnapshot: async () => { paymentRefreshes += 1; },
      setPaymentInfo: () => {},
      setPaymentError: (value: string) => { clearedError = value === ""; },
    });
    let failed = false;
    try {
      await billing.handleSubmit409(
        "new-intent", txHash,
        scenario === "server_error" ? "Bad Gateway" : "tx_hash already used by another payment intent",
        scenario === "server_error" ? 502 : 409,
      );
    } catch { failed = true; }
    assert(requests.length === 1 && requests[0] === `/api/payments/reconcile-latest?tx_hash=${txHash}`,
      `${scenario}: recovery must target the submitted transaction, not the new order`);
    const succeeded = scenario === "conflict" || scenario === "server_error";
    assert(failed !== succeeded, `${scenario}: unsuccessful recovery must remain an error`);
    assert(refreshes === (succeeded ? 1 : 0) && paymentRefreshes === (succeeded ? 1 : 0),
      `${scenario}: successful recovery must refresh subscription and payment state`);
    assert(clearedError === succeeded, `${scenario}: clear errors only after confirmed recovery`);
  }
  const flow = fs.readFileSync(path.join(process.cwd(), "components/account/usePaymentFlow.ts"), "utf8");
  assert((flow.match(/submitRes.status === 409 \|\| submitRes.status >= 500/g) || []).length === 2,
    "Wallet and manual transfer flows must both recover from submit conflicts and server errors");
  const route = fs.readFileSync(path.join(process.cwd(), "app/api/payments/reconcile-latest/route.ts"), "utf8");
  assert(route.includes('url.searchParams.set("tx_hash", txHash)'),
    "The authenticated proxy must forward the transaction filter");
}
