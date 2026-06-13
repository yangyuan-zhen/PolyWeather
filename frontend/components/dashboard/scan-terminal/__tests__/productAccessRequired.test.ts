import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "components",
      "dashboard",
      "scan-terminal",
      "ProductAccessRequired.tsx",
    ),
    "utf8",
  );
  const unauthenticatedGate = source.slice(
    source.indexOf("function UnauthenticatedGate"),
    source.indexOf("export function ProductAccessRequired"),
  );
  const subscriptionGate = source.slice(
    source.indexOf("function SubscriptionGate"),
    source.indexOf("// ─── Layer 1 fallback"),
  );

  const accessCard = unauthenticatedGate.slice(
    unauthenticatedGate.indexOf('<section className="grid flex-1'),
  );

  assert(
    !accessCard.includes("<Link"),
    "signed-out terminal gate must use native anchors so stale client router state cannot block login navigation",
  );
  assert(
    accessCard.includes('href="/auth/login?next=%2Fterminal"') &&
      accessCard.includes(
        'href="/auth/login?next=%2Fterminal&mode=signup"',
      ) &&
      accessCard.includes('href="/"'),
    "signed-out terminal gate must keep hard navigation targets for login, signup, and product overview",
  );
  assert(
    subscriptionGate.includes("订阅已过期") &&
      subscriptionGate.includes("终端访问已暂停") &&
      subscriptionGate.includes("已有付款但未恢复") &&
      subscriptionGate.includes("刷新权限") &&
      subscriptionGate.includes("账户中心") &&
      source.includes("续费并恢复访问"),
    "authenticated expired subscription gate must clearly say access is paused and show renewal/recovery actions",
  );
  assert(
    source.includes("subscriptionExpiresAt") &&
      source.includes("isExpiredSubscription"),
    "subscription gate must distinguish expired users from generic inactive accounts when an expiry timestamp is available",
  );
}
