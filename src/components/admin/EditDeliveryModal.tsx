"use client";

// Per-delivery edit modal for /admin/subscriptions/[id].
//
// Only edits date + slot on a single subscription_deliveries row. Status
// stays with the row's inline <Select> (same PATCH route, one owner per
// field). Save goes through the same PATCH route the status control
// uses, which writes ALL FOUR columns atomically (delivery_date,
// scheduled_date, slot, scheduled_time_slot) — see the route header for
// the reason.
//
// Multigrain floor warning + second-click override mirror EditOrderPanel:
// live-read `products.available_from` at open time, warn if any item on
// the plan is not yet available on the new date, require an
// Acknowledge click before Save writes.

import { useCallback, useEffect, useMemo, useState } from "react";

import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { ensureAdminFirstName } from "@/lib/admin-first-name";
import type {
  AdminDeliveryRow,
  AdminSubscriptionItem,
} from "@/lib/admin-shared";

const CREAM = "#FBF3D4";
const INK = "#024628";
const BORDER = "rgba(251,243,212,0.25)";
const TEXT_MUTED = "rgba(251,243,212,0.65)";

// Morning is paused: shown for clarity (existing rows still display it)
// but disabled at the picker level so an operator can't move a delivery
// INTO the Morning window. Legacy Morning rows read fine; on edit the
// operator must choose Midday or Evening.
const CANONICAL_SLOTS: Array<{ value: string; label: string; disabled?: boolean }> = [
  { value: "06:00-10:00", label: "Morning (6–10 AM) — paused", disabled: true },
  { value: "10:00-14:00", label: "10:00–14:00 · Midday" },
  { value: "16:00-21:00", label: "16:00–21:00 · Evening" },
];

type AvailabilityEntry = {
  id: string;
  name: string;
  available_from: string | null;
};

export function EditDeliveryModal({
  subscriptionId,
  delivery,
  items,
  onCancel,
  onSaved,
}: {
  subscriptionId: string;
  delivery: AdminDeliveryRow;
  /** Subscription items — used to match against product availability
   *  for the Multigrain floor warning. Legacy rows may pass []. */
  items: AdminSubscriptionItem[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const initialDate =
    (delivery.scheduled_date ?? delivery.delivery_date ?? "") as string;
  const initialSlot =
    (delivery.scheduled_time_slot ?? delivery.slot ?? "") as string;

  const [date, setDate] = useState(initialDate);
  const [slot, setSlot] = useState(initialSlot);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ackFloor, setAckFloor] = useState<string | null>(null);

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
        // silent
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Match subscription-item slugs against the products table. Legacy
  // items without a slug simply can't match — no false warning.
  const flooredItems = useMemo(() => {
    if (!date) return [] as AvailabilityEntry[];
    const slugs = new Set(items.map((it) => it.product_slug).filter(Boolean));
    return availability.filter(
      (p) =>
        slugs.has(p.id) && p.available_from && p.available_from > date,
    );
  }, [availability, items, date]);

  const showFloorWarning = flooredItems.length > 0 && ackFloor !== date;

  const slotIsCanonical = CANONICAL_SLOTS.some((s) => s.value === slot);

  const save = useCallback(async () => {
    setErr(null);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setErr("Pick a delivery date.");
      return;
    }
    if (!slotIsCanonical) {
      setErr("Pick a delivery window (Morning / Midday / Evening).");
      return;
    }
    if (flooredItems.length > 0 && ackFloor !== date) {
      setErr(
        `${flooredItems.map((p) => p.name).join(", ")} isn't available yet — click Acknowledge, then Save.`,
      );
      return;
    }
    // No-op guard — nothing to save, don't hit the route.
    if (date === initialDate && slot === initialSlot) {
      setErr("Nothing changed.");
      return;
    }
    setSaving(true);
    try {
      const author = ensureAdminFirstName();
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (author) headers["x-admin-first-name"] = author;
      await adminFetch(
        `/api/admin/subscriptions/${encodeURIComponent(
          subscriptionId,
        )}/deliveries/${encodeURIComponent(delivery.id)}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            scheduled_date: date,
            scheduled_time_slot: slot,
          }),
        },
      );
      onSaved();
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
    subscriptionId,
    delivery.id,
    date,
    slot,
    slotIsCanonical,
    flooredItems,
    ackFloor,
    initialDate,
    initialSlot,
    onSaved,
  ]);

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
      aria-label={`Edit delivery ${delivery.sequence ?? ""}`}
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
          width: "min(520px, 100%)",
          background: INK,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 24px 60px -12px rgba(29,29,31,0.7)",
        }}
      >
        <div
          style={{
            padding: "1.1rem 1.4rem",
            borderBottom: `1px solid ${BORDER}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2
            className="uppercase"
            style={{
              margin: 0,
              color: CREAM,
              fontFamily: "var(--font-heading)",
              fontWeight: 300,
              fontSize: "1rem",
              letterSpacing: "0.14em",
            }}
          >
            Edit delivery {delivery.sequence ?? ""}
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

        <div style={{ padding: "1rem 1.4rem" }}>
          <label style={fieldLabel}>Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={saving}
            style={inputStyle}
          />

          <label style={{ ...fieldLabel, marginTop: "0.9rem" }}>Slot</label>
          <select
            value={slot}
            onChange={(e) => setSlot(e.target.value)}
            disabled={saving}
            style={inputStyle}
          >
            {!slotIsCanonical ? (
              <option value={slot} disabled>
                {slot
                  ? `${slot} (legacy — pick a new window)`
                  : "— none — (pick a window)"}
              </option>
            ) : null}
            {CANONICAL_SLOTS.map((s) => (
              <option key={s.value} value={s.value} disabled={s.disabled}>
                {s.label}
              </option>
            ))}
          </select>

          {showFloorWarning ? (
            <div
              role="alert"
              style={{
                marginTop: "0.9rem",
                padding: "0.65rem 0.9rem",
                border: "1px solid #E5B85C",
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
              . Acknowledge to enable Save on this date.
              <div style={{ marginTop: "0.4rem" }}>
                <button
                  type="button"
                  onClick={() => setAckFloor(date)}
                  style={{ ...buttonStyle, padding: "0.35rem 0.7rem", fontSize: "0.75rem" }}
                >
                  Acknowledge
                </button>
              </div>
            </div>
          ) : null}

          <p style={{ color: TEXT_MUTED, fontSize: "0.8rem", marginTop: "0.9rem" }}>
            This writes both the planned and scheduled columns so the bake
            plan, admin views, and the customer&rsquo;s tracking page all
            agree.
          </p>

          {err ? (
            <p role="alert" style={{ color: "#EF4444", margin: "0.75rem 0 0" }}>
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
            style={{ ...buttonStyle, borderColor: CREAM, opacity: saving ? 0.5 : 1 }}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

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

const fieldLabel: React.CSSProperties = {
  display: "block",
  color: TEXT_MUTED,
  fontSize: "0.75rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontFamily: "var(--font-body)",
  marginBottom: "0.35rem",
};
