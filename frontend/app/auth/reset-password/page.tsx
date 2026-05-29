import { ResetPasswordClient } from "@/components/auth/ResetPasswordClient";
import { I18nProvider } from "@/hooks/useI18n";

type PageProps = {
  searchParams?: Promise<{ next?: string }>;
};

function normalizeNextPath(input: string | undefined) {
  const fallback = "/account";
  const raw = String(input || "").trim();
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  return raw;
}

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const nextPath = normalizeNextPath(params.next);
  return (
    <I18nProvider>
      <ResetPasswordClient nextPath={nextPath} />
    </I18nProvider>
  );
}
