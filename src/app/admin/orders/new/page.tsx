"use client";

// Manual admin order-entry ("Register New Order") — Phase 3b.
//
// One page, TWO modes:
//   • one_time    → POST /api/admin/orders                       (existing)
//   • subscription → POST /api/admin/subscriptions/create        (new, 3b)
//
// The one-time path is byte-identical to a customer-placed order (shared
// prepareOneTimeOrder + orderInsertColumns). The subscription path goes
// through the same shared helpers as the public checkout multi-variant
// branch (buildMultiVariantSubscriptionInsert + insertMultiVariantSubscription
// in src/lib/subscription-checkout.ts), so an admin-registered subscription
// writes byte-identical rows to a customer-created one.
//
// Customer linking is the same in both modes: phone → 10-digit local →
// upsert public.customers by customers_phone_unique → never overwrite
// existing name/city. Both endpoints populate BOTH customer_id AND
// customer_phone so the tracking page / mobile app history match on the
// phone LIKE fallback too.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { DateCalendar } from "@/components/subscription-setup/DateCalendar";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatINR } from "@/lib/admin-formatting";
import {
  bookableSlots,
  dateLabel,
  formatSlotForDisplay,
  nextDeliveryDates,
} from "@/lib/delivery-slots";
import {
  buildDeliveries,
  formatSlot,
  listWeekDayRows,
  longDayLabel,
  TIME_SLOTS,
  type SetupState,
} from "@/lib/subscription-setup";

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  price_inr: number;
  is_active: boolean;
  in_stock: boolean;
  is_archived: boolean;
  subscription_per_loaf_inr?: number | null;
  subscription_discount_pct?: number | null;
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

