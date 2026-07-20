import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Checkout | Cadieux",
  description:
    "Complete your Cadieux order — delivery details and payment.",
  robots: { index: false, follow: true },
};

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
