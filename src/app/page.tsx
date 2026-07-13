import type { Metadata } from "next";
import ClientApp from "./components/ClientApp";

// Only canonical is set here — title/description are inherited from the
// root layout so the homepage keeps the brand-line title
// "Cadieux | Premium Protein Bread, Visakhapatnam".
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Server Component. ClientApp is a "use client" component but Next.js still
// runs its first render on the server, so we get an SSR HTML payload (the
// LoadingScreen markup) instead of an empty <body>. This fixes a long FCP/LCP
// on the homepage where the previous ClientOnly wrapper returned null on the
// server and forced everything to render after hydration.
export default function Home() {
  return (
    <>
      {/*
        Homepage-only preload: the intro overlay's poster JPEG is the very
        first visual thing a mid-range Android user should see, so we kick
        off the fetch in the initial HTML — before React hydrates and the
        <video> element even mounts. `fetchPriority="high"` bumps it ahead
        of other assets in the connection pool. ~49 KB, one hit.
        Kept off the root layout so non-homepage routes don't pay for it.
      */}
      <link
        rel="preload"
        as="image"
        href="/logo-intro.poster.jpg"
        fetchPriority="high"
      />
      <ClientApp />
    </>
  );
}
