"use client";

// Generic "Share" popover used by the admin action cells.
//
// Click → popover listing the active `delivery_partners` rows. Each row
// opens wa.me/<partnerPhone>?text=<message> in a new tab. Extras:
//   - "Copy message" copies the composed text to clipboard.
//   - "Share (other)" opens wa.me/?text=<message> (no partner) so the
//     operator can pick a contact themselves.
//
// This component performs no network I/O and knows nothing about what
// it is sharing — the caller composes the `message` string and passes it
// in. OrderShareButton (orders) and the subscriptions Share button both
// wrap this with their own composer so the popover behaves identically.
//
// A caller with more than one thing worth sharing (a subscription can send
// just the next delivery, or the whole standing plan) passes an ARRAY of
// scopes instead. The first is the default; the popover then shows a small
// switcher above the partner list. Callers passing a plain string are
// unaffected.

import { useEffect, useRef, useState } from "react";

const CREAM = "#FBF3D4";
const FADED = "rgba(251,243,212,0.6)";
const BORDER = "rgba(251,243,212,0.35)";

export type ShareablePartner = {
  id: string;
  name: string;
  phone: string;
};

/** One thing the caller can share, e.g. "Next delivery" vs "Whole plan". */
export type ShareScope = {
  id: string;
  label: string;
  message: string;
};

export function PartnerShareButton({
  message,
  partners,
  partnersLoading,
  partnersError,
  buttonStyle,
  buttonLabel = "Share",
}: {
  /** Fully composed text the wa.me / clipboard actions send verbatim, or
   *  several labelled ones to choose between (first = default). */
  message: string | ShareScope[];
  partners: ShareablePartner[];
  partnersLoading: boolean;
  partnersError: string | null;
  /** Reuse the row's `buttonSm` style so this button matches the others. */
  buttonStyle: React.CSSProperties;
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [scopeIndex, setScopeIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const scopes: ShareScope[] | null = Array.isArray(message) ? message : null;
  // Guard the index: a caller can shrink the scope list between renders.
  const text: string = scopes
    ? (scopes[scopeIndex] ?? scopes[0])?.message ?? ""
    : (message as string);
  const encoded = encodeURIComponent(text);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // Silent — the wa.me links still work if clipboard is denied.
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={buttonStyle}
        title="Share delivery details with a partner"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {buttonLabel}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 20,
            minWidth: 240,
            // Never wider than the phone it opens on.
            maxWidth: "calc(100vw - 2rem)",
            background: "#1D1D1F",
            border: `1px solid ${BORDER}`,
            padding: 8,
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            color: CREAM,
            boxShadow: "0 8px 24px rgba(29,29,31,0.6)",
          }}
        >
          {scopes && scopes.length > 1 && (
            <div style={{ marginBottom: 6 }}>
              <div
                style={{
                  padding: "4px 8px",
                  color: FADED,
                  fontSize: "0.875rem",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                }}
              >
                Share
              </div>
              <div style={{ display: "flex", gap: 6, padding: "0 8px 6px" }}>
                {scopes.map((s, i) => {
                  const active = i === scopeIndex;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setScopeIndex(i)}
                      aria-pressed={active}
                      style={{
                        flex: 1,
                        padding: "6px 8px",
                        fontFamily: "var(--font-body)",
                        fontSize: "0.9375rem",
                        cursor: "pointer",
                        border: `1px solid ${BORDER}`,
                        background: active ? CREAM : "transparent",
                        color: active ? "#1D1D1F" : CREAM,
                      }}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div
            style={{
              padding: "4px 8px",
              color: FADED,
              fontSize: "0.875rem",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            Send to partner
          </div>

          {partnersLoading && (
            <div style={{ padding: "6px 8px", color: FADED }}>Loading…</div>
          )}
          {partnersError && (
            <div style={{ padding: "6px 8px", color: "#EF4444" }}>
              {partnersError}
            </div>
          )}
          {!partnersLoading && !partnersError && partners.length === 0 && (
            <div style={{ padding: "6px 8px", color: FADED, fontStyle: "italic" }}>
              No partners yet. Add one in Delivery Partners.
            </div>
          )}

          {partners.map((p) => {
            const waUrl = `https://wa.me/${p.phone}?text=${encoded}`;
            return (
              <a
                key={p.id}
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                style={menuItemStyle}
              >
                <span>{p.name}</span>
                <span style={{ color: FADED, fontSize: "1rem" }}>
                  WhatsApp
                </span>
              </a>
            );
          })}

          <div
            style={{
              borderTop: `1px solid ${BORDER}`,
              marginTop: 6,
              paddingTop: 6,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <button type="button" onClick={handleCopy} style={menuItemStyle}>
              <span>{copied ? "Copied!" : "Copy message"}</span>
              <span style={{ color: FADED, fontSize: "1rem" }}>Clipboard</span>
            </button>
            <a
              href={`https://wa.me/?text=${encoded}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              style={menuItemStyle}
            >
              <span>Share (other)</span>
              <span style={{ color: FADED, fontSize: "1rem" }}>Pick contact</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  padding: "8px 10px",
  color: CREAM,
  textDecoration: "none",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
  textAlign: "left",
  width: "100%",
};
