import type { Metadata } from "next";

// Route-level metadata for the client-only Addresses page. Kept in a
// layout because "use client" pages can't export metadata directly.
export const metadata: Metadata = {
  title: "Saved Addresses | Cadieux",
  description:
    "Manage the delivery addresses saved to your Cadieux account.",
};

export default function AddressesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
