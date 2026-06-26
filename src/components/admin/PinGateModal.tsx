"use client";

// PIN gate — modal + hook.
//
// usePinGate() returns:
//   • requirePin(): opens the modal and resolves with a server-issued GRANT
//     token on success, or null if cancelled. If a still-valid grant was
//     minted in the last few minutes it resolves immediately (no prompt).
//   • modal: the element to render in the page tree.
//
// The 6-digit PIN is POSTed to /api/admin/pin { action: "verify" } — the
// SAME endpoint and SAME website_admin_pin row that /admin/profile sets and
// resets. It is never compared in the browser. On success the server
// returns a short-lived signed grant the caller attaches (as the
// `x-pin-grant` header) to the actual product mutation, and also sets a
// matching httpOnly `pin_verified` cookie.

import { useCallback, useEffect, useRef, useState } from "react";

import { adminAuthHeaders } from "@/lib/admin-client";

const GREEN = "#024628";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.7)";

// ── module-level grant cache ──────────────────────────────────────────────
// Survives across product pages within the 5-minute window so the operator
// isn't re-prompted for every edit. Read the (unsigned) exp from the token —
// the HMAC is only ever verified server-side, so this is purely a UX gate.

let cachedGrant: { token: string; exp: number } | null = null;

function readExp(token: string): number | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  try {
    const b64 = token.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64)) as { exp?: number };
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

function cacheGrant(token: string): void {
  const exp = readExp(token);
  cachedGrant = exp ? { token, exp } : null;
}

function validCachedGrant(): string | null {
  // 3s safety margin so we never attach a grant that expires mid-flight.
  if (cachedGrant && cachedGrant.exp > Date.now() + 3000) return cachedGrant.token;
  return null;
}

type VerifyResponse = {
  ok?: boolean;
  grant?: string;
  error?: string;
};

export function usePinGate() {
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<((grant: string | null) => void) | null>(null);

  const requirePin = useCallback((): Promise<string | null> => {
    const cached = validCachedGrant();
    if (cached) return Promise.resolve(cached);
    setOpen(true);
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const resolve = useCallback((grant: string | null) => {
    setOpen(false);
    const r = resolverRef.current;
    resolverRef.current = null;
    r?.(grant);
  }, []);

  const modal = open ? <PinGateModal onResolve={resolve} /> : null;

  return { requirePin, modal };
}

function PinGateModal({
  onResolve,
}: {
  onResolve: (grant: string | null) => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResolve(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onResolve]);

  async function confirm() {
    if (busy || pin.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pin", {
        method: "POST",
        headers: adminAuthHeaders({ "Content-Type": "application/json" }),
        credentials: "include",
        // The PIN is sent as a STRING under the exact field name the route
        // expects (`pin`). Never coerce to Number — leading zeros must
        // survive — and never trim the digits.
        body: JSON.stringify({ action: "verify", pin }),
      });
      const json = (await res.json().catch(() => ({}))) as VerifyResponse;

      if (res.ok && json.ok && json.grant) {
        cacheGrant(json.grant);
        onResolve(json.grant);
        return;
      }

      if (res.status === 404) {
        setError("No PIN is set yet. Set one in Profile first.");
        setPin("");
        return;
      }
      if (res.status === 429) {
        setError(json.error || "Too many incorrect attempts. Try again later.");
        setPin("");
        return;
      }

      setError(json.error || `Verification failed (${res.status}).`);
      setPin("");
    } catch {
      setError("Network error — could not verify the PIN.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Enter security PIN"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onResolve(null);
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        style={{
          width: "min(420px, 100%)",
          background: "rgb(8,10,8)",
          border: `1px solid ${GREEN}`,
          boxShadow: "0 24px 60px -12px rgba(0,0,0,0.7)",
          padding: "1.6rem",
        }}
      >
        <h2
          className="uppercase"
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 300,
            color: CREAM,
            fontSize: "1.15rem",
            letterSpacing: "0.14em",
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: "0.55rem",
          }}
        >
          <span aria-hidden>🔒</span> Security PIN
        </h2>

        <p
          style={{
            fontFamily: "var(--font-body)",
            color: FADED,
            fontSize: "0.85rem",
            lineHeight: 1.55,
            margin: "1rem 0 1rem",
          }}
        >
          Changes to the product catalogue affect the live app immediately.
          Enter your 6-digit security PIN to continue.
        </p>

        <label
          className="uppercase block"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.62rem",
            letterSpacing: "0.22em",
            color: FADED,
            marginBottom: "0.5rem",
          }}
        >
          6-digit PIN
        </label>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          disabled={busy}
          // Keep the value a STRING; strip non-digits only, cap at 6. This
          // preserves leading zeros (no Number() coercion anywhere).
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => {
            if (e.key === "Enter") void confirm();
          }}
          placeholder="••••••"
          style={{
            width: "100%",
            background: "transparent",
            border: `1px solid rgba(251,243,212,0.3)`,
            color: CREAM,
            fontFamily: "var(--font-body)",
            fontSize: "1.1rem",
            letterSpacing: "0.4em",
            textAlign: "center",
            padding: "0.7rem 0.85rem",
            outline: "none",
          }}
        />

        {error ? (
          <p
            role="alert"
            style={{
              color: "#fecaca",
              fontFamily: "var(--font-body)",
              fontSize: "0.78rem",
              margin: "0.7rem 0 0",
            }}
          >
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-3" style={{ marginTop: "1.5rem" }}>
          <button
            type="button"
            onClick={() => onResolve(null)}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.22em",
              color: FADED,
              background: "transparent",
              border: "1px solid rgba(251,243,212,0.25)",
              padding: "0.55rem 1.1rem",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy || pin.length !== 6}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.22em",
              color: CREAM,
              background: GREEN,
              border: `1px solid ${GREEN}`,
              padding: "0.55rem 1.1rem",
              cursor: busy || pin.length !== 6 ? "not-allowed" : "pointer",
              opacity: busy || pin.length !== 6 ? 0.5 : 1,
            }}
          >
            {busy ? "Verifying…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
