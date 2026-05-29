import {
  loadTerminalAuthProfile,
  type TerminalAuthProfilePayload,
} from "@/components/dashboard/scan-terminal/terminal-auth-bootstrap";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

export async function runTests() {
  const slowCookieProfile = deferred<TerminalAuthProfilePayload>();
  const fastSession = deferred<{ data: { session: { access_token: string } } }>();
  const calls: string[] = [];

  const resultPromise = loadTerminalAuthProfile({
    hasSupabasePublicEnv: true,
    getSession: () => {
      calls.push("getSession");
      return fastSession.promise;
    },
    loadAuthProfile: (accessToken) => {
      const token = String(accessToken || "");
      calls.push(token ? `profile:${token}` : "profile:cookie");
      if (!token) return slowCookieProfile.promise;
      return Promise.resolve({
        authenticated: true,
        user_id: "bearer-user",
        subscription_active: true,
      });
    },
  });

  await flushMicrotasks();
  assert(
    calls.includes("profile:cookie") && calls.includes("getSession"),
    "terminal auth bootstrap should start cookie profile and Supabase session in parallel",
  );

  fastSession.resolve({ data: { session: { access_token: "fast-token" } } });
  const result = await resultPromise;
  assert(
    calls.includes("profile:fast-token"),
    "terminal auth bootstrap should retry auth profile with the Supabase bearer token",
  );
  assert(
    result.authenticated === true && result.user_id === "bearer-user",
    "terminal auth bootstrap should not wait for a slow cookie profile when bearer auth succeeds",
  );

  const slowSession = deferred<{ data: { session: { access_token: string } | null } }>();
  const cookieOnlyResult = await loadTerminalAuthProfile({
    hasSupabasePublicEnv: true,
    getSession: () => slowSession.promise,
    loadAuthProfile: (accessToken) => {
      assert(!accessToken, "authenticated cookie profile should finish without requiring bearer profile");
      return Promise.resolve({
        authenticated: true,
        user_id: "cookie-user",
        subscription_active: true,
      });
    },
  });
  assert(
    cookieOnlyResult.user_id === "cookie-user",
    "terminal auth bootstrap should accept an authenticated cookie profile immediately",
  );
}
