import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Delivery Tracking | Cadieux",
  description:
    "Track this Cadieux subscription delivery — status, ETA, and delivery details.",
};

export default function SubscriptionDeliveryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
