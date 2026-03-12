import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

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

