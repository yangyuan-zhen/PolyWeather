import type { Metadata } from "next";
import { I18nProvider } from "@/hooks/useI18n";
import { AccountCenter } from "@/components/account/AccountCenter";

export const metadata: Metadata = {
  title: "PolyWeather | Account Center",
  description: "PolyWeather account center for identity and entitlement status.",
};

export default function AccountPage() {
  return (
    <I18nProvider>
      <AccountCenter />
    </I18nProvider>
  );
}

