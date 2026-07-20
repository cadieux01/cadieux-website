import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subscription Payment | Cadieux",
  description: "Pay for your new Cadieux bread subscription.",
  robots: { index: false, follow: true },
};

export default function SubscriptionPaymentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
