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
}
