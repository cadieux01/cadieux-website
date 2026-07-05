"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  SETUP_PRODUCTS,
  MIN_UNITS_PER_DELIVERY,
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

const BG = "#C0C8CE";
const GOLD = "#024628";
const TEXT = "#024628";
const FADED = "rgba(2,70,40,0.6)";
const FAINT = "rgba(2,70,40,0.2)";
const RED = "#ff8181";

type Method = "cod" | null;

export default function PaymentPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<SetupState | null>(null);
  const [address, setAddress] = useState<SetupAddress | null>(null);
  const [method, setMethod] = useState<Method>("cod");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Live wizard catalogue. Starts from the hardcoded fallback so the
  // summary always renders something; replaced by DB prices once the
  // public API responds.
  const [plans, setPlans] = useState<WizardProduct[]>(SETUP_PRODUCTS);

  useEffect(() => {
    setHydrated(true);
    const s = loadSetupState();
    const a = loadAddress();
    if (totalUnitsPerDelivery(s) < MIN_UNITS_PER_DELIVERY || s.selectedDates.length === 0) {
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
  const totalAmount = perDelivery * deliveries.length;

  async function placeOrder() {
    if (!state || !address || lines.length === 0) return;
    if (method !== "cod") { setError("Please pick a payment method."); return; }

    setSubmitting(true); setError("");

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
          payment_method: "cod",
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
        return;
      }
      clearSetupState();
      // replace — back from track lands on /subscription hub, not payment.
      // ?placed=1 triggers the one-time success toast on the track page.
      router.replace("/subscriptions/track?placed=1");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!hydrated || !state || !address) {
    return <main style={pageStyle} />;
  }

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <Link href="/subscriptions/setup/checkout" style={{ fontSize: 13, color: FADED, textDecoration: "none" }}>
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
        <p style={{ color: FADED, fontSize: 14, marginTop: 0, marginBottom: 28 }}>
          How would you like to pay?
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
                <div style={{ fontSize: 13, color: FADED }}>
                  ₹{(l.product.price * l.qty).toLocaleString("en-IN")} / delivery
                </div>
              </div>
            ))}
          </div>
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
            <div style={{ fontSize: 14, color: TEXT }}>Total</div>
            <div style={{ fontSize: 14, color: GOLD }}>₹{totalAmount.toLocaleString("en-IN")}</div>
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: FADED }}>
            {deliveries.length} {deliveries.length === 1 ? "delivery" : "deliveries"}
            {deliveries[0] && (
              <>
                {" · "}from {longDayLabel(parseIso(deliveries[0].delivery_date))} ({formatSlot(deliveries[0].slot)})
              </>
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: FADED }}>
            Delivering to: {address.full_name} · {address.address}, {address.city}
          </div>
        </div>

        {/* Methods */}
        <div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
          <PaymentCard
            title="Cash on delivery"
            sub="Pay in cash when we deliver."
            selected={method === "cod"}
            onSelect={() => setMethod("cod")}
          />
          <DisabledCard
            title="Pay online"
            sub="UPI, cards, netbanking."
          />
          {/* TODO: integrate Cashfree/Razorpay here for online payments. */}
        </div>

        {error && <div style={{ marginBottom: 14, fontSize: 13, color: RED }}>{error}</div>}

        <button
          onClick={placeOrder}
          disabled={submitting || method !== "cod"}
          style={{
            width: "100%",
            padding: "14px 20px",
            borderRadius: 999,
            border: "none",
            background: !submitting && method === "cod" ? GOLD : FAINT,
            color: !submitting && method === "cod" ? "#0a0a0a" : FADED,
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: !submitting && method === "cod" ? "pointer" : "not-allowed",
          }}
        >
          {submitting ? "Placing order…" : `Confirm — ₹${totalAmount.toLocaleString("en-IN")}`}
        </button>
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

function PaymentCard({
  title,
  sub,
  selected,
  onSelect,
}: {
  title: string;
  sub: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      style={{
        textAlign: "left",
        padding: 18,
        borderRadius: 14,
        border: `1px solid ${selected ? GOLD : FAINT}`,
        background: selected ? "rgba(2,70,40,0.1)" : "rgba(2,70,40,0.03)",
        color: TEXT,
        cursor: "pointer",
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
          border: `1px solid ${selected ? GOLD : FAINT}`,
          background: selected ? GOLD : "transparent",
          flex: "0 0 auto",
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 20 }}>{title}</div>
        <div style={{ fontSize: 13, color: FADED, marginTop: 3 }}>{sub}</div>
      </div>
    </button>
  );
}

function DisabledCard({ title, sub }: { title: string; sub: string }) {
  return (
    <div
      aria-disabled="true"
      style={{
        padding: 18,
        borderRadius: 14,
        border: `1px dashed ${FAINT}`,
        background: "rgba(2,70,40,0.015)",
        opacity: 0.5,
        cursor: "not-allowed",
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
          border: `1px solid ${FAINT}`,
          flex: "0 0 auto",
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 20, color: FADED }}>
            {title}
          </div>
          <span
            style={{
              fontSize: 10,
              padding: "3px 9px",
              borderRadius: 999,
              border: `1px solid ${FAINT}`,
              color: FADED,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            Coming soon
          </span>
        </div>
        <div style={{ fontSize: 13, color: FADED, marginTop: 3 }}>{sub}</div>
      </div>
    </div>
  );
}
