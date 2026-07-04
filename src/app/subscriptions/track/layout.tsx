import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Track Subscription | Cadieux",
  description:
    "Track upcoming Cadieux subscription deliveries and manage schedule.",
};

export default function SubscriptionTrackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
