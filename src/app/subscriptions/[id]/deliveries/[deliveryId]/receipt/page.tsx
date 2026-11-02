// /subscriptions/[id]/deliveries/[deliveryId]/receipt — one printable note
// per subscription_deliveries row.
//
// SAME AUTH AS THE OTHER TWO RECEIPTS, and then one gate more.
//
// The subscription is loaded and owned-checked first, exactly as
// /subscriptions/[id]/receipt does it. Then the delivery is fetched with
// BOTH `id` AND `subscription_id` in the filter, so a delivery UUID lifted
// from another customer's plan cannot be rendered under a header this
// customer does own. Filtering on the id alone and checking the parent
// afterwards would also work, but it reads the row first; this way the
// database never returns it. Either way the answer is 404, never 403 — a 403
// confirms the row exists.
//
// NO MONEY ON THIS DOCUMENT, deliberately — see the header of
// lib/subscription-receipt.ts. One payment covers the whole plan, and a
// figure on a note handed over at the door reads as a second amount due.
// The money is on the subscription summary, once.
//
// THE DATE AND THE SLOT ARE THE SCHEDULED ONES, and the weekday is DERIVED
// from the date. `day_key` is a weekday stamped at creation and never
// rewritten on a move — stale on 11 of 451 prod rows — so it is not even
// projected. All three rules live in lib/subscription-receipt.ts.

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";

import { formatDate } from "@/lib/admin-formatting";
import { formatSlotForDisplay } from "@/lib/delivery-slots";
import { RECEIPT_CUSTOMER_SELECT } from "@/lib/order-receipt";
import { PHONE_COOKIE_NAME, verifyPhoneCookie } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import {
  SUBSCRIPTION_ITEM_RECEIPT_SELECT,
  SUBSCRIPTION_DELIVERY_RECEIPT_SELECT,
  SUBSCRIPTION_RECEIPT_SELECT,
  buildDeliveryReceipt,
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
} from "@/components/ReceiptShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Delivery Receipt | Cadieux",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export default async function DeliveryReceiptPage({
  params,
}: {
  params: { id: string; deliveryId: string };
}) {
  const id = (params.id || "").trim();
  const deliveryId = (params.deliveryId || "").trim();
  if (!UUID_RE.test(id) || !UUID_RE.test(deliveryId)) notFound();

  const verified = verifyPhoneCookie(cookies().get(PHONE_COOKIE_NAME)?.value);
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
    .select(SUBSCRIPTION_RECEIPT_SELECT)
    .eq("id", id)
    .maybeSingle();

  const subscription = (subData ?? null) as SubscriptionReceiptRow | null;

  if (subErr) {
    console.error(
      "[subscriptions/[id]/deliveries/[deliveryId]/receipt] subscription fetch failed:",
      subErr.message,
    );
    notFound();
  }
  if (
    !subscription ||
    isHiddenSubscription(subscription) ||
    !subscriptionBelongsToCustomer(subscription, customer.id)
  ) {
    notFound();
  }

  const [deliveryRes, itemsRes] = await Promise.all([
    supabaseAdmin
      .from("subscription_deliveries")
      .select(SUBSCRIPTION_DELIVERY_RECEIPT_SELECT)
      // BOTH filters. The second is the gate that stops a delivery id from
      // another plan rendering under this customer's header.
      .eq("id", deliveryId)
      .eq("subscription_id", id)
      .maybeSingle(),
    supabaseAdmin
      .from("subscription_items")
      .select(SUBSCRIPTION_ITEM_RECEIPT_SELECT)
      .eq("subscription_id", id),
  ]);

  // maybeSingle() CANNOT TELL "missing" FROM "fine": 0 rows resolve to
  // `data: null, error: null`. So the null is checked explicitly, and a
  // failed READ is distinguished from a row that is not there.
  if (deliveryRes.error || itemsRes.error) {
    console.error(
      "[subscriptions/[id]/deliveries/[deliveryId]/receipt] detail fetch failed:",
      deliveryRes.error?.message ?? itemsRes.error?.message,
    );
    notFound();
  }
  const delivery = (deliveryRes.data ??
    null) as SubscriptionDeliveryReceiptRow | null;
  if (!delivery) notFound();

  const receipt = buildDeliveryReceipt({
    subscription,
    items: (itemsRes.data ?? []) as SubscriptionItemReceiptRow[],
    delivery,
    customer,
  });

  return (
    <ReceiptShell
      businessName={receipt.businessName}
      fssai={receipt.fssai}
      title={receipt.title}
      subtitle={
        receipt.subscriptionNumber
          ? `Subscription ${receipt.subscriptionNumber}`
          : null
      }
      footnote="This is a delivery receipt, not a tax invoice. Payment for this delivery is covered by the subscription above."
      printLabel="Download note"
    >
      <ReceiptFacts>
        <ReceiptField
          label="Delivery date"
          value={receipt.date ? formatDate(receipt.date) : null}
        />
        <ReceiptField label="Day" value={receipt.dayLabel} />
        <ReceiptField
          label="Slot"
          value={receipt.slot ? formatSlotForDisplay(receipt.slot) : null}
        />
        <ReceiptField label="Status" value={receipt.statusLabel} />
        <ReceiptField
          label="Subscription"
          value={receipt.subscriptionNumber}
        />
        <ReceiptField
          label="Delivery"
          value={
            receipt.sequence === null
              ? null
              : receipt.weekNumber === null
                ? `No. ${receipt.sequence}`
                : `No. ${receipt.sequence} · week ${receipt.weekNumber}`
          }
        />
        <ReceiptField label="Name" value={receipt.customerName} />
        <ReceiptField label="Phone" value={receipt.customerPhone} />
      </ReceiptFacts>

      {/* A cancelled stop still lists its items — see buildDeliveryReceipt.
          Saying so at the top is the difference between a note about a
          cancellation and a note that looks like a live delivery. */}
      {receipt.cancelled ? (
        <p style={{ fontSize: 12, marginTop: 16, fontWeight: 600 }}>
          This delivery was cancelled.
        </p>
      ) : null}

      <ReceiptTable>
        <thead>
          <tr style={{ borderBottom: RECEIPT_RULE }}>
            <ReceiptTh align="left">Item</ReceiptTh>
            <ReceiptTh align="right">Qty</ReceiptTh>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.length === 0 ? (
            <tr>
              <td colSpan={2} style={{ padding: "16px 0", opacity: 0.7 }}>
                No items recorded on this delivery.
              </td>
            </tr>
          ) : (
            receipt.lines.map((line, i) => (
              <ReceiptRow key={`${line.slug ?? "item"}-${i}`}>
                <ReceiptTd muted={receipt.cancelled}>{line.name}</ReceiptTd>
                <ReceiptTd align="right" muted={receipt.cancelled}>
                  {line.qty}
                </ReceiptTd>
              </ReceiptRow>
            ))
          )}
        </tbody>
      </ReceiptTable>
    </ReceiptShell>
  );
}

function SignInNotice() {
  return (
    <ReceiptSignInNotice
      heading="SIGN IN TO VIEW THIS DELIVERY"
      body={
        <>
          Open your subscription from <strong>My Subscriptions</strong> and
          verify your phone number, then return to this page.
        </>
      }
    />
  );
}
