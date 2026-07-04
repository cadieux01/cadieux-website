import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your Subscription | Cadieux",
  description:
    "Manage your Cadieux bread subscription — deliveries, schedule, and preferences.",
};

export default function SubscriptionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
