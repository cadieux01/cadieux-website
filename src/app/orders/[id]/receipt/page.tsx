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
import {
  RECEIPT_RULE,
  ReceiptFacts,
  ReceiptField,
  ReceiptRow,
  ReceiptShell,
  ReceiptSignInNotice,
  ReceiptTable,
  ReceiptTd,
  ReceiptTh,
  ReceiptTotal,
  ReceiptTotals,
} from "@/components/ReceiptShell";

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

// The sheet, its print rules and these primitives all live in
// @/components/ReceiptShell — three documents print on the same paper and a
// second copy of the print block is how the music-button bug would come back.
const RULE = RECEIPT_RULE;

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
    <ReceiptShell
      businessName={receipt.businessName}
      fssai={receipt.fssai}
      title={receipt.title}
      footnote="This is an order receipt, not a tax invoice."
    >
      <ReceiptFacts>
        <ReceiptField label="Order number" value={receipt.orderNumber} />
        <ReceiptField
          label="Date"
          value={receipt.placedAt ? formatDateTime(receipt.placedAt) : null}
        />
        <ReceiptField label="Name" value={receipt.customerName} />
        <ReceiptField label="Phone" value={receipt.customerPhone} />
        <ReceiptField
          label={
            receipt.fulfillment === "pickup" ? "Collection" : "Delivery address"
          }
          value={
            receipt.fulfillment === "pickup"
              ? "Pickup at counter"
              : receipt.deliveryAddress
          }
        />
        <ReceiptField label="Payment" value={receipt.paymentLabel} />
      </ReceiptFacts>

      <ReceiptTable>
        <thead>
          <tr style={{ borderBottom: RULE }}>
            <ReceiptTh align="left">Item</ReceiptTh>
            <ReceiptTh align="right">Qty</ReceiptTh>
            <ReceiptTh align="right">Unit price</ReceiptTh>
            <ReceiptTh align="right">Line total</ReceiptTh>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ padding: "16px 0", opacity: 0.7 }}>
                No items recorded on this order.
              </td>
            </tr>
          ) : (
            receipt.lines.map((line, i) => (
              <LineRow key={`${line.slug ?? "item"}-${i}`} line={line} />
            ))
          )}
        </tbody>
      </ReceiptTable>

      <ReceiptTotals>
        <ReceiptTotal
          label="Items subtotal"
          value={rupees(receipt.itemsSubtotal)}
        />
        <ReceiptTotal
          label="Delivery fee"
          value={receipt.deliveryFee === null ? null : rupees(receipt.deliveryFee)}
        />
        <ReceiptTotal
          label="Total"
          value={receipt.grandTotal === null ? null : rupees(receipt.grandTotal)}
          strong
        />
      </ReceiptTotals>
    </ReceiptShell>
  );
}

function LineRow({ line }: { line: ReceiptLine }) {
  return (
    <ReceiptRow>
      <ReceiptTd>{line.name}</ReceiptTd>
      <ReceiptTd align="right">{line.qty}</ReceiptTd>
      <ReceiptTd align="right">
        {line.unitPrice === null ? "—" : rupees(line.unitPrice)}
      </ReceiptTd>
      <ReceiptTd align="right">
        {line.lineTotal === null ? "—" : rupees(line.lineTotal)}
      </ReceiptTd>
    </ReceiptRow>
  );
}

function SignInNotice() {
  return (
    <ReceiptSignInNotice
      body={
        <>
          Open your order from <strong>My Orders</strong> and verify your phone
          number, then return to this page.
        </>
      }
    />
  );
}
