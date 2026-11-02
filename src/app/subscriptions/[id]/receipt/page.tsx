// /subscriptions/[id]/receipt — the customer's own printable subscription
// summary: one document per subscription.
//
// SERVER-RENDERED, and that is the security property, not a preference. The
// document carries the customer's name and phone, so the ownership check has
// to happen before the HTML exists. A client-side fetch would mean shipping
// the markup first and asking afterwards.
//
// AUTH IS THE SAME GATE AS THE ORDER RECEIPT, function for function:
// `cdx_phone_verified` read with verifyPhoneCookie (the identical verifier
// behind getVerifiedPhone(), which takes a NextRequest a server component
// does not have), the customer resolved from the VERIFIED phone, and
// subscriptionBelongsToCustomer — which IS orderBelongsToCustomer, bound
// under a second name rather than copied. 404 and not 403: a 403 would
// confirm that someone else's subscription exists, which is itself a
// disclosure.
//
// THE URL IS THE SUBSCRIPTION UUID, NOT THE OLS NUMBER. The OLS series is
// sequential and perfectly dense from 1, so a number in a URL is enumerable
// over names and phones; the receipt prints subscription_number but is never
// addressed by it. No resolver, no second series.
//
// AN UNPAID SHELL IS NOT A SUBSCRIPTION. A prepaid row is inserted before
// the customer pays, so an abandoned Razorpay sheet leaves one behind (20 of
// 118 prod rows). isHiddenSubscription answers the same 404 for those — a
// bookmarked deeplink must not render a receipt for money nobody sent.

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";

import { formatDate, formatDateTime } from "@/lib/admin-formatting";
import { formatSlotForDisplay } from "@/lib/delivery-slots";
import { RECEIPT_CUSTOMER_SELECT } from "@/lib/order-receipt";
import { PHONE_COOKIE_NAME, verifyPhoneCookie } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import { rupees } from "@/lib/payment-label";
import {
  SUBSCRIPTION_ITEM_RECEIPT_SELECT,
  SUBSCRIPTION_DELIVERY_RECEIPT_SELECT,
  SUBSCRIPTION_RECEIPT_SELECT,
  buildSubscriptionReceipt,
  subscriptionBelongsToCustomer,
  type SubscriptionDeliveryReceiptRow,
  type SubscriptionItemReceiptRow,
  type SubscriptionReceiptRow,
} from "@/lib/subscription-receipt";
import { isHiddenSubscription } from "@/lib/subscription-visibility";
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
  title: "Subscription Receipt | Cadieux",
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

