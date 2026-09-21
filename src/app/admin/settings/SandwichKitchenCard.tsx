"use client";

// Sandwich kitchen switch + hours. Wired to /api/admin/sandwich-kitchen.
//
// Turning ON is guarded by a confirm() — once a customer surface ships,
// flipping this open exposes the sandwich menu. Hours are IST wall-clock
// strings (HH:MM 24h) and are shown/edited as-is. Server rejects malformed
// values.

import { useCallback, useEffect, useState } from "react";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";

const CREAM = "#FBF3D4";
const INK = "#1D1D1F";
const FADED = "rgba(251,243,212,0.55)";
const BORDER = "rgba(251,243,212,0.16)";

type State = {
  enabled: boolean;
  open: string;
  close: string;
};

export default function SandwichKitchenCard() {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local draft for the hours inputs so a keystroke doesn't hit the API.
  const [openDraft, setOpenDraft] = useState("");
  const [closeDraft, setCloseDraft] = useState("");

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await adminFetch<State>("/api/admin/sandwich-kitchen");
      setState(res);
      setOpenDraft(res.open);
      setCloseDraft(res.close);
    } catch (e) {
      if (e instanceof AdminFetchError) setError(e.message);
      else if (e instanceof Error) setError(e.message);
      else setError("Could not load kitchen state.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const put = useCallback(async (patch: Partial<State>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await adminFetch<State>("/api/admin/sandwich-kitchen", {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      setState(res);
      setOpenDraft(res.open);
      setCloseDraft(res.close);
    } catch (e) {
      if (e instanceof AdminFetchError) setError(e.message);
      else if (e instanceof Error) setError(e.message);
      else setError("Could not save.");
    } finally {
      setSaving(false);
    }
  }, []);

  const flipEnabled = useCallback(async () => {
    if (!state) return;
    const next = !state.enabled;
    if (next) {
      const ok = window.confirm(
        "Open the sandwich kitchen?\n\n" +
          "Customers will be able to place sandwich orders (once the " +
          "customer surface ships). Backend guards + admin flag remain the " +
          "only stops until then.",
      );
      if (!ok) return;
    }
    await put({ enabled: next });
  }, [state, put]);

  const saveHours = useCallback(async () => {
    if (!state) return;
    if (openDraft === state.open && closeDraft === state.close) return;
    await put({ open: openDraft, close: closeDraft });
  }, [state, openDraft, closeDraft, put]);

  return (
    <section
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "1.25rem 1.4rem",
        background: "rgba(251,243,212,0.03)",
        maxWidth: 640,
        marginTop: "1.25rem",
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
        Sandwich kitchen
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
        Master switch + operating hours (IST). When ON, sandwich orders are
        accepted between the open and close times. OFF means the whole
        kitchen is closed — regardless of hours.
      </p>

      {error ? (
        <div
          style={{
            border: "1px solid rgba(239,68,68,0.45)",
            padding: "0.6rem 0.85rem",
            color: "#EF4444",
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
          marginBottom: "1rem",
        }}
      >
        <button
          type="button"
          disabled={loading || saving || !state}
          onClick={flipEnabled}
          style={{
            appearance: "none",
            border: `1px solid ${state?.enabled ? CREAM : BORDER}`,
            background: state?.enabled ? CREAM : "transparent",
            color: state?.enabled ? INK : CREAM,
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            padding: "0.65rem 1.1rem",
            borderRadius: 8,
            cursor: loading || saving ? "wait" : "pointer",
          }}
        >
          {loading
            ? "Loading…"
            : saving
              ? "Saving…"
              : state?.enabled
                ? "ON — click to close"
                : "OFF — click to open"}
        </button>
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: state?.enabled ? CREAM : FADED,
          }}
        >
          {state?.enabled ? "Kitchen OPEN" : "Kitchen closed"}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <TimeField
          label="Open"
          value={openDraft}
          onChange={setOpenDraft}
          disabled={loading || saving}
        />
        <TimeField
          label="Close"
          value={closeDraft}
          onChange={setCloseDraft}
          disabled={loading || saving}
        />
        <button
          type="button"
          onClick={() => void saveHours()}
          disabled={
            loading ||
            saving ||
            !state ||
            (openDraft === state.open && closeDraft === state.close)
          }
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: CREAM,
            border: `1px solid ${CREAM}`,
            padding: "0.55rem 1rem",
            background: "transparent",
            cursor: saving ? "wait" : "pointer",
          }}
        >
          Save hours
        </button>
      </div>
    </section>
  );
}

function TimeField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        className="uppercase"
        style={{
          fontSize: "0.7rem",
          letterSpacing: "0.2em",
          color: FADED,
          fontFamily: "var(--font-body)",
        }}
      >
        {label}
      </span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          padding: "0.45rem 0.6rem",
          background: "transparent",
          border: `1px solid ${BORDER}`,
          color: CREAM,
          fontFamily: "var(--font-body)",
          fontSize: "1rem",
          borderRadius: 6,
          colorScheme: "dark",
        }}
      />
    </label>
  );
}
