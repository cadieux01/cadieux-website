// THE receipt renderer. One sheet, one set of print rules, three documents.
//
// The order receipt, the subscription summary and the per-delivery note are
// different DOCUMENTS but the same PIECE OF PAPER: same letterhead, same
// FSSAI disclosure, same "not a tax invoice" footnote, same print rules.
// Those are exactly the things that must never drift apart, so they live
// here once instead of being spelled out per route.
//
// The print block is the reason this extraction is load-bearing rather than
// tidy. It took a measured bug to get right (see the comment on it below),
// and a second hand-written copy would have shipped the bug again on two
// more documents. Fixing it here fixes it everywhere, and the tripwire in
// tests/receipt-print.test.mjs asserts the rule on THIS file.
//
// Server component on purpose — no "use client". Everything a receipt
// prints is authorised on the server before the HTML exists; the only
// browser code is the PrintButton leaf.

import PrintButton from "@/components/PrintButton";

export const RECEIPT_INK = "#1A1A1A";
export const RECEIPT_RULE = "1px solid rgba(0,0,0,0.18)";
const HAIRLINE = "1px solid rgba(0,0,0,0.08)";

/**
 * The sheet.
 *
 * @param title    the document's own title. ALWAYS a receipt — never
 *                 "Invoice" or "Tax Invoice". See the header of
 *                 lib/order-receipt.ts for why that distinction is legal
 *                 rather than cosmetic: no GSTIN, no tax line, no HSN.
 * @param subtitle optional second line, e.g. the OLS number a delivery
 *                 note belongs to.
 * @param footnote the disclaimer. Defaults to the one every document needs.
 */
