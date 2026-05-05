"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  SETUP_PRODUCTS,
  buildDeliveries,
  clearSetupState,
  formatSlot,
  longDayLabel,
  loadAddress,
  loadSetupState,
  parseIso,
  type SetupAddress,
  type SetupState,
} from "@/lib/subscription-setup";

const BG = "#0e0e0e";
const GOLD = "#c9a96e";
const TEXT = "#FBF3D4";
const FADED = "rgba(240,223,200,0.6)";
const FAINT = "rgba(240,223,200,0.12)";
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

  useEffect(() => {
    setHydrated(true);
    const s = loadSetupState();
    const a = loadAddress();
    if (!s.productSlug || s.selectedDates.length === 0) {
      router.replace("/subscriptions/setup");
      return;
    }
    if (!a) {
      router.replace("/subscriptions/setup/checkout");
      return;
    }
    setState(s);
    setAddress(a);
  }, [router]);

  const product = useMemo(
    () => (state ? SETUP_PRODUCTS.find((p) => p.slug === state.productSlug) ?? null : null),
    [state]
  );
  const deliveries = useMemo(() => (state ? buildDeliveries(state) : []), [state]);
  const totalAmount = product && state ? product.price * state.qty * deliveries.length : 0;

  async function placeOrder() {
    if (!state || !product || !address) return;
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

    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "place_subscription",
          customer_id: address.customer_id,
          bread_slug: product.slug,
          bread_name: product.name,
          bread_price: product.price,
          weeks: new Set(deliveries.map((d) => d.week_number)).size,
          days,
          slot_mode: "custom",
          slots_by_day: slotsByDay,
          slot: null,
          total: totalAmount,
          quantity_per_delivery: state.qty,
          frequency: "weekly",
          customer_name: address.full_name,
          customer_phone: address.phone,
          customer_address: address.address,
          customer_city: address.city,
          customer_pincode: address.pincode,
          payment_method: "cod",
          status: "pending_confirmation",
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
        setError(data.error ?? "Failed to create subscription.");
        return;
      }
      clearSetupState();
      router.push("/subscriptions/track");
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
            background: "rgba(255,255,255,0.025)",
            marginBottom: 22,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 18 }}>
              {product?.title} × {state.qty}
            </div>
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
        background: selected ? "rgba(201,169,110,0.1)" : "rgba(255,255,255,0.03)",
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
        background: "rgba(255,255,255,0.015)",
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
