// Shared PDP FAQ list — kept in a plain module (not the page.tsx itself)
// because Next.js only allows a specific set of named exports from page
// files (`default`, `generateMetadata`, `generateStaticParams`, etc).
//
// This list is the SINGLE source of truth for two consumers on the PDP:
//   1. The FAQPage JSON-LD schema emitted by shop/[slug]/page.tsx.
//   2. The visible <details>/<summary> FAQ section rendered by
//      ProductDetailClient.tsx.
// Google requires the visible answer text to match the schema answer
// exactly (they crawl the DOM to verify), so a single source of truth
// avoids drift.
//
// Copy adheres to the brand-voice rules: no comparison with regular
// bread, no exclamation marks, no reader-instruction ("you should"),
// short sentences, no nutrition figures until the FSSAI label is on
// the physical loaf.

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
    a: "Every recipe is baked to a formula that is periodically tested by NABL-accredited labs. Full lab reports for each variant are on the Reports link on this page.",
  },
  {
    q: "What is the nutrition information per slice?",
    a: "Publishing with our FSSAI label.",
  },
  {
    q: "Where can I find Cadieux in a store?",
    a: "In a growing list of Vizag stockists. The full list, with a search, is on our store-locator page.",
  },
];
