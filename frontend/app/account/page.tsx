import type { Metadata } from "next";
import { Suspense } from "react";
import { I18nProvider } from "@/hooks/useI18n";
import { AccountEntry } from "@/components/account/AccountEntry";

export const metadata: Metadata = {
  title: "PolyWeather | Account Center",
  description: "PolyWeather account center for identity and entitlement status.",
};

export default function AccountPage() {
  return (
    <I18nProvider>
      <Suspense fallback={null}>
        <AccountEntry />
      </Suspense>
    </I18nProvider>
  );
}
