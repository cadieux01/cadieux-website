import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Order Confirmed | Cadieux",
  description: "Thank you for your Cadieux order — confirmation and next steps.",
};

export default function CheckoutSuccessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
