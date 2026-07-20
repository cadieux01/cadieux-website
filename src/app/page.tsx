import type { Metadata } from "next";
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
  },
};

// Server Component. ClientApp is a "use client" component but Next.js still
// runs its first render on the server, so we get an SSR HTML payload (the
// PageContent hero markup) instead of an empty <body>. This fixes a long
// FCP/LCP on the homepage where the previous ClientOnly wrapper returned
// null on the server and forced everything to render after hydration.
export default function Home() {
  return <ClientApp />;
}
