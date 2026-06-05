import { LoginClient } from "@/components/auth/LoginClient";
import { I18nProvider } from "@/hooks/useI18n";

type PageProps = {
  searchParams?: Promise<{ error?: string; mode?: string; next?: string }>;
};

function normalizeNextPath(input: string | undefined) {
  const fallback = "/";
  const raw = String(input || "").trim();
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  return raw;
}

function normalizeMode(input: string | undefined): "login" | "signup" {
  if (input === "signup") return "signup";
  return "login";
}

function normalizeAuthError(input: string | undefined) {
  const raw = String(input || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  if (!raw) return "";
  return raw.slice(0, 240);
}

export default async function LoginPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const nextPath = normalizeNextPath(params.next);
  const initialMode = normalizeMode(params.mode);
  const initialError = normalizeAuthError(params.error);
  return (
    <I18nProvider>
      <LoginClient
        nextPath={nextPath}
        initialMode={initialMode}
        initialError={initialError}
      />
    </I18nProvider>
  );
}
