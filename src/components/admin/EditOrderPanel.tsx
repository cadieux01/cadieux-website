"use client";

// Comprehensive admin edit panel for a single order.
//
// Replaces the customer-only edit modal that lives inline in
// /admin/orders/page.tsx for the "Order" button. That older modal
// (labelled "Customer" now) still edits customer full_name / phone /
// city / address. This panel edits everything else on the order row:
//
//   - Delivery date + slot
//   - Items (quantity + unit price per line, line totals computed)
//   - Delivery fee
//   - Total amount (derived; force-override toggle for edge cases)
//   - Delivery address
//   - Coordinates via a paste box (lat/lng preview + distance recompute)
//
// Save routes through POST /api/admin/orders/[id]/edit, which itself
// calls the `admin_edit_order` plpgsql RPC — one transaction covers the
// UPDATE plus the paired order_notes writes (customer-visible edit
// summary + optional internal money-delta note when total_amount
// changes on a paid order). That atomicity is why we do not do the
// two writes here from JS.

import { useCallback, useEffect, useMemo, useState } from "react";

import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { ensureAdminFirstName } from "@/lib/admin-first-name";
import { formatINR } from "@/lib/admin-formatting";
import type { AdminOrderRow, AdminOrderItemSnapshot } from "@/lib/admin-shared";
import { formatOrderNumber } from "@/lib/order-number";
import { isPaidStatus } from "@/lib/payment-label";

// The three canonical delivery windows — MUST match what the app + web
// checkout offer (`isAcceptableDeliverySlot` on the server). Any bare-time
// slot picked here would 400 on the delivery-checkout endpoint if the
// customer ever tried to re-book from it, and it would confuse the bake
// plan (which groups by these three windows). Kept literal so this
// component doesn't need to depend on the delivery-slots server helper
// (imported by the API layer, not the client bundle). Legacy narrow slots
// ("06:00-07:00", "07:30" etc.) on existing rows are preserved by
// pass-through — see the option-injection block below.
//
// Delivery orders must always carry a slot; leaving the picker on "— none
// —" would silently break the bake plan for that row. Pickup orders can
// carry a null slot and are handled by their own flow; this panel is
// scoped to the delivery-editing case.
// Morning is paused: shown for clarity (existing rows still display it)
// but disabled at the picker level so an operator can't move a delivery
// INTO the Morning window. Legacy Morning rows read fine; on edit the
// operator must choose Midday or Evening.
const CANONICAL_SLOTS: Array<{ value: string; label: string; disabled?: boolean }> = [
  { value: "06:00-10:00", label: "Morning (6–10 AM) — paused", disabled: true },
  { value: "10:00-14:00", label: "10:00–14:00 · Midday" },
  { value: "16:00-21:00", label: "16:00–21:00 · Evening" },
];

// Multigrain floor: read from `products.available_from` at panel-open
// time. Live-read (never hard-coded) because a scheduled task clears it
// at 06:00 IST on the release date, and a hard-coded floor would keep
// warning after clearance. See /api/admin/products/availability.
type AvailabilityEntry = { id: string; name: string; available_from: string | null };

const CREAM = "#FBF3D4";
const INK = "#024628";
const BORDER = "rgba(251,243,212,0.25)";
const TEXT_MUTED = "rgba(251,243,212,0.65)";

type ItemDraft = {
  product_id: string | null;
  slug: string | null;
  name: string;
  quantity: number;
  unit_price: number;
};

type Coords = { latitude: number; longitude: number; distance_km: number | null };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function itemsFromOrder(items: AdminOrderItemSnapshot[] | null | undefined): ItemDraft[] {
  if (!items || items.length === 0) return [];
  return items.map((it) => ({
    product_id: it.product_id ?? null,
    slug: it.slug ?? null,
    name: it.name ?? "",
    quantity: Number(it.quantity ?? it.qty ?? 1),
    unit_price: round2(Number(it.unit_price_inr ?? it.price_inr ?? 0)),
  }));
}

