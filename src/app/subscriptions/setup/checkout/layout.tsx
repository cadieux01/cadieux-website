import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subscription Checkout | Cadieux",
  description: "Confirm details for your new Cadieux subscription.",
};

export default function SubscriptionCheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
