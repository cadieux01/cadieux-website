"use client";

import { usePathname } from "next/navigation";
import Nav from "./Nav";

// `showSandwich` is passed by the SERVER root layout after reading
// getSandwichKitchenState() — never by the client. Keeping this component
// client-only (needs usePathname for the /admin skip) but flag-agnostic
// keeps the drawer's "is the kitchen open?" answer authoritative on the
// server, so a JS-disabled browser never briefly flashes the "Sandwich"
// entry during hydration when the switch is off.
export default function NavGate({ showSandwich = false }: { showSandwich?: boolean }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;
  return <Nav showSandwich={showSandwich} />;
}
