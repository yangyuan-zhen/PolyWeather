import { LoginClient } from "@/components/auth/LoginClient";

type PageProps = {
  searchParams?: Promise<{ next?: string }>;
};

function normalizeNextPath(input: string | undefined) {
  const fallback = "/";
  const raw = String(input || "").trim();
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  return raw;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const nextPath = normalizeNextPath(params.next);
  return <LoginClient nextPath={nextPath} />;
}

