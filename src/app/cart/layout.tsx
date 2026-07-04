import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cart | Cadieux",
  description: "Review the loaves in your Cadieux cart before checkout.",
};

export default function CartLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
