import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Order Tracking | Cadieux",
  description:
    "Track your Cadieux order — delivery status, payment, and change requests.",
  robots: { index: false, follow: true },
};

export default function OrderDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
