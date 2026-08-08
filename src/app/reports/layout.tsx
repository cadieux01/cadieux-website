import type { Metadata } from "next";

// Noindex while reports are being re-verified — the visible page is a
// placeholder that links to per-product placeholders (also noindex).
// `follow` is kept so link equity still flows out to /shop and the PDPs.
// Title/description dropped their "NABL Lab Reports" + macronutrient-tour
// phrasing (the physical reports have not yet published, so those claims
// can't be substantiated on-page). Existing internal links and the
// visible page are unchanged.
export const metadata: Metadata = {
  title: "Reports | Cadieux",
  description:
    "Independent test reports for Cadieux protein bread — currently under re-verification.",
  robots: { index: false, follow: true },
};

export default function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
