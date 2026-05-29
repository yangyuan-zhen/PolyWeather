import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

type CookieAdapter = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: { name: string; value: string; options?: CookieOptions }[]) => void;
};

function readSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return { anonKey, url };
}

export function hasSupabaseServerEnv() {
  const { anonKey, url } = readSupabasePublicEnv();
  return Boolean(url && anonKey);
}

export function hasSupabaseSessionCookieValues(
  cookies: { name: string; value: string }[],
) {
  return cookies.some((cookie) => {
    const name = cookie.name.toLowerCase();
    const value = String(cookie.value || "").trim();
    if (!value) return false;
    return (
      name === "supabase-auth-token" ||
      (name.startsWith("sb-") && name.includes("-auth-token"))
    );
  });
}

export function createSupabaseServerClient(
  cookieAdapter: CookieAdapter,
) {
  const { anonKey, url } = readSupabasePublicEnv();
  if (!url || !anonKey) {
    throw new Error("Supabase env is not configured");
  }

  return createServerClient(url, anonKey, {
    cookies: cookieAdapter,
  });
}

export function createSupabaseMiddlewareClient(
  request: NextRequest,
  response: NextResponse,
) {
  return createSupabaseServerClient({
    getAll() {
      return request.cookies.getAll().map((item) => ({
        name: item.name,
        value: item.value,
      }));
    },
    setAll(cookiesToSet) {
      for (const cookie of cookiesToSet) {
        response.cookies.set(cookie.name, cookie.value, cookie.options);
      }
    },
  });
}

export function createSupabaseRouteClient(
  request: NextRequest,
  response: NextResponse,
) {
  return createSupabaseServerClient({
    getAll() {
      return request.cookies.getAll().map((item) => ({
        name: item.name,
        value: item.value,
      }));
    },
    setAll(cookiesToSet) {
      for (const cookie of cookiesToSet) {
        response.cookies.set(cookie.name, cookie.value, cookie.options);
      }
    },
  });
}

export async function refreshMiddlewareSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  if (!hasSupabaseServerEnv()) {
    return { response, user: null };
  }

  const supabaseCookies = request.cookies.getAll().map((item) => ({
    name: item.name,
    value: item.value,
  }));
  if (!hasSupabaseSessionCookieValues(supabaseCookies)) {
    return { response, user: null };
  }

  const supabase = createSupabaseServerClient({
    getAll() {
      return supabaseCookies;
    },
    setAll(cookiesToSet) {
      for (const cookie of cookiesToSet) {
        request.cookies.set(cookie.name, cookie.value);
      }
      response = NextResponse.next({
        request: {
          headers: request.headers,
        },
      });
      for (const cookie of cookiesToSet) {
        response.cookies.set(cookie.name, cookie.value, cookie.options);
      }
    },
  });

  try {
    const {
      data,
      error,
    } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) {
      return { response, user: null };
    }
    const user = {
      id: String(data.claims.sub || ""),
      email: String(data.claims.email || ""),
    };
    return { response, user };
  } catch {
    return { response, user: null };
  }
}
