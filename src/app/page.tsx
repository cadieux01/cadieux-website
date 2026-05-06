import ClientApp from "./components/ClientApp";

// Server Component. ClientApp is a "use client" component but Next.js still
// runs its first render on the server, so we get an SSR HTML payload (the
// LoadingScreen markup) instead of an empty <body>. This fixes a long FCP/LCP
// on the homepage where the previous ClientOnly wrapper returned null on the
// server and forced everything to render after hydration.
export default function Home() {
  return <ClientApp />;
}
