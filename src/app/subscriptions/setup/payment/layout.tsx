import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subscription Payment | Cadieux",
  description: "Pay for your new Cadieux bread subscription.",
};

export default function SubscriptionPaymentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
