import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Store Locator | Cadieux",
  description:
    "Find Cadieux pickup points and check serviceability for your pincode in Visakhapatnam.",
};

export default function StoreLocatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
