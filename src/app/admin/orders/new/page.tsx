"use client";

// Manual admin order-entry ("Register New Order").
//
// This page is the admin-facing counterpart of the public /checkout flow.
// It POSTs to /api/admin/orders (admin-gated) which reuses the SAME
// prepareOneTimeOrder + orderInsertColumns as the customer path, so the
// resulting row is byte-identical to a real customer-placed order — the
// auto-refund gate, mobile /api/mobile/orders lookup, WhatsApp bot
// classifier and admin list/print pages all keep working unchanged.
//
// Customer linking works the same way the mobile app does: the phone is
// normalised to 10-digit local, we upsert public.customers by that value
// (customers_phone_unique index), and orders.customer_id points at that
// row. When the same phone signs in on the app, the /api/mobile/orders
// endpoint follows phone → customer_id → orders and shows the manual
// order in the customer's history.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatINR } from "@/lib/admin-formatting";
import {
  bookableSlots,
  dateLabel,
  formatSlotForDisplay,
  nextDeliveryDates,
} from "@/lib/delivery-slots";

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  price_inr: number;
  is_active: boolean;
  in_stock: boolean;
  is_archived: boolean;
};

type PickupLocation = {
  id: string;
  name: string;
  area: string;
  address: string;
  pincode?: string;
};

type CustomerHit = {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
};

type LineItem = { slug: string; qty: number };

