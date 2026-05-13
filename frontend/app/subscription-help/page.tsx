import type { Metadata } from "next";
import { SubscriptionHelpClient } from "./SubscriptionHelpClient";
import { I18nProvider } from "@/hooks/useI18n";

export const metadata: Metadata = {
  title: "PolyWeather | Subscription Help",
  description: "PolyWeather Pro subscription, points discount, and payment guide.",
};

export default function SubscriptionHelpPage() {
  return (
    <I18nProvider>
      <SubscriptionHelpClient />
    </I18nProvider>
  );
}