export function EditOrderPanel({
  order,
  onCancel,
  onSaved,
}: {
  order: AdminOrderRow;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const [deliveryDate, setDeliveryDate] = useState<string>(
    (order.delivery_date as string | null) ?? "",
  );
  const [deliverySlot, setDeliverySlot] = useState<string>(
    (order.delivery_slot as string | null) ?? "",
  );
  const [address, setAddress] = useState<string>(order.delivery_address ?? "");
  const [items, setItems] = useState<ItemDraft[]>(itemsFromOrder(order.items));
  const [deliveryFee, setDeliveryFee] = useState<string>(
    String(order.delivery_fee ?? 0),
  );
  const [overrideTotal, setOverrideTotal] = useState(false);
  const [totalOverride, setTotalOverride] = useState<string>(
    String(order.total_amount ?? 0),
  );

  // Location paste flow.
  const [paste, setPaste] = useState("");
  const [parseBusy, setParseBusy] = useState(false);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [coords, setCoords] = useState<Coords | null>(
    order.latitude != null && order.longitude != null
      ? {
          latitude: Number(order.latitude),
          longitude: Number(order.longitude),
          distance_km:
            order.distance_km != null ? Number(order.distance_km) : null,
        }
      : null,
  );
  const [coordsDirty, setCoordsDirty] = useState(false);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Live product availability. Fetched once when the panel opens; the
  // route is a straight SELECT so caching further up would be overkill.
  // Silent failure — the warning is a courtesy, not a gate.
  const [availability, setAvailability] = useState<AvailabilityEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch<{ products: AvailabilityEntry[] }>(
          "/api/admin/products/availability",
        );
        if (!cancelled) setAvailability(res.products ?? []);
      } catch {
        // silent — no warning is safer than a broken warning
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Second-click override: once the operator has confirmed a warned
  // date is intentional, don't keep re-flagging it. Keyed by the date
  // string so switching dates re-arms the warning.
  const [ackFloor, setAckFloor] = useState<string | null>(null);

  // Compare in plain ISO date terms; both sides are YYYY-MM-DD.
  // Match on EITHER product_id OR slug — prod order.items snapshots
  // carry `slug` (e.g. "high-protein", "multigrain") and legacy rows
  // may carry `product_id`. products.id happens to be the slug string,
  // so both keys resolve against the same column.
  const flooredItems = useMemo(() => {
    if (!deliveryDate) return [] as AvailabilityEntry[];
    return items
      .map((it) =>
        availability.find(
          (p) => p.id === it.product_id || p.id === it.slug,
        ),
      )
      .filter(
        (p): p is AvailabilityEntry =>
          !!p && !!p.available_from && p.available_from > deliveryDate,
      );
  }, [availability, items, deliveryDate]);

  const showFloorWarning =
    flooredItems.length > 0 && ackFloor !== deliveryDate;

  // Read through the shared predicate, not `=== "paid"`. It matches by
  // prefix, which is what makes `paid_orphaned` — money captured, nothing
  // scheduled — count as paid here too. That row is the WORST one to let
  // an operator re-price: the customer has already been charged and the
  // sweeper is still trying to reconcile it.
  const isPaid = isPaidStatus(order.payment_status);

  // Items are the thing that was charged for. Once the money is in, they
  // stop being editable — see the route comment in
  // /api/admin/orders/[id]/edit. The date stays editable at every status:
  // moving a delivery costs nobody anything.
  const itemsLocked = isPaid;

  // Derived totals. `derivedItemsSubtotal` is the sum of qty × unit_price
  // across all lines; `derivedTotal` adds the delivery fee. Both track
  // the current draft state live so the operator sees the math update
  // as they edit.
  const derivedItemsSubtotal = useMemo(() => {
    return round2(
      items.reduce((s, it) => s + Number(it.quantity) * Number(it.unit_price), 0),
    );
  }, [items]);

  const parsedFee = round2(Number(deliveryFee) || 0);
  const derivedTotal = round2(derivedItemsSubtotal + parsedFee);

  const effectiveTotal = overrideTotal
    ? round2(Number(totalOverride) || 0)
    : derivedTotal;

  const oldTotal = round2(Number(order.total_amount ?? 0));
  const totalDelta = round2(effectiveTotal - oldTotal);
  const hasTotalChange = totalDelta !== 0;

  // Money-delta banner only fires when the order is paid AND the total
  // has moved. COD delta is intentionally silent — the customer will
  // pay whatever the new figure is.
  const showMoneyBanner = isPaid && hasTotalChange;

  const updateItem = useCallback(
    (i: number, patch: Partial<ItemDraft>) => {
      setItems((curr) =>
        curr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)),
      );
    },
    [],
  );

  const removeItem = useCallback((i: number) => {
    setItems((curr) => curr.filter((_, idx) => idx !== i));
  }, []);

  const parsePaste = useCallback(async () => {
    const trimmed = paste.trim();
    if (!trimmed) return;
    setParseBusy(true);
    setParseErr(null);
    try {
      const res = await adminFetch<Coords>(
        `/api/admin/orders/${order.id}/location`,
        { method: "POST", body: JSON.stringify({ paste: trimmed }) },
      );
      setCoords(res);
      setCoordsDirty(true);
      setPaste("");
    } catch (e) {
      setParseErr(
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not parse.",
      );
    } finally {
      setParseBusy(false);
    }
  }, [paste, order.id]);

  const clearCoords = useCallback(() => {
    setCoords(null);
    setCoordsDirty(true);
  }, []);

  const save = useCallback(async () => {
    setErr(null);

    // Delivery orders must carry a canonical slot after any edit.
    // Legacy rows sit here on save with the disabled legacy value
    // still selected, and the bake plan needs one of the three
    // windows to group by. Pickup rows are handled in a different
    // flow and reach this panel with fulfillment_type='pickup'.
    const isDelivery =
      (order.fulfillment_type ?? "delivery") !== "pickup";
    const slotIsCanonical = CANONICAL_SLOTS.some(
      (s) => s.value === deliverySlot,
    );
    if (isDelivery && !slotIsCanonical) {
      setErr(
        "Pick a delivery window (Morning / Midday / Evening) before saving.",
      );
      return;
    }

    // Multigrain floor: second-click override. Ack must match the
    // current date to count (switching dates re-arms).
    if (flooredItems.length > 0 && ackFloor !== deliveryDate) {
      setErr(
        `${flooredItems.map((p) => p.name).join(", ")} isn't available yet — click Acknowledge above, then Save.`,
      );
      return;
    }

    setSaving(true);
    try {
      // Build the sparse body — only include keys that actually
      // changed from the current row. The server rejects a body with
      // no changes with 400, so the button label reflects whether
      // there's anything to save; the empty-body edge case just
      // shouldn't reach here.
      const body: Record<string, unknown> = {};

      const currentDate = (order.delivery_date as string | null) ?? "";
      if (deliveryDate !== currentDate) {
        body.delivery_date = deliveryDate === "" ? null : deliveryDate;
      }

      const currentSlot = (order.delivery_slot as string | null) ?? "";
      if (deliverySlot !== currentSlot) {
        body.delivery_slot = deliverySlot === "" ? null : deliverySlot;
      }

      const currentAddr = (order.delivery_address ?? "").trim();
      if (address.trim() !== currentAddr) {
        body.delivery_address = address.trim();
      }

      // Items: only include when the operator actually touched them
      // (we compare against the loaded snapshot). Send in the raw
      // client shape; the server normalises + recomputes line totals.
      const currentItems = itemsFromOrder(order.items);
      const itemsChanged =
        items.length !== currentItems.length ||
        items.some((it, i) => {
          const c = currentItems[i];
          return (
            !c ||
            c.name !== it.name ||
            c.quantity !== it.quantity ||
            c.unit_price !== it.unit_price
          );
        });
      // `itemsLocked` re-checked here, not just on the inputs. The panel
      // holds a draft taken when it opened; if the row was paid in another
      // tab since, the disabled inputs alone would not stop a stale draft
      // being posted.
      if (itemsChanged && !itemsLocked) {
        body.items = items.map((it) => ({
          product_id: it.product_id,
          slug: it.slug,
          name: it.name,
          quantity: it.quantity,
          unit_price_inr: it.unit_price,
        }));
      }

      const currentFee = round2(Number(order.delivery_fee ?? 0));
      if (parsedFee !== currentFee) {
        body.delivery_fee = parsedFee;
      }

      // Send total only if the derived (or overridden) figure differs
      // from the stored total. This is the key that gates the
      // money-delta note on the server side.
      if (effectiveTotal !== oldTotal) {
        body.total_amount = effectiveTotal;
      }

      // Coordinates: only include if the panel touched them. Both are
      // sent together (server enforces this). Distance is recomputed
      // by the server; we never send it.
      if (coordsDirty) {
        if (coords) {
          body.latitude = coords.latitude;
          body.longitude = coords.longitude;
        } else {
          body.latitude = null;
          body.longitude = null;
        }
      }

      if (Object.keys(body).length === 0) {
        setErr("Nothing changed.");
        setSaving(false);
        return;
      }

      // Pass the operator's first name so the resulting order_notes
      // rows carry author. Same source as the notes panel; a null is
      // fine (author column is nullable).
      const author = ensureAdminFirstName();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (author) headers["x-admin-first-name"] = author;

      const res = await adminFetch<{
        ok: boolean;
        changed: string[];
        money_note: { body: string } | null;
      }>(`/api/admin/orders/${order.id}/edit`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      const msg = res.money_note
        ? `Saved. ${res.money_note.body}.`
        : `Saved. ${res.changed.length} field${res.changed.length === 1 ? "" : "s"} updated.`;
      onSaved(msg);
    } catch (e) {
      setErr(
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Save failed.",
      );
      setSaving(false);
    }
  }, [
    order,
    deliveryDate,
    deliverySlot,
    address,
    items,
    itemsLocked,
    parsedFee,
    effectiveTotal,
    oldTotal,
    coordsDirty,
    coords,
    onSaved,
    flooredItems,
    ackFloor,
  ]);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, saving]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit order ${formatOrderNumber(order)}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        background: "rgba(29,29,31,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        style={{
          width: "min(720px, 100%)",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          background: INK,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 24px 60px -12px rgba(29,29,31,0.7)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "1.1rem 1.4rem",
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <h2
            className="uppercase"
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 300,
              color: CREAM,
              fontSize: "1.05rem",
              letterSpacing: "0.14em",
              margin: 0,
            }}
          >
            Edit order · {formatOrderNumber(order)}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            aria-label="Close"
            style={{
              background: "transparent",
              border: `1px solid ${BORDER}`,
              color: CREAM,
              width: 30,
              height: 30,
              cursor: saving ? "not-allowed" : "pointer",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "1rem 1.4rem", overflowY: "auto", flex: 1 }}>
          {/* Delivery date + slot */}
          <section style={{ marginBottom: "1.25rem" }}>
            <SectionLabel>Delivery</SectionLabel>
            <div style={rowGrid}>
              <Field label="Date">
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  disabled={saving}
                  style={inputStyle}
                />
              </Field>
              <Field label="Slot">
                <select
                  value={deliverySlot}
                  onChange={(e) => setDeliverySlot(e.target.value)}
                  disabled={saving}
                  style={inputStyle}
                >
                  {/* Preserve the current legacy slot as a DISABLED
                      option — visible so the operator can see what the
                      row is currently on, but not re-selectable (any
                      new save must move onto one of the three windows).
                      Also covers the null case for legacy rows: shown
                      greyed as "— none —" so the picker never opens
                      blank. */}
                  {!CANONICAL_SLOTS.some((s) => s.value === deliverySlot) ? (
                    <option value={deliverySlot} disabled>
                      {deliverySlot
                        ? `${deliverySlot} (legacy — pick a new window)`
                        : "— none — (pick a window)"}
                    </option>
                  ) : null}
                  {CANONICAL_SLOTS.map((s) => (
                    <option key={s.value} value={s.value} disabled={s.disabled}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {showFloorWarning ? (
              <div
                role="alert"
                style={{
                  marginTop: "0.75rem",
                  padding: "0.65rem 0.9rem",
                  border: `1px solid #E5B85C`,
                  background: "rgba(229,184,92,0.1)",
                  color: CREAM,
                  fontFamily: "var(--font-body)",
                  fontSize: "0.9rem",
                }}
              >
                <strong>Heads up:</strong>{" "}
                {flooredItems.map((p) => p.name).join(", ")}{" "}
                {flooredItems.length === 1 ? "is" : "are"} only available from{" "}
                {flooredItems
                  .map((p) => p.available_from)
                  .filter(Boolean)
                  .join(" / ")}
                . Save again to confirm this delivery date anyway.
                <div style={{ marginTop: "0.4rem" }}>
                  <button
                    type="button"
                    onClick={() => setAckFloor(deliveryDate)}
                    style={{
                      ...buttonStyle,
                      padding: "0.35rem 0.7rem",
                      fontSize: "0.75rem",
                    }}
                  >
                    Acknowledge
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          {/* Items */}
          <section style={{ marginBottom: "1.25rem" }}>
            <SectionLabel>Items</SectionLabel>
            {/* The reason, not just the disabled state. An operator who
                finds a greyed-out field with no explanation assumes a bug
                and goes looking for a way round it. */}
            {itemsLocked ? (
              <p
                style={{
                  margin: "0 0 0.6rem",
                  color: "#E5B85C",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                Locked — this order is paid. Editing what was bought after
                the money has landed leaves the receipt and the payment
                disagreeing with no refund recorded. Change the total below
                (that writes a refund/collect note), or cancel and re-issue.
              </p>
            ) : null}
            {items.length === 0 ? (
              <p style={{ color: TEXT_MUTED, margin: 0 }}>No items.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Name</th>
                    <th style={{ ...thStyle, textAlign: "right", width: 80 }}>
                      Qty
                    </th>
                    <th style={{ ...thStyle, textAlign: "right", width: 100 }}>
                      Unit ₹
                    </th>
                    <th style={{ ...thStyle, textAlign: "right", width: 90 }}>
                      Line
                    </th>
                    <th style={{ ...thStyle, width: 32 }} />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td style={tdStyle}>
                        <input
                          value={it.name}
                          onChange={(e) => updateItem(i, { name: e.target.value })}
                          disabled={saving || itemsLocked}
                          style={{
                            ...inputStyle,
                            padding: "0.35rem 0.5rem",
                            ...(itemsLocked ? lockedField : null),
                          }}
                        />
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <input
                          type="number"
                          min={1}
                          max={99}
                          value={it.quantity}
                          onChange={(e) =>
                            updateItem(i, {
                              quantity: Math.max(1, Math.min(99, Number(e.target.value) || 1)),
                            })
                          }
                          disabled={saving || itemsLocked}
                          style={{
                            ...inputStyle,
                            padding: "0.35rem 0.5rem",
                            textAlign: "right",
                            ...(itemsLocked ? lockedField : null),
                          }}
                        />
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <input
                          type="number"
                          min={0}
                          max={99999}
                          step="0.01"
                          value={it.unit_price}
                          onChange={(e) =>
                            updateItem(i, {
                              unit_price: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          disabled={saving || itemsLocked}
                          style={{
                            ...inputStyle,
                            padding: "0.35rem 0.5rem",
                            textAlign: "right",
                            ...(itemsLocked ? lockedField : null),
                          }}
                        />
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          color: CREAM,
                          fontFamily: "var(--font-body)",
                        }}
                      >
                        {formatINR(round2(it.quantity * it.unit_price))}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={() => removeItem(i)}
                          disabled={saving || itemsLocked}
                          aria-label={`Remove ${it.name}`}
                          style={
                            itemsLocked
                              ? { ...miniButton, ...lockedField }
                              : miniButton
                          }
                          title={
                            itemsLocked
                              ? "Locked — the order is paid"
                              : "Remove this line"
                          }
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ ...tdStyle, textAlign: "right", color: TEXT_MUTED }}>
                      Items subtotal
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", color: CREAM }}>
                      {formatINR(derivedItemsSubtotal)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </section>

          {/* Fee + total */}
          <section style={{ marginBottom: "1.25rem" }}>
            <SectionLabel>Money</SectionLabel>
            <div style={rowGrid}>
              <Field label="Delivery fee ₹">
                <input
                  type="number"
                  min={0}
                  max={9999}
                  step="0.01"
                  value={deliveryFee}
                  onChange={(e) => setDeliveryFee(e.target.value)}
                  disabled={saving}
                  style={inputStyle}
                />
              </Field>
              <Field label="Order total ₹">
                <input
                  type="number"
                  min={0}
                  max={999999}
                  step="0.01"
                  value={overrideTotal ? totalOverride : derivedTotal}
                  onChange={(e) => {
                    setOverrideTotal(true);
                    setTotalOverride(e.target.value);
                  }}
                  disabled={saving}
                  style={inputStyle}
                />
              </Field>
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginTop: "0.5rem",
                color: TEXT_MUTED,
                fontSize: "0.85rem",
              }}
            >
              <input
                type="checkbox"
                checked={overrideTotal}
                onChange={(e) => setOverrideTotal(e.target.checked)}
                disabled={saving}
              />
              Force-override total (unlocks manual amount; leave off to use items + fee)
            </label>
            {showMoneyBanner ? (
              <div
                role="alert"
                style={{
                  marginTop: "0.75rem",
                  padding: "0.75rem 1rem",
                  border: `1px solid ${totalDelta < 0 ? "#F59E0B" : "#EF4444"}`,
                  background:
                    totalDelta < 0
                      ? "rgba(245,158,11,0.1)"
                      : "rgba(239,68,68,0.1)",
                  color: CREAM,
                  fontFamily: "var(--font-body)",
                  fontSize: "0.95rem",
                }}
              >
                <strong style={{ letterSpacing: "0.1em" }}>
                  {totalDelta < 0 ? "REFUND DUE" : "COLLECT"} ₹
                  {Math.abs(totalDelta)}
                </strong>{" "}
                <span style={{ color: TEXT_MUTED }}>
                  · old {formatINR(oldTotal)} → new {formatINR(effectiveTotal)}
                </span>
                <div style={{ marginTop: "0.35rem", fontSize: "0.8rem", color: TEXT_MUTED }}>
                  A note will be logged on this order. No refund is issued
                  automatically — handle by phone / Razorpay dashboard.
                </div>
              </div>
            ) : null}
          </section>

          {/* Address */}
          <section style={{ marginBottom: "1.25rem" }}>
            <SectionLabel>Delivery address</SectionLabel>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={saving}
              rows={3}
              style={{ ...inputStyle, resize: "vertical", minHeight: 72 }}
            />
          </section>

          {/* Location paste */}
          <section style={{ marginBottom: "1.25rem" }}>
            <SectionLabel>Location (paste)</SectionLabel>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void parsePaste();
                  }
                }}
                placeholder="Google Maps link, maps.app.goo.gl short link, or 'lat, lng'"
                disabled={saving || parseBusy}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                type="button"
                onClick={() => void parsePaste()}
                disabled={saving || parseBusy || paste.trim().length === 0}
                style={buttonStyle}
              >
                {parseBusy ? "Parsing…" : "Parse"}
              </button>
            </div>
            {parseErr ? (
              <p style={{ color: "#EF4444", fontSize: "0.85rem", margin: "0.4rem 0 0" }}>
                {parseErr}
              </p>
            ) : null}
            {coords ? (
              <div style={{ marginTop: "0.75rem" }}>
                <p style={{ color: CREAM, margin: 0, fontSize: "0.9rem" }}>
                  {coords.latitude.toFixed(6)}, {coords.longitude.toFixed(6)}
                  {coords.distance_km != null ? (
                    <span style={{ color: TEXT_MUTED }}>
                      {" "}
                      · {coords.distance_km.toFixed(2)} km driving
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={clearCoords}
                    disabled={saving}
                    style={{
                      ...miniButton,
                      marginLeft: "0.5rem",
                      width: "auto",
                      padding: "2px 8px",
                    }}
                  >
                    Clear
                  </button>
                </p>
                <iframe
                  title="Location preview"
                  src={`https://www.google.com/maps?q=${coords.latitude},${coords.longitude}&output=embed`}
                  style={{
                    width: "100%",
                    height: 200,
                    marginTop: "0.5rem",
                    border: `1px solid ${BORDER}`,
                  }}
                />
              </div>
            ) : null}
          </section>

          {err ? (
            <p role="alert" style={{ color: "#EF4444", margin: "0 0 0.75rem" }}>
              {err}
            </p>
          ) : null}
        </div>

        <div
          style={{
            padding: "1rem 1.4rem",
            borderTop: `1px solid ${BORDER}`,
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={buttonStyle}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            style={{
              ...buttonStyle,
              borderColor: CREAM,
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------
// Tiny inline styling helpers. Kept local; the panel is a one-off and
// pulling in the AdminShell's shared modal chrome would drag more than
// it saves.

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "transparent",
  border: `1px solid ${BORDER}`,
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: "0.95rem",
  padding: "0.5rem 0.7rem",
  outline: "none",
};

const buttonStyle: React.CSSProperties = {
  background: INK,
  border: `1px solid ${BORDER}`,
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: "0.85rem",
  letterSpacing: "0.14em",
  padding: "0.55rem 1rem",
  textTransform: "uppercase",
  cursor: "pointer",
};

// A disabled control that still LOOKS editable is a lie the operator has
// to discover by typing into it. These inputs are painted by the admin
// stylesheet, so the browser's own disabled shading never shows — the
// locked item fields rendered pixel-identical to the live ones. Dim them
// explicitly instead.
const lockedField: React.CSSProperties = {
  opacity: 0.45,
  cursor: "not-allowed",
};

const miniButton: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${BORDER}`,
  color: TEXT_MUTED,
  width: 24,
  height: 24,
  fontSize: 14,
  lineHeight: 1,
  cursor: "pointer",
  padding: 0,
};

const rowGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "0.75rem",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  color: TEXT_MUTED,
  fontFamily: "var(--font-body)",
  fontSize: "0.75rem",
  letterSpacing: "0.1em",
  padding: "0.4rem 0.3rem",
  borderBottom: `1px solid ${BORDER}`,
  fontWeight: 400,
  textTransform: "uppercase",
};

const tdStyle: React.CSSProperties = {
  padding: "0.35rem 0.3rem",
  fontSize: "0.9rem",
  color: CREAM,
  verticalAlign: "middle",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="uppercase"
      style={{
        margin: "0 0 0.6rem",
        color: CREAM,
        fontFamily: "var(--font-heading)",
        fontWeight: 300,
        fontSize: "0.8rem",
        letterSpacing: "0.16em",
      }}
    >
      {children}
    </h3>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <span
        style={{
          color: TEXT_MUTED,
          fontSize: "0.75rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontFamily: "var(--font-body)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
