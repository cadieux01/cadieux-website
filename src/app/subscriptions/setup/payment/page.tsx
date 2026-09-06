"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  SETUP_PRODUCTS,
  buildDeliveries,
  clearSetupState,
  fetchSubscriptionPlans,
  formatSlot,
  longDayLabel,
  loadAddress,
  loadSetupState,
  parseIso,
  totalUnitsPerDelivery,
  amountPerDelivery,
  type SetupAddress,
  type SetupState,
  type WizardProduct,
} from "@/lib/subscription-setup";
import {
  MIN_SUBSCRIPTION_DAYS_PER_WEEK,
  distinctWeekdaysFromDates,
} from "@/lib/subscription-min-days";
// Pure math + the band table only. Importing from
// @/lib/subscription-delivery-fee here would drag Google + the Supabase
// service-role client into the browser bundle.
import { MAX_DELIVERY_KM } from "@/lib/deliveryFee";
import { computeSubscriptionTotal, toPaise } from "@/lib/subscription-total";

const BG = "#C0C8CE";
const GOLD = "#024628";
const TEXT = "#024628";
const FADED = "rgba(2,70,40,0.6)";
const FAINT = "rgba(2,70,40,0.2)";
const RED = "#991B1B";

/** Fee preview state. `null` while loading; `blocked` when we can't price
 *  this address at all (bad pincode / no distance / out of range) — the
 *  same conditions the server refuses on, surfaced before payment. */
type FeeState =
  | { status: "loading" }
  | { status: "ok"; feeInr: number; distanceKm: number }
  | { status: "blocked"; message: string };

/** An unpaid subscription row plus the Razorpay order raised against it. */
type PendingPayment = {
  subscriptionId: string;
  razorpayOrderId: string;
  /** Server-computed paise. Also the key we re-check a retry against. */
  amount: number;
  currency: string;
  keyId: string | null;
};

