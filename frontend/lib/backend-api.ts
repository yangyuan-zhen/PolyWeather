"use client";

import {
  getSupabaseBrowserClient,
  hasSupabasePublicEnv,
} from "@/lib/supabase/client";

const PUBLIC_BACKEND_API_BASE_URL =
  process.env.NEXT_PUBLIC_POLYWEATHER_API_BASE_URL?.trim() || "";

export function hasDirectBackendApiBaseUrl() {
  return Boolean(PUBLIC_BACKEND_API_BASE_URL);
}

export function resolveBackendApiUrl(path: string) {
  if (!PUBLIC_BACKEND_API_BASE_URL || /^https?:\/\//i.test(path)) {
    return path;
  }
  const base = PUBLIC_BACKEND_API_BASE_URL.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export async function fetchBackendApi(path: string, init?: RequestInit) {
  return fetch(resolveBackendApiUrl(path), init);
}

export async function buildBrowserBackendHeaders(init?: HeadersInit) {
  const headers = new Headers(init);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  if (!headers.has("Authorization") && hasSupabasePublicEnv()) {
    try {
      const {
        data: { session },
      } = await getSupabaseBrowserClient().auth.getSession();
      const accessToken = session?.access_token || "";
      if (accessToken) {
        headers.set("Authorization", `Bearer ${accessToken}`);
      }
    } catch {
      // Direct backend mode must also work for public/optional-auth dashboards.
    }
  }

  return headers;
}
