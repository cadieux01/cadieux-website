// Admin-only layout. Scopes the Nunito font to /admin/* so the
// customer-facing site keeps its Cormorant + Jost pairing untouched.
//
// AdminShell pages and many sub-components set fontFamily inline (e.g.
// "var(--font-body)" or a MONO stack). Without !important, those inline
// styles would beat a regular CSS rule, so the scoped override below
// forces every element inside the admin tree onto Nunito — including
// form controls (input/select/textarea/button) which never inherit
// fontFamily by default.

import type { ReactNode } from "react";
import { Nunito } from "next/font/google";

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-admin",
  display: "swap",
});

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className={nunito.variable}>
      <style>{`
        .admin-nunito-scope,
        .admin-nunito-scope * {
          font-family: var(--font-admin), 'Nunito', sans-serif !important;
        }
      `}</style>
      <div className="admin-nunito-scope">{children}</div>
    </div>
  );
}
