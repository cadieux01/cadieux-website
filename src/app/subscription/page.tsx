// Legacy entry point. The new flow lives at /subscriptions/setup (wizard) and
// /subscriptions/track (existing-subscription dashboard). Send returning users
// to track so they see their active plans first; cold visitors will still get
// the empty-state "Start a plan" CTA there which routes onward to /setup.
import { redirect } from "next/navigation";

export default function LegacySubscriptionRedirect() {
  redirect("/subscriptions/track");
}
