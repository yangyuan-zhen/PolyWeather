import type { AuthProfilePayload } from "@/components/dashboard/scan-terminal/terminal-access-state";

export type TerminalAuthProfilePayload = AuthProfilePayload;

type SupabaseSessionResult = {
  data?: {
    session?: {
      access_token?: string | null;
    } | null;
  } | null;
} | null | undefined;

type LoadTerminalAuthProfileOptions = {
  getSession: () => Promise<SupabaseSessionResult>;
  hasSupabasePublicEnv: boolean;
  loadAuthProfile: (
    accessToken?: string | null,
    options?: { preferSnapshot?: boolean },
  ) => Promise<TerminalAuthProfilePayload>;
};

type SettledProfile =
  | { ok: true; payload: TerminalAuthProfilePayload | null }
  | { ok: false; error: unknown };

function settleProfile(
  promise: Promise<TerminalAuthProfilePayload | null>,
): Promise<SettledProfile> {
  return promise
    .then((payload) => ({ ok: true as const, payload }))
    .catch((error) => ({ ok: false as const, error }));
}

function firstKnownProfile(cookieResult: SettledProfile, bearerResult: SettledProfile) {
  if (bearerResult.ok && bearerResult.payload?.authenticated) return bearerResult.payload;
  if (
    !bearerResult.ok &&
    cookieResult.ok &&
    cookieResult.payload?.authenticated === false
  ) {
    throw bearerResult.error;
  }
  if (cookieResult.ok && cookieResult.payload) return cookieResult.payload;
  if (bearerResult.ok && bearerResult.payload) return bearerResult.payload;
  if (!cookieResult.ok) throw cookieResult.error;
  if (!bearerResult.ok) throw bearerResult.error;
  return {
    authenticated: false,
    subscription_active: false,
    points: 0,
  };
}

function canResolveProfileImmediately(
  payload: TerminalAuthProfilePayload | null,
): payload is TerminalAuthProfilePayload {
  return payload?.authenticated === true && payload.subscription_active === true;
}

export async function loadTerminalAuthProfile({
  getSession,
  hasSupabasePublicEnv,
  loadAuthProfile,
}: LoadTerminalAuthProfileOptions) {
  let resolvedAuthenticated = false;
  let resolveAuthenticated:
    | ((payload: TerminalAuthProfilePayload) => void)
    | null = null;

  const authenticatedProfile = new Promise<TerminalAuthProfilePayload>((resolve) => {
    resolveAuthenticated = resolve;
  });

  const resolveIfAuthenticated = (payload: TerminalAuthProfilePayload | null) => {
    if (!canResolveProfileImmediately(payload) || resolvedAuthenticated) return;
    resolvedAuthenticated = true;
    resolveAuthenticated?.(payload);
  };

  const cookieProfile = settleProfile(
    loadAuthProfile(null, { preferSnapshot: true }).then((payload) => {
      resolveIfAuthenticated(payload);
      return payload;
    }),
  );

  const bearerProfile = settleProfile(
    (async () => {
      if (!hasSupabasePublicEnv) return null;
      const sessionResult = await getSession();
      if (resolvedAuthenticated) return null;
      const accessToken = String(
        sessionResult?.data?.session?.access_token || "",
      ).trim();
      if (!accessToken) return null;
      const payload = await loadAuthProfile(accessToken, { preferSnapshot: true });
      resolveIfAuthenticated(payload);
      return payload;
    })(),
  );

  const fallbackProfile = Promise.all([cookieProfile, bearerProfile]).then(
    ([cookieResult, bearerResult]) => firstKnownProfile(cookieResult, bearerResult),
  );

  return Promise.race([authenticatedProfile, fallbackProfile]);
}
