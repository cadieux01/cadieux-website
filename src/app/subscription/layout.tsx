import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Manage Your Cadieux Protein Bread Subscription",
  description:
    "Pause, skip, or update your Cadieux high protein bread subscription — deliveries, schedule, and preferences, all in one place.",
};

export default function SubscriptionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
