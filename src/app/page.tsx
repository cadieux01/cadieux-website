import type { Metadata } from "next";
import ReactDOM from "react-dom";
import ClientApp from "./components/ClientApp";

// Only canonical is set here — title/description are inherited from the
// root layout so the homepage keeps the brand-line title
// "Cadieux | Premium Protein Bread, Visakhapatnam".
export const metadata: Metadata = {
  title: "Cadieux — High Protein Bread, Baked Fresh in Visakhapatnam",
  description:
    "Premium high protein bread from Cadieux — lab-tested, low-carb, and delivered fresh across Visakhapatnam. More protein. Same routine.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "https://www.cadieux.in/",
    title: "Cadieux — High Protein Bread, Baked Fresh in Visakhapatnam",
    description:
      "Premium high protein bread from Cadieux — lab-tested, low-carb, and delivered fresh across Visakhapatnam.",
    // MUST be declared here. Next.js replaces the parent openGraph object
    // wholesale rather than merging field-by-field, so omitting `images` wiped
    // the root layout's entry and left the page with NO og:image at all —
    // which sent WhatsApp/Instagram scrapers off to pick an image out of the
    // page themselves. They landed on a decorative stock grain texture.
    images: [
      {
        url: "https://www.cadieux.in/icons/icon-512.png",
        width: 512,
        height: 512,
        alt: "Cadieux logo",
      },
    ],
  },
};

// Server Component. ClientApp is a "use client" component but Next.js still
// runs its first render on the server, so we get an SSR HTML payload (the
// PageContent hero markup) instead of an empty <body>. This fixes a long
// FCP/LCP on the homepage where the previous ClientOnly wrapper returned
// null on the server and forced everything to render after hydration.
export default function Home() {
  // The hero bread-intro video's poster is now the true first paint (the
  // intro splash was removed in b2c94d0). Preload it so it renders without a
  // blank green frame — this replaces the logo-intro poster preload we
  // dropped with the one that's actually on screen.
  ReactDOM.preload("/bread-intro.poster.jpg", {
    as: "image",
    fetchPriority: "high",
  });
  return <ClientApp />;
}
