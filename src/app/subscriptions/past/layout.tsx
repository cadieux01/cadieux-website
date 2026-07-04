import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Past Subscriptions | Cadieux",
  description:
    "Review your completed and cancelled Cadieux bread subscriptions.",
};

export default function PastSubscriptionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
