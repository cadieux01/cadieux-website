// Shared PDP FAQ list — kept in a plain module (not the page.tsx itself)
// because Next.js only allows a specific set of named exports from page
// files (`default`, `generateMetadata`, `generateStaticParams`, etc).
//
// Consumer: the visible <details>/<summary> FAQ section rendered by
// ProductDetailClient.tsx. FAQPage JSON-LD was removed after Google
// deprecated FAQ rich results (May 2026); this list is the visible-copy
// source of truth only.
//
// Copy adheres to the brand-voice rules: no comparison with regular
// bread, no exclamation marks, no reader-instruction ("you should"),
// short sentences, no nutrition figures until the FSSAI label is on
// the physical loaf. The nutrition-per-slice Q was intentionally
// dropped — raising it on the PDP without an on-page answer is a
// conversion negative; the FSSAI label at point-of-consumption is
// where that question belongs.

export type PdpFaq = { q: string; a: string };

export const PDP_FAQS: PdpFaq[] = [
  {
    q: "What is Cadieux Protein Bread?",
    a: "A slow-fermented, high-protein loaf baked in our own kitchen in Visakhapatnam. Each variant is made from a small, transparent ingredient list — no maida, no refined sugar, no artificial preservatives.",
  },
  {
    q: "How is it delivered?",
    a: "Fresh delivery across Visakhapatnam on the day it is baked. Order by the day's cut-off for same-day or next-day service depending on your area. Delivery windows are shown at checkout.",
  },
  {
    q: "How long does the bread stay fresh?",
    a: "The loaf ships with no artificial preservatives, so ambient shelf life is short by design. Refrigerate on arrival and consume within the printed date on the label. The bread also freezes well slice by slice.",
  },
  {
    q: "Is it lab-tested?",
    a: "The recipe was developed over 18 months across 60 to 70 parameters and verified at three independent NABL-accredited laboratories. Reports for each variant are linked on this page.",
  },
  {
    q: "Where can I find Cadieux in a store?",
    a: "In a growing list of Vizag stockists. The full list, with a search, is on our store-locator page.",
  },
];
