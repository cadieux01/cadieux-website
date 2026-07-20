import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Order Confirmed | Cadieux",
  description: "Thank you for your Cadieux order — confirmation and next steps.",
  robots: { index: false, follow: true },
};

export default function CheckoutSuccessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
