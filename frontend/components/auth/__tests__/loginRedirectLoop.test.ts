import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const source = fs.readFileSync(
    path.join(process.cwd(), "components", "auth", "LoginClient.tsx"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  const start = source.indexOf("const onResetPassword");
  const end = source.indexOf("const onGoogleSignIn");

  assert(
    start >= 0 && end > start,
    "login page pre-submit auth initialization block must be detectable by this regression test",
  );

  const loginMountEffect = source.slice(start, end);

  assert(
    !loginMountEffect.includes("router.replace(nextPath)"),
    "login page must not auto-return to nextPath from a cached Supabase session before the user submits auth",
  );
}
