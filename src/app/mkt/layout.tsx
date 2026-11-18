// /mkt is the marketing workspace. First screen is the CRM.
//
// AUTH SCOPE — /mkt and everything under it are isAdmin ONLY. The
// counter PIN that /register issues (verifyAdminOrTeamOrder) MUST NOT
// reach this tree: notes bodies, WhatsApp message bodies and the
// merged timeline are content the counter staff has no business
// reading. The real enforcement is on the per-API route (every CRM
// request goes through adminFetch into /api/admin/customers* which
// gates on isAdmin for the detail route and omits sensitive aggregate
// fields on the list route for team-PIN callers).
//
// This layout only sets a font scope and is NOT where the gate lives.
// Each /mkt page wraps its content in AdminShell, which runs the
// client-side PasswordGate (same mechanism as /admin/*). Importantly,
// AdminShell's gate verifies an ADMIN session token; it rejects every
// team-order bearer because verifyAdminSessionToken refuses any
// payload whose `p` field is not "admin" (see src/lib/admin-session).
//
// There is deliberately no server-side `redirect()` here: AdminShell
// already shows the password form inline, and the tests pin that the
// /mkt entry point renders AdminShell. Adding a second gate in this
// file would duplicate the enforcement and the failure mode (two
// different "unauthorised" states).

import type { ReactNode } from "react";
import { Nunito } from "next/font/google";

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-mkt",
  display: "swap",
});

export default function MktLayout({ children }: { children: ReactNode }) {
  // Scoped font variable only — the page's content paints its own
  // dark surface via AdminShell. Nunito matches /admin so operators
  // moving between the two don't experience a typographic jump.
  return <div className={nunito.variable}>{children}</div>;
}
