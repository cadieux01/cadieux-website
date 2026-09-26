"use client";

// ORDER PIN gate — modal + hook, for confirming/cancelling orders and
// subscriptions.
//
// Deliberately NOT the same thing as PinGateModal.tsx:
//
//                     PinGateModal            OrderPinModal (this file)
//   returns           a signed GRANT token    the raw 6 digits
//   caches            yes, 5 minutes          NEVER
//   verified by       POST /api/admin/pin     the mutation route itself
//
// There is no module-level cache here and there must never be one. The
// operator re-enters the PIN for every single status change — that was a
// deliberate choice, not an oversight, and a cache would silently undo it.
//
// The PIN is NOT verified here. `requireOrderPin()` only collects it; the
// caller attaches it to the real mutation as the `x-order-pin` header and
// the server compares it there. That means a wrong PIN surfaces as a failed
// mutation, so callers pass the server's message back via `onRejected` to
// re-open the modal with the error shown.

import { useCallback, useEffect, useRef, useState } from "react";

import { CREAM, INK, BORDER, TEXT_MUTED } from "./theme";

export const ORDER_PIN_HEADER = "x-order-pin";

/** Attach a collected PIN to a fetch's headers. */
export function orderPinHeaders(
  pin: string,
  base: Record<string, string> = {},
): Record<string, string> {
  return { ...base, [ORDER_PIN_HEADER]: pin };
}

export type OrderPinPrompt = {
  /** What is about to change, e.g. "Cancel order #1a2b3c4d". */
  title: string;
  /** One line of consequence, shown above the input. */
  detail?: string;
  /** Server error from a previous rejected attempt. */
  error?: string | null;
};

export function useOrderPinGate() {
  const [prompt, setPrompt] = useState<OrderPinPrompt | null>(null);
  const resolverRef = useRef<((pin: string | null) => void) | null>(null);

  const requireOrderPin = useCallback(
    (p: OrderPinPrompt): Promise<string | null> => {
      setPrompt(p);
      return new Promise<string | null>((resolve) => {
        resolverRef.current = resolve;
      });
    },
    [],
  );

  const resolve = useCallback((pin: string | null) => {
    setPrompt(null);
    const r = resolverRef.current;
    resolverRef.current = null;
    r?.(pin);
  }, []);

  const modal = prompt ? (
    <OrderPinModal prompt={prompt} onResolve={resolve} />
  ) : null;

  return { requireOrderPin, modal };
}

function OrderPinModal({
  prompt,
  onResolve,
}: {
  prompt: OrderPinPrompt;
  onResolve: (pin: string | null) => void;
}) {
  const [pin, setPin] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResolve(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onResolve]);

  const ready = pin.length === 6;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Enter order PIN"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onResolve(null);
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
          width: "min(420px, 100%)",
          background: INK,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 24px 60px -12px rgba(29,29,31,0.7)",
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
          <span aria-hidden>🔒</span> Order PIN
        </h2>

        <p
          style={{
            fontFamily: "var(--font-body)",
            color: CREAM,
            fontSize: "1rem",
            lineHeight: 1.55,
            margin: "1rem 0 0.35rem",
          }}
        >
          {prompt.title}
        </p>
        <p
          style={{
            fontFamily: "var(--font-body)",
            color: TEXT_MUTED,
            fontSize: "1rem",
            lineHeight: 1.55,
            margin: "0 0 1rem",
          }}
        >
          {prompt.detail ??
            "This reaches the customer straight away. Enter your 6-digit order PIN to continue."}
        </p>

        <label
          className="uppercase block"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.22em",
            color: TEXT_MUTED,
            marginBottom: "0.5rem",
          }}
        >
          6-digit order PIN
        </label>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          // String only — leading zeros must survive, so never Number().
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ready) onResolve(pin);
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

        {prompt.error ? (
          <p
            role="alert"
            style={{
              color: "#EF4444",
              fontFamily: "var(--font-body)",
              fontSize: "1rem",
              margin: "0.7rem 0 0",
            }}
          >
            {prompt.error}
          </p>
        ) : null}

        <div className="flex justify-end gap-3" style={{ marginTop: "1.5rem" }}>
          <button
            type="button"
            onClick={() => onResolve(null)}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.875rem",
              letterSpacing: "0.22em",
              color: TEXT_MUTED,
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
            onClick={() => onResolve(pin)}
            disabled={!ready}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.875rem",
              letterSpacing: "0.22em",
              color: CREAM,
              background: INK,
              border: `1px solid ${CREAM}`,
              padding: "0.55rem 1.1rem",
              cursor: ready ? "pointer" : "not-allowed",
              opacity: ready ? 1 : 0.5,
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
