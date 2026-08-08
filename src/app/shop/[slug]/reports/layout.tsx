import type { Metadata } from "next";

// Per-product test-report placeholders while final trials are under
// process. The child page is a client component that can't export
// metadata itself; this layout supplies title/description/robots.
// Noindex,follow because the visible page currently only says the
// reports are being re-verified — no evidence for Google to index —
// while `follow` keeps link equity flowing back to the PDP + /shop.
// Existing internal links (Product page → Reports, /reports index →
// per-product) are unchanged.
export const metadata: Metadata = {
  title: "Test Reports | Cadieux",
  description:
    "Independent test reports for Cadieux protein bread — currently under re-verification.",
  robots: { index: false, follow: true },
};

export default function ProductReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