export default function RegisterNewOrderPage() {
  const router = useRouter();

  // ── Reference data ──────────────────────────────────────────────────
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [locations, setLocations] = useState<PickupLocation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await adminFetch<{ products: ProductRow[] }>(
          "/api/admin/products",
        );
        if (!cancelled) setProducts(p.products ?? []);
      } catch (e) {
        if (!cancelled) {
          setLoadError(
            e instanceof Error ? e.message : "Failed to load products",
          );
        }
      }
      try {
        const r = await fetch("/api/locations", { cache: "no-store" });
        const j = (await r.json()) as { locations?: PickupLocation[] };
        if (!cancelled) setLocations(j.locations ?? []);
      } catch {
        if (!cancelled) setLocations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeProducts = useMemo(
    () =>
      (products ?? []).filter(
        (p) => p.is_active && p.in_stock && !p.is_archived,
      ),
    [products],
  );

  // ── Form state ──────────────────────────────────────────────────────
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [city, setCity] = useState("");
  const [existingCustomer, setExistingCustomer] = useState<CustomerHit | null>(
    null,
  );
  const [lookupBusy, setLookupBusy] = useState(false);

  const [fulfillmentType, setFulfillmentType] = useState<
    "delivery" | "pickup"
  >("delivery");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [pincode, setPincode] = useState("");
  const [pickupLocationId, setPickupLocationId] = useState("");

  const [items, setItems] = useState<LineItem[]>([{ slug: "", qty: 1 }]);

  // Dates + slots — same helper the public checkout uses so admin gets
  // the identical 7-day window (skipping dates with zero bookable slots).
  const dates = useMemo(() => nextDeliveryDates(7), []);
  const [deliveryDate, setDeliveryDate] = useState<string>(dates[0] ?? "");
  const slots = useMemo(
    () => (deliveryDate ? bookableSlots(deliveryDate) : []),
    [deliveryDate],
  );
  const firstEnabledSlot = useMemo(
    () => slots.find((s) => !s.disabled)?.value ?? "",
    [slots],
  );
  const [deliverySlot, setDeliverySlot] = useState<string>("");
  useEffect(() => {
    // Reset the slot when the date changes; default to the first bookable
    // slot on the new date so the operator can submit without an extra tap.
    setDeliverySlot(firstEnabledSlot);
  }, [firstEnabledSlot, deliveryDate]);

  const [payment, setPayment] = useState<"cod" | "paid">("cod");
  const [status, setStatus] = useState<string>("pending");
  const [serviceabilityOverride, setServiceabilityOverride] = useState(false);

  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState<string | null>(null);

  // ── Customer prefill on phone-blur ─────────────────────────────────
  const lookupCustomer = useCallback(async () => {
    const digits = phone.replace(/\D/g, "").slice(-10);
    if (digits.length !== 10) {
      setExistingCustomer(null);
      return;
    }
    setLookupBusy(true);
    try {
      const j = await adminFetch<{ customers: CustomerHit[] }>(
        `/api/admin/customers?q=${encodeURIComponent(digits)}`,
      );
      // /api/admin/customers?q= does ILIKE on phone; find the exact match.
      const hit =
        (j.customers ?? []).find(
          (c) => (c.phone ?? "").replace(/\D/g, "").slice(-10) === digits,
        ) ?? null;
      if (hit) {
        setExistingCustomer(hit);
        // Prefill name + city ONLY when the operator hasn't typed something
        // else. We never lock the fields — the API will still refuse to
        // overwrite the existing values regardless of what's on screen.
        if (hit.full_name && !fullName) setFullName(hit.full_name);
        if (hit.city && !city) setCity(hit.city);
      } else {
        setExistingCustomer(null);
      }
    } catch {
      setExistingCustomer(null);
    } finally {
      setLookupBusy(false);
    }
  }, [phone, fullName, city]);

  // ── Derived: subtotal (client hint; server re-derives from DB) ────
  const subtotal = useMemo(() => {
    let sum = 0;
    for (const it of items) {
      const p = activeProducts.find((x) => x.slug === it.slug);
      if (!p) continue;
      sum += Number(p.price_inr) * Number(it.qty);
    }
    return sum;
  }, [items, activeProducts]);

  const canSubmit =
    !submitBusy &&
    phone.replace(/\D/g, "").length >= 10 &&
    fullName.trim().length > 0 &&
    items.some((it) => it.slug && Number(it.qty) > 0) &&
    (fulfillmentType === "pickup"
      ? pickupLocationId.length > 0
      : deliveryAddress.trim().length > 0 &&
        deliveryDate.length > 0 &&
        deliverySlot.length > 0);

  // ── Submit ──────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    setSubmitError(null);
    setSubmitOk(null);
    setSubmitBusy(true);
    try {
      const digits = phone.replace(/\D/g, "").slice(-10);
      const cleanItems = items
        .filter((it) => it.slug && Number(it.qty) > 0)
        .map((it) => {
          const p = activeProducts.find((x) => x.slug === it.slug);
          const price = p ? Number(p.price_inr) : 0;
          const qty = Number(it.qty);
          return {
            slug: it.slug,
            name: p?.name ?? it.slug,
            quantity: qty,
            price_inr: price,
            line_total_inr: price * qty,
          };
        });

      const payload: Record<string, unknown> = {
        phone: digits,
        full_name: fullName.trim(),
        city: city.trim(),
        items: cleanItems,
        total_amount: cleanItems.reduce(
          (s, it) => s + Number(it.line_total_inr),
          0,
        ),
        fulfillment_type: fulfillmentType,
        payment,
        status,
        serviceability_override: serviceabilityOverride,
      };
      if (fulfillmentType === "pickup") {
        payload.pickup_location_id = pickupLocationId;
      } else {
        payload.delivery_address = deliveryAddress.trim();
        payload.pincode = pincode.trim();
        payload.delivery_date = deliveryDate;
        payload.delivery_slot = deliverySlot;
      }

      const res = await adminFetch<{ ok: boolean; order_id: string }>(
        "/api/admin/orders",
        { method: "POST", body: JSON.stringify(payload) },
      );
      setSubmitOk(`Order registered (${res.order_id.slice(0, 8)}).`);
      // Small delay so the operator sees the toast, then bounce back to
      // the orders list where the new row will appear at the top.
      setTimeout(() => router.push("/admin/orders"), 900);
    } catch (e) {
      const msg =
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to register order.";
      setSubmitError(msg);
    } finally {
      setSubmitBusy(false);
    }
  }, [
    activeProducts,
    city,
    deliveryAddress,
    deliveryDate,
    deliverySlot,
    fullName,
    fulfillmentType,
    items,
    payment,
    phone,
    pickupLocationId,
    pincode,
    router,
    serviceabilityOverride,
    status,
  ]);

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <AdminShell
      title="Register new order"
      subtitle="Manual entry (phone call / walk-in)"
      actions={
        <Link href="/admin/orders" style={chipPrimary} className="uppercase">
          Back to orders
        </Link>
      }
    >
      {loadError && <div style={errorBox}>{loadError}</div>}
      {submitOk && <div style={okBox}>{submitOk}</div>}
      {submitError && <div style={errorBox}>{submitError}</div>}

      <div style={grid}>
        {/* ── Customer ── */}
        <section style={section}>
          <h2 style={sectionTitle}>Customer</h2>
          <label style={label}>
            Phone (10-digit)
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => void lookupCustomer()}
              placeholder="9989153747"
              style={input}
              maxLength={13}
            />
          </label>
          {existingCustomer && (
            <div style={hintBox}>
              Existing customer{" "}
              <strong>{existingCustomer.full_name ?? "(no name)"}</strong>
              {existingCustomer.city ? ` · ${existingCustomer.city}` : ""}. Name
              &amp; city will NOT be overwritten.
            </div>
          )}
          {lookupBusy && <div style={mutedNote}>Looking up…</div>}

          <label style={label}>
            Full name
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Customer name"
              style={{
                ...input,
                ...(existingCustomer?.full_name ? readOnlyStyle : {}),
              }}
              readOnly={!!existingCustomer?.full_name}
            />
          </label>
          <label style={label}>
            City (optional)
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Visakhapatnam"
              style={{
                ...input,
                ...(existingCustomer?.city ? readOnlyStyle : {}),
              }}
              readOnly={!!existingCustomer?.city}
            />
          </label>
        </section>

        {/* ── Fulfillment ── */}
        <section style={section}>
          <h2 style={sectionTitle}>Fulfillment</h2>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <button
              type="button"
              style={fulfillmentType === "delivery" ? chipActive : chipPrimary}
              onClick={() => setFulfillmentType("delivery")}
            >
              Delivery
            </button>
            <button
              type="button"
              style={fulfillmentType === "pickup" ? chipActive : chipPrimary}
              onClick={() => setFulfillmentType("pickup")}
            >
              Pickup
            </button>
          </div>

          {fulfillmentType === "delivery" ? (
            <>
              <label style={label}>
                Delivery address
                <textarea
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder="Full address, landmarks, apartment/flat number"
                  style={{ ...input, minHeight: 90, resize: "vertical" }}
                />
              </label>
              <label style={label}>
                Pincode (6-digit)
                <input
                  type="text"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  placeholder="530003"
                  style={input}
                  maxLength={6}
                />
              </label>
              <label style={label}>
                Delivery date
                <select
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  style={input}
                >
                  {dates.map((d) => (
                    <option key={d} value={d}>
                      {dateLabel(d)} ({d})
                    </option>
                  ))}
                </select>
              </label>
              <label style={label}>
                Time slot
                <select
                  value={deliverySlot}
                  onChange={(e) => setDeliverySlot(e.target.value)}
                  style={input}
                >
                  {slots.map((s) => (
                    <option key={s.value} value={s.value} disabled={s.disabled}>
                      {formatSlotForDisplay(s.value)}
                      {s.disabled ? " (too soon)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label
                style={{ ...label, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}
              >
                <input
                  type="checkbox"
                  checked={serviceabilityOverride}
                  onChange={(e) => setServiceabilityOverride(e.target.checked)}
                />
                <span>Override delivery range (register anyway — bypasses pincode + 20 km checks)</span>
              </label>
            </>
          ) : (
            <label style={label}>
              Pickup point
              <select
                value={pickupLocationId}
                onChange={(e) => setPickupLocationId(e.target.value)}
                style={input}
              >
                <option value="">— choose a stall —</option>
                {(locations ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} — {l.area}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        {/* ── Items ── */}
        <section style={section}>
          <h2 style={sectionTitle}>Items</h2>
          {activeProducts.length === 0 && !products && (
            <div style={mutedNote}>Loading products…</div>
          )}
          {items.map((it, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 90px auto",
                gap: "0.5rem",
                marginBottom: "0.5rem",
              }}
            >
              <select
                value={it.slug}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...it, slug: e.target.value };
                  setItems(next);
                }}
                style={input}
              >
                <option value="">— choose product —</option>
                {activeProducts.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name} — ₹{p.price_inr}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={99}
                value={it.qty}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...it, qty: Math.max(1, Number(e.target.value) || 1) };
                  setItems(next);
                }}
                style={input}
              />
              <button
                type="button"
                style={chipNeutral}
                onClick={() => {
                  if (items.length === 1) {
                    setItems([{ slug: "", qty: 1 }]);
                  } else {
                    setItems(items.filter((_, idx) => idx !== i));
                  }
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            style={chipPrimary}
            onClick={() => setItems([...items, { slug: "", qty: 1 }])}
          >
            + Add item
          </button>
          <div style={{ marginTop: "0.75rem", ...mutedNote }}>
            Subtotal (hint): {formatINR(subtotal)}. Server re-derives from DB
            prices; if the two disagree the order is rejected with price_mismatch.
          </div>
        </section>

        {/* ── Payment + status ── */}
        <section style={section}>
          <h2 style={sectionTitle}>Payment &amp; status</h2>
          <label style={label}>
            Payment
            <select
              value={payment}
              onChange={(e) => setPayment(e.target.value as "cod" | "paid")}
              style={input}
            >
              <option value="cod">COD — unpaid</option>
              <option value="paid">Mark as paid (cash collected)</option>
            </select>
          </label>
          <label style={label}>
            Initial status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={input}
            >
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
            </select>
          </label>
        </section>
      </div>

      <div
        style={{
          marginTop: "1.5rem",
          display: "flex",
          gap: "0.75rem",
          justifyContent: "flex-end",
        }}
      >
        <Link href="/admin/orders" style={chipNeutral} className="uppercase">
          Cancel
        </Link>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          style={{ ...chipPrimary, opacity: canSubmit ? 1 : 0.5 }}
          className="uppercase"
        >
          {submitBusy ? "Registering…" : "Register order"}
        </button>
      </div>
    </AdminShell>
  );
}

// ── Styles (match admin/orders/page.tsx palette) ─────────────────────

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: "1.25rem",
};

const section: React.CSSProperties = {
  border: "1px solid rgba(245,158,11,0.15)",
  padding: "1rem",
  background: "rgba(245,158,11,0.03)",
  borderRadius: 6,
};

const sectionTitle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.75rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "rgba(245,158,11,0.9)",
  marginTop: 0,
  marginBottom: "0.75rem",
};

const label: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
  marginBottom: "0.75rem",
  fontFamily: "var(--font-body)",
  fontSize: "0.75rem",
  color: "rgba(245,158,11,0.85)",
};

