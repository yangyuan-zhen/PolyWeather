import {
  loadTerminalAuthProfile,
  type TerminalAuthProfilePayload,
} from "@/components/dashboard/scan-terminal/terminal-auth-bootstrap";
import {
  buildSubscriptionRequiredAuthProfile,
  isSubscriptionRequiredBackendResponse,
} from "@/lib/auth-profile-proxy";

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
    loadAuthProfile: (accessToken, options) => {
      const token = String(accessToken || "");
      calls.push(
        token
          ? `profile:${token}:${options?.preferSnapshot ? "snapshot" : "live"}`
          : `profile:cookie:${options?.preferSnapshot ? "snapshot" : "live"}`,
      );
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
    calls.includes("profile:cookie:snapshot") && calls.includes("getSession"),
    "terminal auth bootstrap should start a snapshot-preferred cookie profile and Supabase session in parallel",
  );

  fastSession.resolve({ data: { session: { access_token: "fast-token" } } });
  const result = await resultPromise;
  assert(
    calls.includes("profile:fast-token:snapshot"),
    "terminal auth bootstrap should retry auth profile with the Supabase bearer token and snapshot hint",
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

  const delayedBearerSession = deferred<{ data: { session: { access_token: string } } }>();
  let coldStartSettled = false;
  const coldStartResultPromise = loadTerminalAuthProfile({
    hasSupabasePublicEnv: true,
    getSession: () => delayedBearerSession.promise,
    loadAuthProfile: (accessToken) => {
      const token = String(accessToken || "");
      if (!token) {
        return Promise.resolve({
          authenticated: true,
          user_id: "cookie-user",
          subscription_active: null,
          degraded_auth_profile: true,
        });
      }
      return Promise.resolve({
        authenticated: true,
        user_id: "bearer-paid-user",
        subscription_active: true,
      });
    },
  });
  coldStartResultPromise.then(() => {
    coldStartSettled = true;
  });
  await flushMicrotasks();
  assert(
    coldStartSettled === false,
    "terminal auth bootstrap must not show a cold-start paywall from a degraded cookie profile before bearer auth has a chance to confirm Pro",
  );

  delayedBearerSession.resolve({ data: { session: { access_token: "paid-token" } } });
  const coldStartResult = await coldStartResultPromise;
  assert(
    coldStartResult.user_id === "bearer-paid-user" &&
      coldStartResult.subscription_active === true,
    "terminal auth bootstrap should prefer the bearer-confirmed active Pro profile over a degraded cookie profile",
  );

  const failingBearerResult = loadTerminalAuthProfile({
    hasSupabasePublicEnv: true,
    getSession: () =>
      Promise.resolve({ data: { session: { access_token: "paid-token" } } }),
    loadAuthProfile: (accessToken) => {
      if (!accessToken) {
        return Promise.resolve({
          authenticated: false,
          subscription_active: false,
          points: 0,
        });
      }
      return Promise.reject(new Error("HTTP 500"));
    },
  });
  let failedWithTransientAuthError = false;
  try {
    await failingBearerResult;
  } catch (error) {
    failedWithTransientAuthError = String(error).includes("HTTP 500");
  }
  assert(
    failedWithTransientAuthError,
    "terminal auth bootstrap must not resolve to an anonymous paywall when a bearer session exists but the auth profile request is transiently failing",
  );

  assert(
    isSubscriptionRequiredBackendResponse(
      403,
      '{"detail":"Subscription required"}',
    ) === true,
    "auth profile proxy should recognize backend subscription-required responses as confirmed inactive access",
  );
  assert(
    isSubscriptionRequiredBackendResponse(
      403,
      '{"detail":"temporary entitlement outage"}',
    ) === false,
    "auth profile proxy should keep unrelated backend 403 responses in the transient/degraded path",
  );

  const subscriptionRequiredProfile = buildSubscriptionRequiredAuthProfile({
    email: "user@example.com",
    userId: "user-1",
  });
  assert(
    subscriptionRequiredProfile.authenticated === true &&
      subscriptionRequiredProfile.user_id === "user-1" &&
      subscriptionRequiredProfile.subscription_active === false &&
      !("degraded_auth_profile" in subscriptionRequiredProfile),
    "auth profile proxy must return confirmed inactive access instead of an endless unknown subscription state",
  );
}
