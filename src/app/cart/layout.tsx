import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cart | Cadieux",
  description: "Review the loaves in your Cadieux cart before checkout.",
  robots: { index: false, follow: true },
};

export default function CartLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
