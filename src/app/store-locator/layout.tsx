import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cadieux Store Locator — Pickup Points in Vizag | Cadieux",
  description:
    "Find Cadieux kitchen, stalls, and partner pickup points across Visakhapatnam. Grab fresh protein bread near you or check pincode serviceability.",
};

export default function StoreLocatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
