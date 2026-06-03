"use client";

// Product Protection Lock — modal + hook.
//
// useProductLock() returns:
//   • requireUnlock(productName, change): opens the modal and resolves
//     with a server-issued GRANT token on success, or null if cancelled.
//   • modal: the element to render in the page tree.
//
// The entered key is POSTed to /api/admin/verify-product-lock (server-side
// verification). It is never compared in the browser and never stored.
// On success the server returns a short-lived signed grant the caller
// attaches to the actual mutation request.

import { useCallback, useEffect, useRef, useState } from "react";

import { adminAuthHeaders } from "@/lib/admin-client";


const GREEN = "#024628";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.7)";

type UnlockContext = { productName: string; change: string };

type VerifyResponse = {
  ok?: boolean;
  grant?: string;
  error?: string;
  attemptsLeft?: number;
  retryAfterMs?: number;
};

export function useProductLock() {
  const [ctx, setCtx] = useState<UnlockContext | null>(null);
  const resolverRef = useRef<((grant: string | null) => void) | null>(null);

  const requireUnlock = useCallback(
    (productName: string, change: string): Promise<string | null> => {
      setCtx({ productName, change });
      return new Promise<string | null>((resolve) => {
        resolverRef.current = resolve;
      });
    },
    [],
  );

  const resolve = useCallback((grant: string | null) => {
    setCtx(null);
    const r = resolverRef.current;
    resolverRef.current = null;
    r?.(grant);
  }, []);

  const modal = ctx ? (
    <ProductLockModal ctx={ctx} onResolve={resolve} />
  ) : null;

  return { requireUnlock, modal };
}

function ProductLockModal({
  ctx,
  onResolve,
}: {
  ctx: UnlockContext;
  onResolve: (grant: string | null) => void;
}) {
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

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

  // Tick while locked out so the countdown updates + re-enables.
  useEffect(() => {
    if (lockedUntil == null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const lockRemaining =
    lockedUntil != null ? Math.max(0, lockedUntil - now) : 0;
  const isLocked = lockRemaining > 0;

  async function confirm() {
    if (busy || isLocked || key.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/verify-product-lock", {
        method: "POST",
        headers: adminAuthHeaders({ "Content-Type": "application/json" }),
        credentials: "include",
        body: JSON.stringify({
          key,
          productName: ctx.productName,
          change: ctx.change,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as VerifyResponse;

      if (res.ok && json.ok && json.grant) {
        onResolve(json.grant);
        return;
      }

      if (res.status === 423) {
        const until = Date.now() + (json.retryAfterMs ?? 5 * 60 * 1000);
        setLockedUntil(until);
        setNow(Date.now());
        setError("Too many failed attempts. Locked out.");
        setKey("");
        return;
      }

      if (json.error === "incorrect_key") {
        const left = json.attemptsLeft ?? 0;
        setError(
          `Incorrect key.${left > 0 ? ` ${left} attempt${left === 1 ? "" : "s"} left.` : ""}`,
        );
        setKey("");
        return;
      }

      setError(json.error || `Verification failed (${res.status}).`);
    } catch {
      setError("Network error — could not verify the key.");
    } finally {
      setBusy(false);
    }
  }

  const mmss = (() => {
    const total = Math.ceil(lockRemaining / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  })();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Product Protection Lock"
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
          width: "min(440px, 100%)",
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
          <span aria-hidden>🔒</span> Product Protection Lock
        </h2>

        <p
          style={{
            fontFamily: "var(--font-body)",
            color: FADED,
            fontSize: "0.85rem",
            lineHeight: 1.55,
            margin: "1rem 0 0.35rem",
          }}
        >
          Changes to the product catalogue affect the live app immediately.
        </p>
        <p
          style={{
            fontFamily: "var(--font-body)",
            color: CREAM,
            fontSize: "0.85rem",
            margin: "0 0 1rem",
          }}
        >
          {ctx.change} — <strong>{ctx.productName}</strong>
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
          Enter the Product Key to confirm
        </label>
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            type={showKey ? "text" : "password"}
            value={key}
            disabled={busy || isLocked}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void confirm();
            }}
            placeholder="••••••••"
            autoComplete="off"
            style={{
              width: "100%",
              background: "transparent",
              border: `1px solid ${isLocked ? "#f43f5e" : "rgba(251,243,212,0.3)"}`,
              color: CREAM,
              fontFamily: "var(--font-body)",
              fontSize: "0.95rem",
              letterSpacing: "0.12em",
              padding: "0.7rem 2.6rem 0.7rem 0.85rem",
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            aria-label={showKey ? "Hide key" : "Show key"}
            tabIndex={-1}
            style={{
              position: "absolute",
              right: "0.7rem",
              top: "50%",
              transform: "translateY(-50%)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: showKey ? CREAM : "rgba(251,243,212,0.45)",
              display: "flex",
              alignItems: "center",
            }}
          >
            {showKey ? (
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            ) : (
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        </div>

        {error ? (
          <p
            role="alert"
            style={{
              color: isLocked ? "#fda4af" : "#fecaca",
              fontFamily: "var(--font-body)",
              fontSize: "0.78rem",
              margin: "0.7rem 0 0",
            }}
          >
            {error}
            {isLocked ? ` Try again in ${mmss}.` : ""}
          </p>
        ) : null}

        <div
          className="flex justify-end gap-3"
          style={{ marginTop: "1.5rem" }}
        >
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
            disabled={busy || isLocked || key.length === 0}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.22em",
              color: CREAM,
              background: GREEN,
              border: `1px solid ${GREEN}`,
              padding: "0.55rem 1.1rem",
              cursor: busy || isLocked || key.length === 0 ? "not-allowed" : "pointer",
              opacity: busy || isLocked || key.length === 0 ? 0.5 : 1,
            }}
          >
            {busy ? "Verifying…" : "Confirm Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