export function ReceiptShell({
  businessName,
  fssai,
  title,
  subtitle,
  footnote = "This is a receipt, not a tax invoice.",
  printLabel,
  children,
}: {
  businessName: string;
  fssai: string;
  title: string;
  subtitle?: string | null;
  footnote?: string;
  printLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      style={{
        background: "#fff",
        color: RECEIPT_INK,
        minHeight: "100vh",
        padding: "32px 20px 64px",
        fontFamily: "var(--font-dm-sans, system-ui, sans-serif)",
      }}
    >
      {/* Print rules. The button and the site chrome come off the paper;
          the sheet itself drops its screen margins so it fills A4. */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          /* ONLY THE DOCUMENT GOES ON PAPER. Naming tags here does not
             work: the root layout's chrome is a bare <div> for the
             off-canvas drawer and a bare <button> for the floating music
             toggle, so "header, footer, nav" matched neither and the
             music button — position:fixed and on-screen — printed on the
             receipt. This shell's own content is the <main>, and the
             print button inside it is .no-print, so excluding everything
             else at body level is both sufficient and stable against the
             chrome being re-tagged later. Hiding the sibling <style>/
             <script> nodes is harmless; a stylesheet still applies when
             its element is display:none. */
          body > *:not(main) { display: none !important; }
          @page { margin: 14mm; }
          html, body { background: #fff !important; }
          main { padding: 0 !important; }
          .receipt-sheet {
            border: none !important;
            max-width: none !important;
            padding: 0 !important;
          }
        }
      `}</style>

      <div
        className="receipt-sheet"
        style={{
          maxWidth: 720,
          margin: "0 auto",
          border: RECEIPT_RULE,
          padding: 36,
        }}
      >
        <header style={{ borderBottom: RECEIPT_RULE, paddingBottom: 18 }}>
          <div
            style={{ fontSize: 22, letterSpacing: "0.3em", fontWeight: 600 }}
          >
            {businessName.toUpperCase()}
          </div>
          <div style={{ fontSize: 11, marginTop: 6, opacity: 0.75 }}>
            FSSAI Lic. No. {fssai}
          </div>
          <h1
            style={{
              fontSize: 13,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              marginTop: 18,
              fontWeight: 600,
            }}
          >
            {title}
          </h1>
          {subtitle ? (
            <div style={{ fontSize: 12, marginTop: 6, opacity: 0.7 }}>
              {subtitle}
            </div>
          ) : null}
        </header>

        {children}

        <p style={{ fontSize: 11, opacity: 0.7, marginTop: 24 }}>{footnote}</p>
      </div>

      <div style={{ textAlign: "center", marginTop: 28 }}>
        <PrintButton label={printLabel} />
      </div>
    </main>
  );
}

/** The two-column facts block under the letterhead. */
export function ReceiptFacts({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 20,
        padding: "18px 0",
        borderBottom: RECEIPT_RULE,
        fontSize: 13,
      }}
    >
      {children}
    </section>
  );
}

/** One labelled fact. A null value prints "—", never a blank or a guess. */
export function ReceiptField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          opacity: 0.6,
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 3 }}>{value ?? "—"}</div>
    </div>
  );
}

export function ReceiptTable({ children }: { children: React.ReactNode }) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 13,
        margin: "18px 0",
      }}
    >
      {children}
    </table>
  );
}

export function ReceiptTh({
  children,
  align,
}: {
  children: React.ReactNode;
  align: "left" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "8px 0",
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        opacity: 0.6,
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  );
}

export function ReceiptTd({
  children,
  align = "left",
  muted,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  muted?: boolean;
}) {
  return (
    <td
      style={{
        padding: "10px 0",
        textAlign: align,
        opacity: muted ? 0.6 : 1,
      }}
    >
      {children}
    </td>
  );
}

export function ReceiptRow({ children }: { children: React.ReactNode }) {
  return <tr style={{ borderBottom: HAIRLINE }}>{children}</tr>;
}

export function ReceiptTotals({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        borderTop: RECEIPT_RULE,
        paddingTop: 14,
        fontSize: 13,
        display: "grid",
        gap: 6,
        justifyContent: "end",
      }}
    >
      {children}
    </section>
  );
}

/**
 * One money row.
 *
 * A NULL VALUE PRINTS "—", NEVER "₹0". The two are different claims: a real
 * zero is a free delivery, an absent one means the column was not projected
 * or predates the fee. See readDeliveryFee in lib/order-receipt.ts — that
 * bug class has already cost ₹525 across 18 orders.
 */
export function ReceiptTotal({
  label,
  value,
  strong,
  note,
}: {
  label: string;
  value: string | null;
  strong?: boolean;
  note?: string | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 28,
        justifyContent: "space-between",
        minWidth: 260,
        fontWeight: strong ? 600 : 400,
        fontSize: strong ? 15 : 13,
      }}
    >
      <span>
        {label}
        {note ? (
          <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 11 }}>
            {" "}
            {note}
          </span>
        ) : null}
      </span>
      <span>{value ?? "—"}</span>
    </div>
  );
}

/**
 * Shown to a caller with no verified phone.
 *
 * Deliberately a DIFFERENT outcome from "not yours", which is a 404: a
 * signed-out customer who followed a link needs to know to sign in, and
 * telling them that discloses nothing, because it is the same response for
 * any id. Confirming that a particular document EXISTS is the disclosure,
 * and this page never does.
 */
export function ReceiptSignInNotice({
  heading = "SIGN IN TO VIEW THIS RECEIPT",
  body,
}: {
  heading?: string;
  body: React.ReactNode;
}) {
  return (
    <main
      style={{
        minHeight: "60vh",
        display: "grid",
        placeContent: "center",
        padding: 32,
        textAlign: "center",
        fontFamily: "var(--font-dm-sans, system-ui, sans-serif)",
      }}
    >
      <h1 style={{ fontSize: 14, letterSpacing: "0.22em", fontWeight: 600 }}>
        {heading}
      </h1>
      <p style={{ fontSize: 13, opacity: 0.75, marginTop: 12 }}>{body}</p>
    </main>
  );
}
