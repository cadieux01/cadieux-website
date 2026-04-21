"use client";

import { usePathname } from "next/navigation";
import Nav from "./Nav";

export default function NavGate() {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;
  return <Nav />;
}
