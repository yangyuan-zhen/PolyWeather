import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

function readSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return { anonKey, url };
}

export function hasSupabasePublicEnv() {
  const { anonKey, url } = readSupabasePublicEnv();
  return Boolean(url && anonKey);
}

export function getSupabaseBrowserClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  const { anonKey, url } = readSupabasePublicEnv();
  if (!url || !anonKey) {
    throw new Error("Supabase public env is not configured");
  }

  cachedClient = createBrowserClient(url, anonKey);
  return cachedClient;
}
