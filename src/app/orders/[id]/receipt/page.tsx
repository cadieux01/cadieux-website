// /orders/[id]/receipt — the customer's own printable order receipt.
//
// SERVER-RENDERED, and that is the security property, not a preference. The
// document carries the customer's name, phone and delivery address, so the
// ownership check has to happen before the HTML exists. A client-side fetch
// would mean shipping the markup first and asking afterwards.
//
// AUTH IS THE SAME HMAC THE API USES. `cdx_phone_verified` is read here with
// verifyPhoneCookie — the identical verifier behind getVerifiedPhone() in
// lib/phone-cookie.ts, which takes a NextRequest a server component does not
// have. Reusing the verifier rather than re-deriving trust is the point: a
// phone in the URL is not proof of anything, and this route accepts none.
//
// Then, exactly as /api/orders/[id] does it: resolve the customer from the
// VERIFIED phone, load the order, and 404 unless the order's customer_id
// matches. 404 and not 403 — a 403 would confirm that someone else's order
// exists, which is itself a disclosure.
//
// THE URL IS THE ORDER UUID, NOT THE OLF NUMBER. The OLF series is
// sequential, so a number in a URL is enumerable; the receipt prints
// order_number but is never addressed by it. No resolver, no second series.

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";

import { formatDateTime } from "@/lib/admin-formatting";
import {
  ORDER_RECEIPT_SELECT,
  RECEIPT_CUSTOMER_SELECT,
  buildReceipt,
  orderBelongsToCustomer,
  type ReceiptLine,
  type ReceiptOrderRow,
} from "@/lib/order-receipt";
import { PHONE_COOKIE_NAME, verifyPhoneCookie } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import { rupees } from "@/lib/payment-label";

import PrintButton from "./PrintButton";

// A receipt is per-customer and must never be cached or prerendered.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order Receipt | Cadieux",
  // Nothing here should ever reach a search index.
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const INK = "#1A1A1A";
const RULE = "1px solid rgba(0,0,0,0.18)";

export default async function ReceiptPage({
  params,
}: {
  params: { id: string };
}) {
  const id = (params.id || "").trim();
  if (!UUID_RE.test(id)) notFound();

  const verified = verifyPhoneCookie(
    cookies().get(PHONE_COOKIE_NAME)?.value,
  );
  // No session: say so, but confirm NOTHING about the order. This is a
  // different outcome from "not yours" on purpose — a signed-out customer
  // who followed a link needs to know to sign in, and telling them that
  // discloses nothing, because it is the same response for any id.
  if (!verified) return <SignInNotice />;

  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) notFound();

  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select(RECEIPT_CUSTOMER_SELECT)
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (!customer) notFound();

  const { data, error } = await supabaseAdmin
    .from("orders")
    // The single projection. delivery_fee is in it — see the note on
    // RECEIPT_ORDER_COLUMNS, and the tripwire test that holds it there.
    .select(ORDER_RECEIPT_SELECT)
    .eq("id", id)
    .maybeSingle();

  // ORDER_RECEIPT_SELECT is built with .join(), so it is a plain `string` and
  // supabase-js cannot infer the row shape from it the way it does from a
  // literal. The cast names the shape the constant already defines; the
  // projection tripwire test is what keeps the two in step.
  const order = (data ?? null) as ReceiptOrderRow | null;

  if (error) {
    console.error("[orders/[id]/receipt] fetch failed:", error.message);
    notFound();
  }
  // THE OWNERSHIP GATE. Same 404-not-403 as /api/orders/[id].
  if (!order || !orderBelongsToCustomer(order, customer.id)) notFound();

  const receipt = buildReceipt({ order, customer });

  return (
    <main
      style={{
        background: "#fff",
        color: INK,
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
             receipt. This page's own content is the <main>, and the
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
          border: RULE,
          padding: 36,
        }}
      >
        <header style={{ borderBottom: RULE, paddingBottom: 18 }}>
          <div
            style={{ fontSize: 22, letterSpacing: "0.3em", fontWeight: 600 }}
          >
            {receipt.businessName.toUpperCase()}
          </div>
          <div style={{ fontSize: 11, marginTop: 6, opacity: 0.75 }}>
            FSSAI Lic. No. {receipt.fssai}
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
            {receipt.title}
          </h1>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
            padding: "18px 0",
            borderBottom: RULE,
            fontSize: 13,
          }}
        >
          <Field label="Order number" value={receipt.orderNumber} />
          <Field
            label="Date"
            value={receipt.placedAt ? formatDateTime(receipt.placedAt) : null}
          />
          <Field label="Name" value={receipt.customerName} />
          <Field label="Phone" value={receipt.customerPhone} />
          <Field
            label={receipt.fulfillment === "pickup" ? "Collection" : "Delivery address"}
            value={
              receipt.fulfillment === "pickup"
                ? "Pickup at counter"
                : receipt.deliveryAddress
            }
          />
          <Field label="Payment" value={receipt.paymentLabel} />
        </section>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            margin: "18px 0",
          }}
        >
          <thead>
            <tr style={{ borderBottom: RULE }}>
              <Th align="left">Item</Th>
              <Th align="right">Qty</Th>
              <Th align="right">Unit price</Th>
              <Th align="right">Line total</Th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{ padding: "16px 0", opacity: 0.7 }}
                >
                  No items recorded on this order.
                </td>
              </tr>
            ) : (
              receipt.lines.map((line, i) => (
                <LineRow key={`${line.slug ?? "item"}-${i}`} line={line} />
              ))
            )}
          </tbody>
        </table>

        <section
          style={{
            borderTop: RULE,
            paddingTop: 14,
            fontSize: 13,
            display: "grid",
            gap: 6,
            justifyContent: "end",
          }}
        >
          <Total label="Items subtotal" value={receipt.itemsSubtotal} />
          <Total label="Delivery fee" value={receipt.deliveryFee} />
          <Total label="Total" value={receipt.grandTotal} strong />
        </section>

        <p style={{ fontSize: 11, opacity: 0.7, marginTop: 24 }}>
          This is an order receipt, not a tax invoice.
        </p>
      </div>

      <div style={{ textAlign: "center", marginTop: 28 }}>
        <PrintButton />
      </div>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
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

function Th({
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

function LineRow({ line }: { line: ReceiptLine }) {
  return (
    <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
      <td style={{ padding: "10px 0" }}>{line.name}</td>
      <td style={{ padding: "10px 0", textAlign: "right" }}>{line.qty}</td>
      <td style={{ padding: "10px 0", textAlign: "right" }}>
        {line.unitPrice === null ? "—" : rupees(line.unitPrice)}
      </td>
      <td style={{ padding: "10px 0", textAlign: "right" }}>
        {line.lineTotal === null ? "—" : rupees(line.lineTotal)}
      </td>
    </tr>
  );
}

/** A null value prints "—", never "₹0" — see readDeliveryFee. */
function Total({
  label,
  value,
  strong,
}: {
  label: string;
  value: number | null;
  strong?: boolean;
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
      <span>{label}</span>
      <span>{value === null ? "—" : rupees(value)}</span>
    </div>
  );
}

function SignInNotice() {
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
        SIGN IN TO VIEW THIS RECEIPT
      </h1>
      <p style={{ fontSize: 13, opacity: 0.75, marginTop: 12 }}>
        Open your order from <strong>My Orders</strong> and verify your phone
        number, then return to this page.
      </p>
    </main>
  );
}