const input: React.CSSProperties = {
  padding: "0.55rem 0.7rem",
  background: "rgba(0,0,0,0.4)",
  color: "#e8e8e8",
  border: "1px solid rgba(245,158,11,0.25)",
  fontFamily: "var(--font-body)",
  fontSize: "0.85rem",
  borderRadius: 4,
  outline: "none",
};

const readOnlyStyle: React.CSSProperties = {
  opacity: 0.75,
  cursor: "not-allowed",
};

const chipBase: React.CSSProperties = {
  padding: "0.4rem 0.9rem",
  border: "1px solid rgba(245,158,11,0.4)",
  fontFamily: "var(--font-body)",
  fontSize: "0.65rem",
  letterSpacing: "0.22em",
  background: "transparent",
  cursor: "pointer",
};

const chipPrimary: React.CSSProperties = {
  ...chipBase,
  color: "#f59e0b",
  borderColor: "rgba(245,158,11,0.55)",
  display: "inline-block",
  textDecoration: "none",
};

const chipNeutral: React.CSSProperties = {
  ...chipBase,
  color: "rgba(245,158,11,0.85)",
  display: "inline-block",
  textDecoration: "none",
};

const chipActive: React.CSSProperties = {
  ...chipPrimary,
  background: "rgba(245,158,11,0.15)",
};

const hintBox: React.CSSProperties = {
  padding: "0.5rem 0.7rem",
  border: "1px solid rgba(34,197,94,0.35)",
  background: "rgba(34,197,94,0.08)",
  color: "rgba(220,252,231,0.9)",
  fontFamily: "var(--font-body)",
  fontSize: "0.75rem",
  borderRadius: 4,
  marginBottom: "0.75rem",
};

const mutedNote: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.7rem",
  color: "rgba(245,158,11,0.6)",
};

const errorBox: React.CSSProperties = {
  padding: "0.6rem 0.9rem",
  border: "1px solid rgba(239,68,68,0.5)",
  background: "rgba(239,68,68,0.1)",
  color: "rgba(254,226,226,0.95)",
  fontFamily: "var(--font-body)",
  fontSize: "0.8rem",
  borderRadius: 4,
  marginBottom: "1rem",
};

const okBox: React.CSSProperties = {
  padding: "0.6rem 0.9rem",
  border: "1px solid rgba(34,197,94,0.5)",
  background: "rgba(34,197,94,0.1)",
  color: "rgba(220,252,231,0.95)",
  fontFamily: "var(--font-body)",
  fontSize: "0.8rem",
  borderRadius: 4,
  marginBottom: "1rem",
};
