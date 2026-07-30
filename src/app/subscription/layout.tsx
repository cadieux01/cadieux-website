import type { Metadata } from "next";

// The /subscription hub is a signed-in utility page (three smart cards
// keyed off localStorage phone → active/past subscription counts). It
// competes on the same "subscription" keyword as the SEO landing at
// /subscribe, so we noindex it — search should land on /subscribe,
// signed-in users still bookmark and use /subscription freely.
// `follow: true` so any internal links on the hub still pass equity.
export const metadata: Metadata = {
  title: "Manage Your Cadieux Protein Bread Subscription",
  description:
    "Pause, skip, or update your Cadieux high protein bread subscription — deliveries, schedule, and preferences, all in one place.",
  robots: { index: false, follow: true },
};

export default function SubscriptionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
