import { EntitlementRequiredClient } from "./EntitlementRequiredClient";
import { I18nProvider } from "@/hooks/useI18n";

type Props = {
  searchParams?: Promise<{ next?: string }>;
};

export default async function EntitlementRequiredPage({ searchParams }: Props) {
  const params = (await searchParams) || {};
  const nextPath = params.next || "/";

  return (
    <I18nProvider>
      <EntitlementRequiredClient nextPath={nextPath} />
    </I18nProvider>
  );
}