type OrderType = "one_time" | "subscription";

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

  // ── Order type ──────────────────────────────────────────────────────
  const [orderType, setOrderType] = useState<OrderType>("one_time");

  // ── Customer (shared across modes) ─────────────────────────────────
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [city, setCity] = useState("");
  const [existingCustomer, setExistingCustomer] = useState<CustomerHit | null>(
    null,
  );
  const [lookupBusy, setLookupBusy] = useState(false);

  // ── Fulfillment ────────────────────────────────────────────────────
  //   one_time: delivery OR pickup
  //   subscription: delivery only (admin sub endpoint does not accept pickup)
  const [fulfillmentType, setFulfillmentType] = useState<
    "delivery" | "pickup"
  >("delivery");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [pincode, setPincode] = useState("");
  const [pickupLocationId, setPickupLocationId] = useState("");

  // ── Items (shared shape across modes) ──────────────────────────────
  const [items, setItems] = useState<LineItem[]>([{ slug: "", qty: 1 }]);

  // ── ONE-TIME: dates + slots (public helper) ────────────────────────
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
    setDeliverySlot(firstEnabledSlot);
  }, [firstEnabledSlot, deliveryDate]);

  // ── SUBSCRIPTION: per-date calendar + per-date slots ───────────────
  // Mirrors the customer wizard shape (SetupState.selectedDates +
  // slotByDate). Local state only — no sessionStorage (admin scratch
  // entry). buildDeliveries() flattens these into the deliveries[]
  // payload the endpoint expects.
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [slotByDate, setSlotByDate] = useState<Record<string, string>>({});
  const [bulkSlot, setBulkSlot] = useState<string>(TIME_SLOTS[0] ?? "");
  const [subStatus, setSubStatus] = useState<
    "active" | "pending_confirmation"
  >("active");

  // ── Payment/status/override (shared) ───────────────────────────────
  const [payment, setPayment] = useState<"cod" | "paid">("cod");
  const [status, setStatus] = useState<string>("pending");
  const [serviceabilityOverride, setServiceabilityOverride] = useState(false);

  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState<string | null>(null);

  // ── Mode-switch cleanup ────────────────────────────────────────────
  // When switching modes, wipe the other mode's inputs so nothing leaks
  // into the payload. Shared fields (customer, items, fulfilment) stay.
  const switchMode = useCallback(
    (next: OrderType) => {
      if (next === orderType) return;
      setOrderType(next);
      setSubmitError(null);
      setSubmitOk(null);
      if (next === "subscription") {
        // Subscription endpoint is delivery-only.
        setFulfillmentType("delivery");
        setPickupLocationId("");
        // Reset one-time date/slot to their defaults (harmless if unused).
        setDeliveryDate(dates[0] ?? "");
        setDeliverySlot(firstEnabledSlot);
      } else {
        // Clear subscription-only fields; keep defaults so re-entry is fast.
        setSelectedDates([]);
        setSlotByDate({});
        setBulkSlot(TIME_SLOTS[0] ?? "");
        setSubStatus("active");
      }
    },
    [orderType, dates, firstEnabledSlot],
  );

  // ── Customer prefill on phone-blur (shared) ────────────────────────
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
      const hit =
        (j.customers ?? []).find(
          (c) => (c.phone ?? "").replace(/\D/g, "").slice(-10) === digits,
        ) ?? null;
      if (hit) {
        setExistingCustomer(hit);
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

  // ── Derived: subtotal ──────────────────────────────────────────────
  // Client-side hint only. Servers re-derive from DB in both modes.
  const subtotal = useMemo(() => {
    if (orderType === "one_time") {
      let sum = 0;
      for (const it of items) {
        const p = activeProducts.find((x) => x.slug === it.slug);
        if (!p) continue;
        sum += Number(p.price_inr) * Number(it.qty);
      }
      return sum;
    }
    // Subscription hint: MRP × (1 − discount%) × qty × #selectedDates.
    // One delivery per calendar date the admin picked (mirrors the
    // customer wizard's buildDeliveries flatten).
    const perDelivery = items.reduce((s, it) => {
      const p = activeProducts.find((x) => x.slug === it.slug);
      if (!p) return s;
      const mrp = Number(p.price_inr) || 0;
      const disc = Math.min(
        100,
        Math.max(0, Number(p.subscription_discount_pct ?? 0)),
      );
      const unit =
        Math.round(mrp * (1 - disc / 100) * 100 + Number.EPSILON) / 100;
      return s + unit * Number(it.qty);
    }, 0);
    return perDelivery * selectedDates.length;
  }, [orderType, items, activeProducts, selectedDates]);

  const totalUnitsPerDelivery = useMemo(
    () =>
      items.reduce(
        (s, it) => s + (it.slug ? Math.max(0, Number(it.qty) || 0) : 0),
        0,
      ),
    [items],
  );

  // ── canSubmit gates per mode ───────────────────────────────────────
  const canSubmit = useMemo(() => {
    if (submitBusy) return false;
    if (phone.replace(/\D/g, "").length < 10) return false;
    if (!fullName.trim()) return false;
    if (!items.some((it) => it.slug && Number(it.qty) > 0)) return false;

    if (orderType === "one_time") {
      if (fulfillmentType === "pickup") return pickupLocationId.length > 0;
      return (
        deliveryAddress.trim().length > 0 &&
        deliveryDate.length > 0 &&
        deliverySlot.length > 0
      );
    }

    // subscription
    if (deliveryAddress.trim().length === 0) return false;
    if (selectedDates.length === 0) return false;
    if (selectedDates.some((iso) => !slotByDate[iso])) return false;
    if (totalUnitsPerDelivery < 2) return false;
    return true;
  }, [
    submitBusy,
    phone,
    fullName,
    items,
    orderType,
    fulfillmentType,
    pickupLocationId,
    deliveryAddress,
    deliveryDate,
    deliverySlot,
    selectedDates,
    slotByDate,
    totalUnitsPerDelivery,
  ]);

  // ── Submit ──────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    setSubmitError(null);
    setSubmitOk(null);
    setSubmitBusy(true);
    try {
      const digits = phone.replace(/\D/g, "").slice(-10);

      if (orderType === "one_time") {
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
        setTimeout(() => router.push("/admin/orders"), 900);
        return;
      }

      // ── subscription ────────────────────────────────────────────────
      const subItems = items
        .filter((it) => it.slug && Number(it.qty) > 0)
        .map((it) => ({
          product_slug: it.slug,
          quantity_per_delivery: Number(it.qty),
        }));

      // Flatten calendar+slots the SAME way the customer wizard does
      // (buildDeliveries) and derive the summary bundle exactly like
      // payment/page.tsx:86-94.
      const state: SetupState = {
        qtyBySlug: {},
        selectedDates,
        slotByDate,
      };
      const deliveries = buildDeliveries(state);
      const dayKeysSet = new Set<string>();
      deliveries.forEach((d) => dayKeysSet.add(d.day_key));
      const daysUnion = Array.from(dayKeysSet);
      const weekNumsSet = new Set<number>();
      deliveries.forEach((d) => weekNumsSet.add(d.week_number));
      const weeksDistinct = weekNumsSet.size;
      const slotsByDay: Record<string, string> = {};
      for (const d of deliveries) {
        if (!slotsByDay[d.day_key]) slotsByDay[d.day_key] = d.slot;
      }

      const payload: Record<string, unknown> = {
        phone: digits,
        full_name: fullName.trim(),
        city: city.trim(),
        delivery_address: deliveryAddress.trim(),
        pincode: pincode.trim(),
        deliveries,
        slot_mode: "custom",
        slots_by_day: slotsByDay,
        slot: null,
        days: daysUnion,
        weeks: weeksDistinct,
        items: subItems,
        payment,
        status: subStatus,
      };

      const res = await adminFetch<{
        ok: boolean;
        subscription_id: string;
        deliveries: number;
      }>("/api/admin/subscriptions/create", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setSubmitOk(
        `Subscription registered (${res.subscription_id.slice(0, 8)}, ${res.deliveries} deliveries).`,
      );
      setTimeout(() => router.push("/admin/subscriptions"), 900);
    } catch (e) {
      const msg =
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to register.";
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
    orderType,
    payment,
    phone,
    pickupLocationId,
    pincode,
    router,
    selectedDates,
    slotByDate,
    serviceabilityOverride,
    status,
    subStatus,
  ]);

  const onToggleDate = useCallback((iso: string) => {
    setSelectedDates((prev) =>
      prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort(),
    );
    setSlotByDate((prev) => {
      if (!(iso in prev)) return prev;
      const next = { ...prev };
      delete next[iso];
      return next;
    });
  }, []);

  const applyBulkSlot = useCallback(() => {
    if (!bulkSlot) return;
    setSlotByDate((prev) => {
      const next: Record<string, string> = { ...prev };
      for (const iso of selectedDates) next[iso] = bulkSlot;
      return next;
    });
  }, [bulkSlot, selectedDates]);

  const scheduleRows = useMemo(() => {
    const state: SetupState = {
      qtyBySlug: {},
      selectedDates,
      slotByDate,
    };
    return listWeekDayRows(state);
  }, [selectedDates, slotByDate]);

  const deliveriesCount = selectedDates.length;

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
      <div style={pageWrap}>
        {loadError && <div style={errorBox}>{loadError}</div>}
        {submitOk && <div style={okBox}>{submitOk}</div>}
        {submitError && <div style={errorBox}>{submitError}</div>}

        {/* ── ORDER TYPE toggle ── */}
        <section style={section}>
          <h2 style={sectionTitle}>Order type</h2>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              style={orderType === "one_time" ? chipActive : chipPrimary}
              onClick={() => switchMode("one_time")}
            >
              One-time
            </button>
            <button
              type="button"
              style={orderType === "subscription" ? chipActive : chipPrimary}
              onClick={() => switchMode("subscription")}
            >
              Subscription
            </button>
          </div>
          <div style={{ marginTop: "0.6rem", ...mutedNote }}>
            {orderType === "one_time"
              ? "Single delivery or pickup. Byte-identical to a customer-placed order."
              : "Recurring weekly delivery. Writes go through the same helpers as the public checkout wizard."}
          </div>
        </section>

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
          {orderType === "one_time" ? (
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                marginBottom: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                style={
                  fulfillmentType === "delivery" ? chipActive : chipPrimary
                }
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
          ) : (
            <div style={{ ...mutedNote, marginBottom: "0.75rem" }}>
              Subscriptions are delivery-only.
            </div>
          )}

          {orderType === "one_time" && fulfillmentType === "pickup" ? (
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
          ) : (
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
              <label
                style={{
                  ...label,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <input
                  type="checkbox"
                  checked={serviceabilityOverride}
                  onChange={(e) =>
                    setServiceabilityOverride(e.target.checked)
                  }
                />
                <span>
                  Override delivery range (register anyway — bypasses pincode
                  + 20 km checks)
                </span>
              </label>
            </>
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
                  next[i] = {
                    ...it,
                    qty: Math.max(1, Number(e.target.value) || 1),
                  };
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
            {orderType === "one_time" ? (
              <>
                Subtotal (hint): {formatINR(subtotal)}. Server re-derives from
                DB prices; disagreement → price_mismatch.
              </>
            ) : (
              <>
                Per-delivery units: {totalUnitsPerDelivery} (minimum 2).
                Estimated total (hint): {formatINR(subtotal)} over{" "}
                {deliveriesCount} deliveries. Server prices from DB (MRP ×
                (1 − sub discount%)).
              </>
            )}
          </div>
        </section>

        {/* ── Mode-specific: schedule ── */}
        {orderType === "one_time" ? (
          <section style={section}>
            <h2 style={sectionTitle}>Delivery schedule</h2>
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
                  <option
                    key={s.value}
                    value={s.value}
                    disabled={s.disabled}
                  >
                    {formatSlotForDisplay(s.value)}
                    {s.disabled ? " (too soon)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </section>
        ) : (
          <section style={section}>
            <h2 style={sectionTitle}>Subscription schedule</h2>
            <div style={{ ...mutedNote, marginBottom: "0.75rem" }}>
              Pick individual delivery dates (same picker customers use).
              Each date gets its own time slot — days can vary week-to-week.
            </div>

            <DateCalendar
              selectedDates={selectedDates}
              onToggleDate={onToggleDate}
              deliveriesCount={deliveriesCount}
              totalAmount={subtotal}
            />

            {selectedDates.length > 0 && (
              <>
                <div
                  style={{
                    marginTop: "1rem",
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={label}>Set same time for all</span>
                  <select
                    value={bulkSlot}
                    onChange={(e) => setBulkSlot(e.target.value)}
                    style={{ ...input, maxWidth: 200 }}
                  >
                    {TIME_SLOTS.map((s) => (
                      <option key={s} value={s}>
                        {formatSlot(s)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    style={chipPrimary}
                    onClick={applyBulkSlot}
                    disabled={!bulkSlot}
                  >
                    Apply to all
                  </button>
                </div>

                <div style={{ marginTop: "1rem" }}>
                  <div style={{ ...label, marginBottom: "0.5rem" }}>
                    Per-date time slots
                  </div>
                  {scheduleRows.map((row) => (
                    <div
                      key={row.date_iso}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "0.5rem",
                        alignItems: "center",
                        marginBottom: "0.4rem",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "var(--font-body)",
                          fontSize: "0.8rem",
                          color: "rgba(245,158,11,0.85)",
                        }}
                      >
                        Wk {row.week_number} · {longDayLabel(row.date)}
                      </div>
                      <select
                        value={slotByDate[row.date_iso] ?? ""}
                        onChange={(e) =>
                          setSlotByDate((prev) => ({
                            ...prev,
                            [row.date_iso]: e.target.value,
                          }))
                        }
                        style={input}
                      >
                        <option value="">— choose slot —</option>
                        {TIME_SLOTS.map((s) => (
                          <option key={s} value={s}>
                            {formatSlot(s)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </>
            )}

            <label style={{ ...label, marginTop: "1rem" }}>
              Initial subscription status
              <select
                value={subStatus}
                onChange={(e) =>
                  setSubStatus(
                    e.target.value as "active" | "pending_confirmation",
                  )
                }
                style={input}
              >
                <option value="active">Active</option>
                <option value="pending_confirmation">
                  Pending confirmation
                </option>
              </select>
            </label>

            <div style={mutedNote}>
              Deliveries mirror the customer wizard exactly. Admin bypasses
              the 12h10m booking-lead gate (calendar still hides past dates).
            </div>
          </section>
        )}

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
          {orderType === "one_time" && (
            <label style={label}>
              Initial order status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                style={input}
              >
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
              </select>
            </label>
          )}
        </section>

        {/* ── Submit row ── */}
        <div
          style={{
            marginTop: "0.5rem",
            display: "flex",
            gap: "0.75rem",
            justifyContent: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/admin/orders"
            style={chipNeutral}
            className="uppercase"
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            style={{ ...chipPrimary, opacity: canSubmit ? 1 : 0.5 }}
            className="uppercase"
          >
            {submitBusy
              ? "Registering…"
              : orderType === "one_time"
                ? "Register order"
                : "Register subscription"}
          </button>
        </div>
      </div>
    </AdminShell>
  );
}

// ── Styles (match admin/orders/page.tsx palette) ─────────────────────

const pageWrap: React.CSSProperties = {
  maxWidth: 640,
  margin: "0 auto",
  display: "flex",
  flexDirection: "column",
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
};

const okBox: React.CSSProperties = {
  padding: "0.6rem 0.9rem",
  border: "1px solid rgba(34,197,94,0.5)",
  background: "rgba(34,197,94,0.1)",
  color: "rgba(220,252,231,0.95)",
  fontFamily: "var(--font-body)",
  fontSize: "0.8rem",
  borderRadius: 4,
};
