import type { Metadata } from "next";
import { SubscriptionHelpClient } from "./SubscriptionHelpClient";

export const metadata: Metadata = {
  title: "PolyWeather | Subscription Help",
  description: "PolyWeather Pro subscription, points discount, and payment guide.",
};

export default function SubscriptionHelpPage() {
  return <SubscriptionHelpClient />;
}