export default async function SubscriptionReceiptPage({
  params,
}: {
  params: { id: string };
}) {
  const id = (params.id || "").trim();
  if (!UUID_RE.test(id)) notFound();

  const verified = verifyPhoneCookie(cookies().get(PHONE_COOKIE_NAME)?.value);
  // No session: say so, but confirm NOTHING about the subscription. Same
  // response for any id.
  if (!verified) return <SignInNotice />;

  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) notFound();

  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select(RECEIPT_CUSTOMER_SELECT)
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (!customer) notFound();

  const { data: subData, error: subErr } = await supabaseAdmin
    .from("subscriptions")
    // The single projection. See SUBSCRIPTION_RECEIPT_COLUMNS and the
    // tripwire test that holds delivery_fee_inr and total_amount in it.
    .select(SUBSCRIPTION_RECEIPT_SELECT)
    .eq("id", id)
    .maybeSingle();

  // The *_SELECT constants are built with .join(), so they are plain
  // `string` and supabase-js cannot infer the row shape the way it does from
  // a literal. Each cast names the shape its constant already defines; the
  // projection tripwire tests are what keep the two in step.
  const subscription = (subData ?? null) as SubscriptionReceiptRow | null;

  if (subErr) {
    console.error(
      "[subscriptions/[id]/receipt] subscription fetch failed:",
      subErr.message,
    );
    notFound();
  }
  // THE OWNERSHIP GATE, plus the unpaid-shell gate. Both 404.
  if (
    !subscription ||
    isHiddenSubscription(subscription) ||
    !subscriptionBelongsToCustomer(subscription, customer.id)
  ) {
    notFound();
  }

  const [itemsRes, deliveriesRes] = await Promise.all([
    supabaseAdmin
      .from("subscription_items")
      .select(SUBSCRIPTION_ITEM_RECEIPT_SELECT)
      .eq("subscription_id", id),
    supabaseAdmin
      .from("subscription_deliveries")
      .select(SUBSCRIPTION_DELIVERY_RECEIPT_SELECT)
      .eq("subscription_id", id),
  ]);

  // A READ FAILURE IS NOT AN EMPTY PLAN. Coercing either error to [] would
  // print a receipt with no lines and no dates while the grand total still
  // showed — the "total with no items" failure the order receipt was written
  // against, reached by a different route.
  if (itemsRes.error || deliveriesRes.error) {
    console.error(
      "[subscriptions/[id]/receipt] detail fetch failed:",
      itemsRes.error?.message ?? deliveriesRes.error?.message,
    );
    notFound();
  }

  const receipt = buildSubscriptionReceipt({
    subscription,
    items: (itemsRes.data ?? []) as SubscriptionItemReceiptRow[],
    deliveries: (deliveriesRes.data ?? []) as SubscriptionDeliveryReceiptRow[],
    customer,
  });

  const scheduleValue =
    receipt.weeks === null
      ? // `weeks = 0` marks a calendar-mode plan whose dates were picked
        // individually. "0 weeks" would describe a plan that ended before it
        // began, so the chosen dates are the honest answer — and they are
        // listed in full below.
        `Chosen dates · ${receipt.deliveryCount} ${
          receipt.deliveryCount === 1 ? "delivery" : "deliveries"
        }`
      : `${receipt.weeks} ${receipt.weeks === 1 ? "week" : "weeks"} · ${
          receipt.deliveryCount
        } ${receipt.deliveryCount === 1 ? "delivery" : "deliveries"}`;

  return (
    <ReceiptShell
      businessName={receipt.businessName}
      fssai={receipt.fssai}
      title={receipt.title}
      footnote="This is a subscription receipt, not a tax invoice."
    >
      <ReceiptFacts>
        <ReceiptField
          label="Subscription number"
          value={receipt.subscriptionNumber}
        />
        <ReceiptField
          label="Date"
          value={receipt.placedAt ? formatDateTime(receipt.placedAt) : null}
        />
        <ReceiptField label="Name" value={receipt.customerName} />
        <ReceiptField label="Phone" value={receipt.customerPhone} />
        <ReceiptField
          label="Start date"
          value={
            receipt.startDate
              ? // Flagged, not fudged: 3 prod rows have no start_date and the
                // first stop stands in for it.
                receipt.startDateFromFirstStop
                ? `${formatDate(receipt.startDate)} (first delivery)`
                : formatDate(receipt.startDate)
              : null
          }
        />
        <ReceiptField label="Schedule" value={scheduleValue} />
        <ReceiptField
          label="Delivery days"
          value={receipt.days.length > 0 ? receipt.days.join(", ") : null}
        />
        <ReceiptField label="Payment" value={receipt.paymentLabel} />
      </ReceiptFacts>

      <ReceiptTable>
        <thead>
          <tr style={{ borderBottom: RECEIPT_RULE }}>
            <ReceiptTh align="left">Item</ReceiptTh>
            <ReceiptTh align="right">Per delivery</ReceiptTh>
            <ReceiptTh align="right">Unit price</ReceiptTh>
            <ReceiptTh align="right">Per-delivery total</ReceiptTh>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ padding: "16px 0", opacity: 0.7 }}>
                No items recorded on this subscription.
              </td>
            </tr>
          ) : (
            receipt.lines.map((line, i) => (
              <ReceiptRow key={`${line.slug ?? "item"}-${i}`}>
                <ReceiptTd>{line.name}</ReceiptTd>
                <ReceiptTd align="right">{line.qtyPerDelivery}</ReceiptTd>
                <ReceiptTd align="right">
                  {line.unitPrice === null ? "—" : rupees(line.unitPrice)}
                </ReceiptTd>
                <ReceiptTd align="right">
                  {line.perDelivery === null ? "—" : rupees(line.perDelivery)}
                </ReceiptTd>
              </ReceiptRow>
            ))
          )}
        </tbody>
      </ReceiptTable>

      <ReceiptTotals>
        <ReceiptTotal
          label="Per delivery"
          value={
            receipt.breadPerDelivery === null
              ? null
              : rupees(receipt.breadPerDelivery)
          }
        />
        <ReceiptTotal
          label="Bread total"
          value={receipt.breadTotal === null ? null : rupees(receipt.breadTotal)}
          note={`× ${receipt.deliveryCount}`}
        />
        {/* The fee is shown ONLY when it was actually charged. On rows that
            predate subscription delivery fees the column was backfilled for
            reporting and the customer was billed bread alone, so printing it
            here would claim money that was never collected. The classifier
            decides this by ARITHMETIC against total_amount, never by
            payment_status — see lib/subscription-money.ts. */}
        {receipt.feeStatus === "charged" ? (
          <ReceiptTotal
            label="Delivery fee"
            value={receipt.feeTotal === null ? null : rupees(receipt.feeTotal)}
            note={
              receipt.feePerDelivery === null
                ? null
                : `${rupees(receipt.feePerDelivery)} × ${receipt.deliveryCount}`
            }
          />
        ) : null}
        <ReceiptTotal
          label="Total"
          value={receipt.grandTotal === null ? null : rupees(receipt.grandTotal)}
          strong
        />
      </ReceiptTotals>

      {/* Said out loud rather than smoothed over: the stored total does not
          equal bread, or bread + fee. Printing a breakdown that silently
          disagrees with the charged total is worse than admitting it. */}
      {receipt.feeStatus === "unreconciled" ? (
        <p style={{ fontSize: 11, opacity: 0.7, marginTop: 12 }}>
          The amount charged differs from this breakdown. The total above is
          what was charged — please contact us and we will explain the
          difference.
        </p>
      ) : null}

      <section style={{ marginTop: 28 }}>
        <h2
          style={{
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            opacity: 0.6,
            fontWeight: 600,
          }}
        >
          Deliveries covered
          {receipt.cancelledCount > 0
            ? ` (${receipt.cancelledCount} cancelled)`
            : ""}
        </h2>
        <ReceiptTable>
          <thead>
            <tr style={{ borderBottom: RECEIPT_RULE }}>
              <ReceiptTh align="left">Date</ReceiptTh>
              <ReceiptTh align="left">Day</ReceiptTh>
              <ReceiptTh align="left">Slot</ReceiptTh>
              <ReceiptTh align="right">Status</ReceiptTh>
            </tr>
          </thead>
          <tbody>
            {receipt.stops.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: "16px 0", opacity: 0.7 }}>
                  No deliveries recorded on this subscription.
                </td>
              </tr>
            ) : (
              receipt.stops.map((stop, i) => (
                <ReceiptRow key={stop.id ?? `stop-${i}`}>
                  {/* Cancelled stops stay listed and are marked. They were
                      part of what was bought; dropping them would leave a
                      plan whose dates do not add up to what was paid for. */}
                  <ReceiptTd muted={stop.cancelled}>
                    {stop.date ? formatDate(stop.date) : "—"}
                  </ReceiptTd>
                  <ReceiptTd muted={stop.cancelled}>
                    {stop.dayLabel ?? "—"}
                  </ReceiptTd>
                  <ReceiptTd muted={stop.cancelled}>
                    {stop.slot ? formatSlotForDisplay(stop.slot) : "—"}
                  </ReceiptTd>
                  <ReceiptTd align="right" muted={stop.cancelled}>
                    {stop.statusLabel}
                  </ReceiptTd>
                </ReceiptRow>
              ))
            )}
          </tbody>
        </ReceiptTable>
      </section>
    </ReceiptShell>
  );
}

function SignInNotice() {
  return (
    <ReceiptSignInNotice
      body={
        <>
          Open your subscription from <strong>My Subscriptions</strong> and
          verify your phone number, then return to this page.
        </>
      }
    />
  );
}
