import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Start a Protein Bread Subscription | Cadieux",
  description:
    "Subscribe to Cadieux high protein bread — weekly delivery in Visakhapatnam. Pick a loaf, choose your cadence, save on every order.",
};

export default function SubscriptionSetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
