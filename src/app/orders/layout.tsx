import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your Orders | Cadieux",
  description: "View and track your Cadieux orders and delivery status.",
};

export default function OrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