export default function PaymentPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<SetupState | null>(null);
  const [address, setAddress] = useState<SetupAddress | null>(null);
  const [fee, setFee] = useState<FeeState>({ status: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Live wizard catalogue. Starts from the hardcoded fallback so the
  // summary always renders something; replaced by DB prices once the
  // public API responds.
  const [plans, setPlans] = useState<WizardProduct[]>(SETUP_PRODUCTS);

  // The unpaid subscription + Razorpay order raised by the FIRST attempt.
  //
  // Closing the Razorpay sheet used to leave this behind and start over, so
  // every retry minted another row and another Razorpay order — five
  // fumbled attempts meant five unpaid shells for one customer. Holding it
  // here lets a retry reopen the SAME order. A ref, not state, because
  // nothing renders from it and it must be readable inside the handler
  // closure without re-running the effect.
  const pendingRef = useRef<PendingPayment | null>(null);

  useEffect(() => {
    setHydrated(true);
    const s = loadSetupState();
    const a = loadAddress();
    // Backstop: kick back to the wizard if stale localStorage state has
    // no loaves at all, no dates, or fewer than N distinct weekdays. The
    // server rejects the same shape, but redirecting is a friendlier
    // fail before the network round-trip. Note there is no minimum on
    // the number of loaves — one is fine.
    if (
      totalUnitsPerDelivery(s) === 0 ||
      s.selectedDates.length === 0 ||
      distinctWeekdaysFromDates(s.selectedDates) < MIN_SUBSCRIPTION_DAYS_PER_WEEK
    ) {
      router.replace("/subscriptions/setup");
      return;
    }
    if (!a) {
      router.replace("/subscriptions/setup/checkout");
      return;
    }
    setState(s);
    setAddress(a);
    fetchSubscriptionPlans().then(setPlans);
  }, [router]);

  // Delivery fee preview. Uses the SAME /api/delivery-quote endpoint the
  // one-time checkout uses, so the number shown here is the number the
  // server will charge. Purely a preview — the server re-derives the fee
  // independently and the client's figure is never trusted.
  useEffect(() => {
    if (!address?.pincode) return;
    let cancelled = false;
    setFee({ status: "loading" });
    fetch(`/api/delivery-quote?pincode=${encodeURIComponent(address.pincode)}`)
      .then((r) => r.json())
      .then((d: { serviceable?: boolean | null; feeInr?: number | null; distanceKm?: number | null }) => {
        if (cancelled) return;
        if (d.serviceable === true && typeof d.feeInr === "number") {
          setFee({
            status: "ok",
            feeInr: d.feeInr,
            distanceKm: typeof d.distanceKm === "number" ? d.distanceKm : 0,
          });
        } else if (d.serviceable === false) {
          setFee({
            status: "blocked",
            message: `We don't deliver beyond ${MAX_DELIVERY_KM} km yet, so we can't start a subscription to this address. Please check our service area.`,
          });
        } else {
          setFee({
            status: "blocked",
            message:
              "We couldn't work out your delivery distance from that pincode. Please check the pincode, or contact us and we'll set this up for you.",
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFee({
            status: "blocked",
            message:
              "We couldn't work out your delivery distance right now. Please try again in a moment.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [address?.pincode]);

  // Per-variant lines for the summary + the checkout payload. Filtered to
  // positive quantities, ordered by the plan list.
  const lines = useMemo(() => {
    if (!state) return [] as Array<{ product: WizardProduct; qty: number }>;
    return plans
      .filter((p) => (state.qtyBySlug[p.slug] ?? 0) > 0)
      .map((p) => ({ product: p, qty: state.qtyBySlug[p.slug] }));
  }, [state, plans]);
  const deliveries = useMemo(() => (state ? buildDeliveries(state) : []), [state]);
  const perDelivery = useMemo(
    () => (state ? amountPerDelivery(state, plans) : 0),
    [state, plans],
  );
  const totalUnits = state ? totalUnitsPerDelivery(state) : 0;
  // Counted by DELIVERY DAYS, not loaves — identical formula to the
  // server's, from the same shared helper, so what's shown here is what
  // gets charged.
  const feePerDelivery = fee.status === "ok" ? fee.feeInr : 0;
  const breakdown = useMemo(
    () => computeSubscriptionTotal(perDelivery, feePerDelivery, deliveries.length),
    [perDelivery, feePerDelivery, deliveries.length],
  );
  const totalAmount = breakdown.grandTotal;

  async function placeOrder() {
    if (!state || !address || lines.length === 0) return;
    if (fee.status !== "ok") return;

    setSubmitting(true); setError("");

    // RETRY PATH — the customer already has an unpaid row and a live
    // Razorpay order from a previous attempt on this page. Reopen that one
    // instead of minting a second pair. The amount is re-checked because a
    // Razorpay order's amount is fixed at creation: if the total moved (a
    // fee refetch resolving differently), the old order is wrong and we
    // fall through to creating a fresh one.
    const pending = pendingRef.current;
    if (pending && pending.amount === toPaise(totalAmount)) {
      await openRazorpay(pending);
      return;
    }

    // Union of every weekday key picked across all weeks (canonical mon..sun order).
    const dayKeysSet = new Set<string>();
    deliveries.forEach((d) => dayKeysSet.add(d.day_key));
    const days = Array.from(dayKeysSet);

    // Per-day fallback slot (admin's legacy display reads slots_by_day).
    const slotsByDay: Record<string, string> = {};
    for (const d of deliveries) {
      if (!slotsByDay[d.day_key]) slotsByDay[d.day_key] = d.slot;
    }

    // V10 multi-variant payload: `items` triggers the multi-variant
    // checkout branch (server recomputes price + enforces the 2-unit
    // minimum). The legacy top-level bread_* fields mirror the PRIMARY
    // variant so older admin readers still render a sensible plan row.
    const primary = lines[0].product;
    const items = lines.map((l) => ({
      product_slug: l.product.slug,
      quantity_per_delivery: l.qty,
    }));

    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "place_subscription",
          customer_id: address.customer_id,
          // V10 multi-variant list — takes precedence server-side.
          items,
          // planId is the canonical key the server uses to look up
          // pricing in lib/subscription-pricing.ts. bread_slug is kept
          // for back-compat with older callers; they're always equal.
          planId: primary.slug,
          bread_slug: primary.slug,
          bread_name: primary.name,
          bread_price: primary.price,
          weeks: new Set(deliveries.map((d) => d.week_number)).size,
          days,
          slot_mode: "custom",
          slots_by_day: slotsByDay,
          slot: null,
          total: totalAmount,
          // clientAmount is the spec-name for the price the server
          // validates against. We send both `total` (legacy) and the
          // new explicit field so the route can prefer it.
          clientAmount: totalAmount,
          quantity_per_delivery: totalUnits,
          frequency: "weekly",
          customer_name: address.full_name,
          customer_phone: address.phone,
          customer_address: address.address,
          customer_city: address.city,
          customer_pincode: address.pincode,
          status: "pending_confirmation",
          address_source: address.source,
          deliveries: deliveries.map((d) => ({
            sequence: d.sequence,
            week_number: d.week_number,
            day_key: d.day_key,
            delivery_date: d.delivery_date,
            slot: d.slot,
            skipped: false,
          })),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Prefer the user-friendly `message` (e.g. price_mismatch copy)
        // over the machine-readable `error` code when present.
        setError(data.message ?? data.error ?? "Failed to create subscription.");
        setSubmitting(false);
        return;
      }

      // Subscriptions are PREPAID — the whole plan is paid now. The row
      // exists at payment_status='created' and only becomes 'paid' after
      // the server verifies the Razorpay signature.
      const pay = data.payment as {
        razorpay_order_id: string;
        amount: number;
        currency: string;
        key_id: string | null;
      };

      // Remember it BEFORE opening the sheet, so a dismissal — or a crash
      // mid-sheet — still leaves the retry with something to reuse.
      const created: PendingPayment = {
        subscriptionId: data.subscription_id,
        razorpayOrderId: pay.razorpay_order_id,
        amount: pay.amount,
        currency: pay.currency,
        keyId: pay.key_id,
      };
      pendingRef.current = created;

      await openRazorpay(created);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  /**
   * Open the Razorpay sheet for an already-created subscription + order.
   *
   * Split out of placeOrder so a retry can reach it WITHOUT re-POSTing
   * /api/checkout. Razorpay orders are reusable until paid, so reopening
   * the same order_id is the correct way to give a customer another go.
   *
   * Owns setSubmitting from here on: the sheet is asynchronous, so the flag
   * must stay true until it closes (ondismiss) rather than being cleared by
   * a `finally` the moment we hand off.
   */
  async function openRazorpay(pending: PendingPayment) {
    if (!address) return;

    const loaded = await new Promise<boolean>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).Razorpay) { resolve(true); return; }
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.body.appendChild(s);
    });
    if (!loaded) {
      setError(
        "Couldn't load the payment gateway. Your subscription is saved — reopen this page to pay.",
      );
      setSubmitting(false);
      return;
    }

    const options = {
      key: pending.keyId ?? process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      amount: pending.amount, // server-computed paise
      currency: pending.currency,
      name: "Cadieux",
      description: "Bread subscription",
      order_id: pending.razorpayOrderId,
      prefill: { name: address.full_name, contact: address.phone },
      handler: async (response: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => {
        const vr = await fetch("/api/subscriptions/verify-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscription_id: pending.subscriptionId,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          }),
        });
        const vd = await vr.json().catch(() => ({}));
        if (!vr.ok || !vd.success) {
          setError(
            "We received your payment but couldn't confirm it automatically. " +
              "It'll be reconciled shortly — contact us if your subscription doesn't appear.",
          );
          setSubmitting(false);
          return;
        }
        // Paid. Drop the reuse handle so a stray re-click can't reopen a
        // sheet for an order that's already been captured.
        pendingRef.current = null;
        clearSetupState();
        // replace — back from track lands on /subscription hub, not payment.
        // ?placed=1 triggers the one-time success toast on the track page.
        router.replace("/subscriptions/track?placed=1");
      },
      modal: {
        ondismiss: () => {
          setSubmitting(false);
          // pendingRef is deliberately NOT cleared — the next click reuses
          // this same row and order instead of creating a second pair.
          setError(
            "Payment cancelled. Your subscription isn't active until it's paid for.",
          );
        },
      },
      theme: { color: GOLD },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new (window as any).Razorpay(options).open();
  }

  if (!hydrated || !state || !address) {
    return <main style={pageStyle} />;
  }

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <Link href="/subscriptions/setup/checkout" style={{ fontSize: 16, color: FADED, textDecoration: "none" }}>
          ← Back to address
        </Link>
        <h1
          style={{
            marginTop: 16,
            marginBottom: 6,
            fontFamily: "var(--font-heading)",
            fontWeight: 300,
            fontSize: "clamp(28px,5vw,42px)",
          }}
        >
          Payment
        </h1>
        <p style={{ color: FADED, fontSize: 16, marginTop: 0, marginBottom: 28 }}>
          Subscriptions are paid in full up front.
        </p>

        {/* Order summary */}
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            border: `1px solid ${FAINT}`,
            background: "rgba(2,70,40,0.025)",
            marginBottom: 22,
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            {lines.map((l) => (
              <div
                key={l.product.slug}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}
              >
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 18 }}>
                  {l.product.title} × {l.qty}
                </div>
                <div style={{ fontSize: 16, color: FADED }}>
                  ₹{(l.product.price * l.qty).toLocaleString("en-IN")} / delivery
                </div>
              </div>
            ))}
          </div>
          {/* Delivery fee — charged on EVERY delivery, same distance bands
              as a one-time order. Shown per-delivery and as a total so the
              customer can see exactly what the up-front figure is made of. */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 10,
              marginTop: 8,
              paddingTop: 8,
              borderTop: `1px solid ${FAINT}`,
            }}
          >
            <div style={{ fontSize: 16, color: TEXT }}>Delivery fee</div>
            <div style={{ fontSize: 16, color: FADED }}>
              {fee.status === "loading"
                ? "Calculating…"
                : fee.status === "ok"
                  ? `₹${fee.feeInr.toLocaleString("en-IN")} / delivery`
                  : "Unavailable"}
            </div>
          </div>

          {/* Only shown once the fee is known. While it's loading or blocked
              feePerDelivery is 0, and printing "+ ₹0 delivery" would read as a
              promise of free delivery — the exact guess this flow refuses to
              make. */}
          {fee.status === "ok" && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 10,
                marginTop: 6,
              }}
            >
              <div style={{ fontSize: 16, color: FADED }}>
                (₹{breakdown.amountPerDelivery.toLocaleString("en-IN")} bread + ₹
                {breakdown.feePerDelivery.toLocaleString("en-IN")} delivery) ×{" "}
                {deliveries.length}
              </div>
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginTop: 8,
              paddingTop: 8,
              borderTop: `1px solid ${FAINT}`,
            }}
          >
            <div style={{ fontSize: 16, color: TEXT, fontWeight: 600 }}>
              Total payable now
            </div>
            <div style={{ fontSize: 16, color: GOLD, fontWeight: 600 }}>
              {fee.status === "ok" ? `₹${totalAmount.toLocaleString("en-IN")}` : "—"}
            </div>
          </div>
          <div style={{ marginTop: 4, fontSize: 16, color: FADED }}>
            {deliveries.length} {deliveries.length === 1 ? "delivery" : "deliveries"}
            {deliveries[0] && (
              <>
                {" · "}from {longDayLabel(parseIso(deliveries[0].delivery_date))} ({formatSlot(deliveries[0].slot)})
              </>
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 16, color: FADED }}>
            Delivering to: {address.full_name} · {address.address}, {address.city}
          </div>
        </div>

        {/* Prepaid only. There is no cash-on-delivery on subscriptions. */}
        <div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
          <PaymentCard
            title="Pay online"
            sub="UPI, cards, netbanking. The whole plan, paid now."
          />
        </div>

        {fee.status === "blocked" && (
          <div style={{ marginBottom: 14, fontSize: 16, color: RED }}>{fee.message}</div>
        )}
        {error && <div style={{ marginBottom: 14, fontSize: 16, color: RED }}>{error}</div>}

        {(() => {
          const ready = !submitting && fee.status === "ok";
          return (
            <button
              onClick={placeOrder}
              disabled={!ready}
              style={{
                width: "100%",
                padding: "14px 20px",
                borderRadius: 999,
                border: "none",
                background: ready ? GOLD : FAINT,
                color: ready ? "#FBF3D4" : FADED,
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                cursor: ready ? "pointer" : "not-allowed",
              }}
            >
              {submitting
                ? "Opening payment…"
                : fee.status === "loading"
                  ? "Calculating delivery fee…"
                  : fee.status === "blocked"
                    ? "Unavailable for this address"
                    : `Pay ₹${totalAmount.toLocaleString("en-IN")}`}
            </button>
          );
        })()}
      </div>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100dvh",
  background: BG,
  color: TEXT,
  padding: "60px 20px 100px",
  fontFamily: "var(--font-body)",
};

/** Online payment is the only method on subscriptions, so this is a
 *  static label rather than a selectable radio. */
function PaymentCard({ title, sub }: { title: string; sub: string }) {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 14,
        border: `1px solid ${GOLD}`,
        background: "rgba(2,70,40,0.1)",
        color: TEXT,
        display: "flex",
        gap: 14,
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          border: `1px solid ${GOLD}`,
          background: GOLD,
          flex: "0 0 auto",
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 20 }}>{title}</div>
        <div style={{ fontSize: 16, color: FADED, marginTop: 3 }}>{sub}</div>
      </div>
    </div>
  );
}
