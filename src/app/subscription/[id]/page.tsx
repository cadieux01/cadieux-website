// Legacy detail page. The active per-delivery view now lives at
// /subscriptions/track/[deliveryId]; the per-subscription summary is rolled
// into /subscriptions/track. Bounce visitors to the dashboard.
import { redirect } from "next/navigation";

export default function LegacySubscriptionDetailRedirect() {
  redirect("/subscriptions/track");
}
