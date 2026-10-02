"use client";

// "Record cash" — how a COD order's money actually arrived.
//
// Shared by /admin/orders (the list, where the 179-order backlog gets worked
// through) and /admin/orders/[id] (the single-order case). One component so
// the two surfaces cannot drift on which date they claim to write.
//
// THE DATE IS SHOWN BEFORE SAVING, and that is the point of the dialog
// existing at all rather than three bare buttons. Settling a five-week-old
// delivered order with now() would date August money as October in the column
// the revenue figures read. The admin sees the exact moment going in, computed
// by settlementPaidAt() — the SAME function the PATCH route calls — so what is
// displayed is what is stored.

import { useState } from "react";

import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatDateTime } from "@/lib/admin-formatting";
import {
  COD_SETTLED_METHODS,
  codMethodDisplay,
  codMethodLabel,
  settlementPaidAt,
  type CodSettledMethod,
} from "@/lib/cod-settlement";
import type { AdminOrderRow } from "@/lib/admin-shared";
import {
  BORDER,
  CREAM,
  INK,
  SURFACE_BORDER,
  SURFACE_TEXT,
  SURFACE_TEXT_MUTED,
  TEXT_MUTED,
  cream,
  ink,
} from "@/components/admin/theme";

export function CodSettleDialog({
  order,
  onCancel,
  onSaved,
}: {
  order: AdminOrderRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [method, setMethod] = useState<CodSettledMethod | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Computed once per render from the row as loaded. `nowIso` is only read
  // when the order is NOT delivered, so a re-render drifting by a few
  // milliseconds cannot change a backdated value.
  const decision = settlementPaidAt(order, new Date().toISOString());

  const save = async () => {
    if (!method || saving) return;
    setSaving(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({ cod_settled_method: method }),
      });
      onSaved();
    } catch (e) {
      // The route answers 409 when the compare-and-swap loses, i.e. someone
      // else recorded this collection first. Surface it instead of closing,
      // or the admin assumes their own method was the one stored.
      setError(
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not record the payment.",
      );
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Record cash for this order"
      style={{
        position: "fixed",
        inset: 0,
        background: ink(0.6),
        display: "grid",
        placeItems: "center",
        padding: "1rem",
        zIndex: 60,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: CREAM,
          color: SURFACE_TEXT,
          border: `1px solid ${SURFACE_BORDER}`,
          borderRadius: 12,
          padding: "1.25rem",
          width: "min(26rem, 100%)",
          display: "flex",
          flexDirection: "column",
          gap: "0.9rem",
        }}
      >
        <div>
          <div style={{ fontSize: "1.05rem", fontWeight: 600 }}>
            Record cash
          </div>
          <div
            style={{
              fontSize: "0.9rem",
              color: SURFACE_TEXT_MUTED,
              marginTop: "0.15rem",
            }}
          >
            How did the money arrive?
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {COD_SETTLED_METHODS.map((m) => {
            const on = method === m;
            return (
              <button
                key={m}
                type="button"
                disabled={saving}
                onClick={() => setMethod(m)}
                aria-pressed={on}
                style={{
                  padding: "0.45rem 0.8rem",
                  borderRadius: 8,
                  border: `1px solid ${on ? INK : SURFACE_BORDER}`,
                  background: on ? INK : "transparent",
                  color: on ? CREAM : SURFACE_TEXT,
                  fontSize: "0.95rem",
                  fontWeight: on ? 600 : 500,
                  cursor: saving ? "default" : "pointer",
                }}
              >
                {codMethodLabel(m)}
              </button>
            );
          })}
        </div>

        {/* The date going in. Never a silent default. */}
        <div
          style={{
            borderTop: `1px solid ${ink(0.15)}`,
            paddingTop: "0.75rem",
            fontSize: "0.9rem",
          }}
        >
          {decision.source === "delivered" ? (
            <>
              <div style={{ color: SURFACE_TEXT }}>
                Dated <strong>{formatDateTime(decision.iso)}</strong>
              </div>
              <div
                style={{ color: SURFACE_TEXT_MUTED, marginTop: "0.2rem" }}
              >
                When this order was marked delivered — not today, so the
                money lands in the month it was taken.
              </div>
            </>
          ) : decision.source === "now" ? (
            <>
              <div style={{ color: SURFACE_TEXT }}>
                Dated <strong>{formatDateTime(decision.iso)}</strong> (now)
              </div>
              <div
                style={{ color: SURFACE_TEXT_MUTED, marginTop: "0.2rem" }}
              >
                This order is not marked delivered yet, so the collection is
                dated now.
              </div>
            </>
          ) : (
            <>
              <div style={{ color: SURFACE_TEXT, fontWeight: 600 }}>
                No date will be stored
              </div>
              <div
                style={{ color: SURFACE_TEXT_MUTED, marginTop: "0.2rem" }}
              >
                This order is delivered but nothing on it records when, so
                paid_at is left empty rather than guessed. The method and the
                paid status are still recorded.
              </div>
            </>
          )}
        </div>

        {error ? (
          <div style={{ fontSize: "0.9rem", color: "#B3261E" }}>{error}</div>
        ) : null}

        <div
          style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={{
              padding: "0.45rem 0.9rem",
              borderRadius: 8,
              border: `1px solid ${SURFACE_BORDER}`,
              background: "transparent",
              color: SURFACE_TEXT,
              fontSize: "0.95rem",
              cursor: saving ? "default" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!method || saving}
            style={{
              padding: "0.45rem 0.9rem",
              borderRadius: 8,
              border: `1px solid ${INK}`,
              background: INK,
              color: CREAM,
              fontSize: "0.95rem",
              fontWeight: 600,
              opacity: !method || saving ? 0.5 : 1,
              cursor: !method || saving ? "default" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The trigger. Rendered only for an unsettled COD order — the caller gates
 *  on canSettleCod(), so this does not re-check. */
export function CodSettleButton({
  disabled,
  onClick,
  style,
}: {
  disabled?: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "0.3rem 0.6rem",
        borderRadius: 6,
        border: `1px solid ${BORDER}`,
        background: cream(0.08),
        color: CREAM,
        fontSize: "0.85rem",
        fontWeight: 500,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
      title="Record how this COD order's cash arrived"
    >
      Record cash
    </button>
  );
}

/** Settled state, for a row that already has a method. Read-only. */
export function CodSettledChip({ method }: { method: string }) {
  const label = codMethodDisplay(method);
  return (
    <span
      style={{
        fontSize: "0.8rem",
        color: TEXT_MUTED,
        whiteSpace: "nowrap",
      }}
      title="How this COD order's cash arrived"
    >
      {label}
    </span>
  );
}
