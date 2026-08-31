"use client";

// Pre-order mode toggle. Reads + writes /api/admin/preorder-mode.
//
// Confirmation is only required when TURNING ON (that's the destructive
// direction — it silently changes cart/checkout/subscribe UX for every
// visitor). Turning OFF just goes back to normal, so no prompt.

import { useCallback, useEffect, useState } from "react";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";

const CREAM = "#fbf3d4";
const GREEN = "#024628";
const FADED = "rgba(251,243,212,0.55)";
const BORDER = "rgba(251,243,212,0.16)";

type Response = { enabled: boolean; changed?: boolean };

export default function PreorderModeToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await adminFetch<Response>("/api/admin/preorder-mode");
      setEnabled(!!res.enabled);
    } catch (e) {
      if (e instanceof AdminFetchError) setError(e.message);
      else if (e instanceof Error) setError(e.message);
      else setError("Could not load pre-order mode.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flip = useCallback(
    async (next: boolean) => {
      if (next === true) {
        const ok = window.confirm(
          "Turn PRE-ORDER MODE on?\n\n" +
            "This will:\n" +
            "• Disable delivery-date + slot pickers at checkout\n" +
            "• Disable the Subscribe CTA on /subscribe and /subscriptions/setup\n" +
            "• Stamp every new order + subscription as pre-order\n" +
            "• Refuse new subscription creation entirely\n\n" +
            "Existing orders/subscriptions are untouched.",
        );
        if (!ok) return;
      }
      setError(null);
      setSaving(true);
      // optimistic
      const prev = enabled;
      setEnabled(next);
      try {
        const res = await adminFetch<Response>("/api/admin/preorder-mode", {
          method: "PUT",
          body: JSON.stringify({ enabled: next }),
        });
        setEnabled(!!res.enabled);
      } catch (e) {
        setEnabled(prev);
        if (e instanceof AdminFetchError) setError(e.message);
        else if (e instanceof Error) setError(e.message);
        else setError("Could not save pre-order mode.");
      } finally {
        setSaving(false);
      }
    },
    [enabled],
  );

  return (
    <section
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "1.25rem 1.4rem",
        background: "rgba(251,243,212,0.03)",
        maxWidth: 640,
      }}
    >
      <h2
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: "1.25rem",
          color: CREAM,
          margin: "0 0 0.35rem 0",
          letterSpacing: "0.02em",
        }}
      >
        Pre-order mode
      </h2>
      <p
        style={{
          margin: "0 0 1rem 0",
          color: FADED,
          fontFamily: "var(--font-body)",
          fontSize: "1rem",
          lineHeight: 1.55,
        }}
      >
        When ON: customers can add to cart and check out (COD or online) but
        delivery-date + slot are locked; every new order is stamped as
        pre-order; subscription creation is blocked. Set the actual delivery
        date later from the order detail page — that fires SMS + WhatsApp.
      </p>

      {error ? (
        <div
          style={{
            border: "1px solid rgba(239,68,68,0.45)",
            padding: "0.6rem 0.85rem",
            color: "#fca5a5",
            marginBottom: "0.85rem",
            borderRadius: 6,
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.9rem",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          disabled={loading || saving || enabled === null}
          onClick={() => flip(!enabled)}
          style={{
            appearance: "none",
            border: `1px solid ${enabled ? CREAM : BORDER}`,
            background: enabled ? CREAM : "transparent",
            color: enabled ? GREEN : CREAM,
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            padding: "0.65rem 1.1rem",
            borderRadius: 8,
            cursor: loading || saving ? "wait" : "pointer",
            transition: "background 0.15s, color 0.15s, border-color 0.15s",
          }}
        >
          {loading
            ? "Loading…"
            : saving
              ? "Saving…"
              : enabled
                ? "ON — click to turn off"
                : "OFF — click to turn on"}
        </button>

        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: enabled ? "#fbf3d4" : FADED,
          }}
        >
          {enabled ? "Pre-order mode is LIVE" : "Normal mode"}
        </span>
      </div>
    </section>
  );
}
