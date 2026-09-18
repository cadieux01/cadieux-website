// ZoneAssignPopover — the "click a zone badge, transfer the row" UI.
//
// Two modes, decided by the caller (based on the resolver's ZoneResolution):
//
//   1. RULE mode.
//      The row has a keyable address (pincode or locality). Picking a zone
//      writes a rule that applies to this row AND every current/future row
//      keyed the same way. A server-side preview runs before confirm so the
//      operator sees the global blast radius, not the on-board count.
//
//   2. ROW-PIN mode.
//      The row has neither pincode nor locality. Picking a zone writes a
//      row-override keyed on the parent id. No preview, no confirm — one
//      row is affected, nothing is learned.
//
// A third case is "clear rule": if the current row is already served by a
// learned rule, the popover offers a "Clear rule" option that runs the
// same preview endpoint with zone=clear and, on confirm, deletes the rule.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ZONE_LABELS,
  type NumberedZone,
  type ZoneKey,
  type ZoneResolution,
  type ZoneSource,
} from "@/lib/delivery-zones";
import {
  deleteRowOverride,
  deleteRule,
  previewRule,
  upsertRowOverride,
  upsertRule,
  type PreviewResponse,
} from "@/lib/zone-rules-client";

const NUMBERED_ZONES: NumberedZone[] = ["zone1", "zone2", "zone3", "zone4"];

export type ZoneAssignTarget =
  | { kind: "order"; id: string }
  | { kind: "subscription"; id: string };

export type RuleKey = {
  key_type: "pincode" | "locality";
  key_value: string;
  key_input: string;
};

