import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const source = fs.readFileSync(
    path.join(process.cwd(), "components", "auth", "LoginClient.tsx"),
    "utf8",
  );

  assert(
    source.includes("登录 PolyWeather") &&
      source.includes("创建 PolyWeather 账号") &&
      source.includes("创建账号并领取试用"),
    "auth entry copy must be product-specific and explain the signup trial path",
  );
  assert(
    source.includes("PW") && source.includes("PolyWeather"),
    "auth pages must show a readable PolyWeather brand mark",
  );
  assert(
    !source.includes("brightness-0 invert"),
    "auth dark panel must not invert the square logo image into a white block",
  );
  assert(
    source.includes("items-start justify-center pt-10") &&
      source.includes("lg:items-center lg:pt-0"),
    "auth form must sit higher on mobile while staying centered on desktop",
  );
  assert(
    !source.includes("hover:-translate-y-1"),
    "auth form card must not shift position on hover",
  );
  assert(
    source.includes("hidden text-xs text-slate-500 sm:inline") &&
      source.includes("whitespace-nowrap rounded-xl"),
    "auth mode switch prompt must not crowd or wrap the mobile header",
  );
}
