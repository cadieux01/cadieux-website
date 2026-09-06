// Admin-only layout. Scopes the Nunito font to /admin/* so the
// customer-facing site keeps its DM Sans typography untouched.
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

        /* The customer site sets a dark-green body colour. Anything in the
           admin that doesn't name its own colour inherits it — dark green on
           the near-black page, i.e. invisible. Default the whole subtree to
           CREAM so an un-styled node fails safe instead of disappearing.
           Not !important: elements that legitimately sit on a CREAM surface
           still override this with INK. */
        .admin-nunito-scope {
          color: #FBF3D4;
        }

        /* The customer site paints <body> ash (#C0C8CE). Individual admin
           pages painted their own INK container, so any page shorter than
           the viewport — or any overscroll — showed an ash gutter. Fill the
           whole subtree instead. Screen only: the print sheet is its own
           CREAM page and must not sit on an INK fill. */
        @media screen {
          .admin-nunito-scope {
            background-color: #1D1D1F;
            min-height: 100vh;
          }
        }

        /* Two-colour form fields, enforced in one place.
           Roughly fifty admin files style their own inputs inline, so a
           plain rule would lose to every one of them — hence !important.
           This is the single source for the field treatment the palette
           calls for: CREAM fill, INK text, 1px CREAM border, INK caret,
           INK-at-50% placeholder, and a 2px CREAM focus ring in place of
           the browser's blue outline. */
        .admin-nunito-scope input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]):not([type="color"]),
        .admin-nunito-scope textarea,
        .admin-nunito-scope select {
          background-color: #FBF3D4 !important;
          color: #1D1D1F !important;
          border: 1px solid #FBF3D4 !important;
          caret-color: #1D1D1F !important;
        }
        .admin-nunito-scope ::placeholder {
          color: rgba(29, 29, 31, 0.5) !important;
          opacity: 1;
        }
        .admin-nunito-scope input:focus-visible,
        .admin-nunito-scope textarea:focus-visible,
        .admin-nunito-scope select:focus-visible,
        .admin-nunito-scope button:focus-visible,
        .admin-nunito-scope a:focus-visible,
        .admin-nunito-scope [tabindex]:focus-visible {
          outline: 2px solid #FBF3D4 !important;
          outline-offset: 2px;
        }
        /* src/components/ui/Select is shared with the customer site, where
           its Foundation-Green trigger and menu are correct. Inside the admin
           that green lands on the near-black page, so re-skin it here rather
           than editing the shared component and changing the storefront.
           Option text and hover tints are already cream and need no override. */
        .admin-nunito-scope [role="combobox"] {
          background: #1D1D1F !important;
          border-color: rgba(251, 243, 212, 0.35) !important;
        }
        /* The Select menu renders in a portal on <body> so no ancestor
           overflow can clip it, which also puts it outside
           .admin-nunito-scope. This <style> only ships on /admin/*, so an
           unscoped selector here cannot reach the storefront. */
        [role="listbox"] {
          background: #1D1D1F !important;
          border-color: rgba(251, 243, 212, 0.35) !important;
        }

        /* Checkboxes and radios can't take a cream fill, so tint the
           native control instead of leaving it browser-blue. */
        .admin-nunito-scope input[type="checkbox"],
        .admin-nunito-scope input[type="radio"] {
          accent-color: #FBF3D4;
        }
      `}</style>
      <div className="admin-nunito-scope">{children}</div>
    </div>
  );
}
