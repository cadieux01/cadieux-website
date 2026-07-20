import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Track Subscription | Cadieux",
  description:
    "Track upcoming Cadieux subscription deliveries and manage schedule.",
  robots: { index: false, follow: true },
};

export default function SubscriptionTrackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
