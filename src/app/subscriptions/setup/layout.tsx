import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Start a Subscription | Cadieux",
  description:
    "Set up your Cadieux bread subscription — pick a plan, cadence, and delivery address.",
};

export default function SubscriptionSetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