export function ZoneAssignPopover({
  open,
  onClose,
  currentZone,
  resolution,
  target,
  ruleKey,
  /** id of the row-override or rule row already covering this row, if any.
   *  Used by "Clear rule" and "Remove pin". */
  existingRuleId,
  existingOverrideId,
  onChanged,
  anchorRect,
}: {
  open: boolean;
  onClose: () => void;
  currentZone: ZoneKey;
  resolution: ZoneResolution;
  target: ZoneAssignTarget;
  ruleKey: RuleKey | null;
  existingRuleId?: string | null;
  existingOverrideId?: string | null;
  onChanged: () => void;
  anchorRect: DOMRect | null;
}) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [pending, setPending] = useState<NumberedZone | "clear" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const mode: "rule" | "row-pin" = ruleKey ? "rule" : "row-pin";
  const source: ZoneSource = resolution.source;

  // Reset transient state whenever the popover is (re)opened.
  useEffect(() => {
    if (!open) {
      setPending(null);
      setPreview(null);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  // Dismiss on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = popRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const runPreview = useCallback(
    async (zone: NumberedZone | "clear") => {
      if (!ruleKey) return;
      setPending(zone);
      setBusy(true);
      setError(null);
      try {
        const p = await previewRule({
          key_type: ruleKey.key_type,
          key_input: ruleKey.key_input,
          zone,
        });
        setPreview(p);
      } catch (err) {
        setError((err as Error).message || "Preview failed.");
      } finally {
        setBusy(false);
      }
    },
    [ruleKey],
  );

  const commit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "rule") {
        if (!ruleKey) throw new Error("No rule key.");
        if (pending === "clear") {
          if (!existingRuleId) throw new Error("No rule to clear.");
          await deleteRule(existingRuleId);
        } else if (pending) {
          await upsertRule({
            key_type: ruleKey.key_type,
            key_input: ruleKey.key_input,
            zone: pending,
          });
        } else {
          return;
        }
      } else {
        // row-pin
        if (!pending || pending === "clear") return;
        const body =
          target.kind === "order"
            ? { order_id: target.id, zone: pending as NumberedZone }
            : { subscription_id: target.id, zone: pending as NumberedZone };
        await upsertRowOverride(body);
      }
      onChanged();
      onClose();
    } catch (err) {
      setError((err as Error).message || "Save failed.");
    } finally {
      setBusy(false);
    }
  }, [busy, mode, pending, ruleKey, existingRuleId, target, onChanged, onClose]);

  const commitClearPin = useCallback(async () => {
    if (busy) return;
    if (!existingOverrideId) return;
    setBusy(true);
    setError(null);
    try {
      await deleteRowOverride(existingOverrideId);
      onChanged();
      onClose();
    } catch (err) {
      setError((err as Error).message || "Remove pin failed.");
    } finally {
      setBusy(false);
    }
  }, [busy, existingOverrideId, onChanged, onClose]);

  const style = useMemo<React.CSSProperties>(() => {
    if (!anchorRect) return { display: "none" };
    // Anchor beneath the badge, right-aligned. Enough space for two lines
    // of preview text without wrapping badly.
    return {
      position: "fixed",
      top: Math.min(anchorRect.bottom + 8, window.innerHeight - 260),
      left: Math.max(12, anchorRect.left - 12),
      zIndex: 100,
      width: 320,
      background: "#0F1A18",
      color: "#FBF3D4",
      border: "1px solid rgba(251,243,212,0.25)",
      borderRadius: "0.5rem",
      padding: "0.85rem",
      boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
      fontFamily: "var(--font-body)",
      fontSize: "0.9rem",
    };
  }, [anchorRect]);

  if (!open) return null;

  const showClear =
    mode === "rule" &&
    (source === "rule_pincode" || source === "rule_locality") &&
    existingRuleId;

  const showRemovePin =
    mode === "row-pin" && source === "row_override" && existingOverrideId;

  return (
    <div ref={popRef} style={style} role="dialog" aria-label="Assign zone">
      <div style={{ marginBottom: "0.5rem", opacity: 0.85 }}>
        {mode === "rule" ? (
          <>
            Rule key:{" "}
            <span style={{ fontWeight: 600 }}>
              {ruleKey?.key_type === "pincode" ? "pincode " : "locality "}
              {ruleKey?.key_input}
            </span>
          </>
        ) : (
          <>This address has no pincode, so this applies to this order only and nothing is learned.</>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.4rem",
          marginBottom: preview || pending === "clear" ? "0.6rem" : 0,
        }}
      >
        {NUMBERED_ZONES.map((z) => {
          const isCurrent = z === currentZone;
          const isPending = pending === z;
          const border = isPending
            ? "1px solid #FBF3D4"
            : "1px solid rgba(251,243,212,0.35)";
          return (
            <button
              key={z}
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                if (mode === "rule") void runPreview(z);
                else setPending(z);
              }}
              style={{
                padding: "0.4rem 0.5rem",
                border,
                borderRadius: "0.35rem",
                background: isCurrent ? "rgba(251,243,212,0.06)" : "transparent",
                color: "#FBF3D4",
                cursor: busy ? "wait" : "pointer",
                textAlign: "left",
                fontFamily: "inherit",
                fontSize: "inherit",
              }}
            >
              {ZONE_LABELS[z]}
              {isCurrent ? " · current" : ""}
            </button>
          );
        })}
      </div>

      {showClear ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setError(null);
            void runPreview("clear");
          }}
          style={{
            marginTop: "0.5rem",
            width: "100%",
            padding: "0.4rem 0.5rem",
            border: "1px solid rgba(251,243,212,0.35)",
            borderRadius: "0.35rem",
            background:
              pending === "clear" ? "rgba(251,243,212,0.06)" : "transparent",
            color: "#FBF3D4",
            cursor: busy ? "wait" : "pointer",
            fontFamily: "inherit",
            fontSize: "inherit",
          }}
        >
          Clear rule
        </button>
      ) : null}

      {showRemovePin ? (
        <button
          type="button"
          disabled={busy}
          onClick={commitClearPin}
          style={{
            marginTop: "0.5rem",
            width: "100%",
            padding: "0.4rem 0.5rem",
            border: "1px solid rgba(251,243,212,0.35)",
            borderRadius: "0.35rem",
            background: "transparent",
            color: "#FBF3D4",
            cursor: busy ? "wait" : "pointer",
            fontFamily: "inherit",
            fontSize: "inherit",
          }}
        >
          Remove pin
        </button>
      ) : null}

      {mode === "rule" && (busy || preview) ? (
        <div style={{ marginTop: "0.6rem", opacity: 0.9, lineHeight: 1.35 }}>
          {busy ? (
            <>Computing…</>
          ) : preview && ruleKey ? (
            <ConfirmLine
              preview={preview}
              ruleKey={ruleKey}
              pending={pending}
            />
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div style={{ marginTop: "0.5rem", color: "#F59E0B" }}>{error}</div>
      ) : null}

      {(mode === "rule" && preview) || (mode === "row-pin" && pending) ? (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={btnGhost}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={busy}
            style={btnPrimary}
          >
            {pending === "clear" ? "Remove rule" : "Confirm"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ConfirmLine({
  preview,
  ruleKey,
  pending,
}: {
  preview: PreviewResponse;
  ruleKey: RuleKey;
  pending: NumberedZone | "clear" | null;
}) {
  const label =
    ruleKey.key_type === "pincode" ? ruleKey.key_value : ruleKey.key_input;
  // "moved" is the count of rows whose zone would change under the proposed
  // rule. That already excludes the current row when it does not actually
  // move (e.g. it was already resolving to that zone). No -1 subtraction —
  // we want the honest number.
  const moved = preview.moved;
  if (pending === "clear") {
    return (
      <>
        Remove the rule for {label}? This moves <b>{moved}</b>{" "}
        {moved === 1 ? "order" : "orders"} back to the built-in map and reverts every
        future order keyed on {label}.
      </>
    );
  }
  const zone = pending ? ZONE_LABELS[pending as NumberedZone] : "";
  return (
    <>
      Set {label} to {zone}? This moves <b>{moved}</b> other{" "}
      {moved === 1 ? "order" : "orders"} and every future order keyed on {label}.
    </>
  );
}

const btnGhost: React.CSSProperties = {
  flex: 1,
  padding: "0.45rem",
  border: "1px solid rgba(251,243,212,0.35)",
  borderRadius: "0.35rem",
  background: "transparent",
  color: "#FBF3D4",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "inherit",
};

const btnPrimary: React.CSSProperties = {
  flex: 1,
  padding: "0.45rem",
  border: "1px solid #FBF3D4",
  borderRadius: "0.35rem",
  background: "#FBF3D4",
  color: "#0F1A18",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "inherit",
  fontWeight: 600,
};
