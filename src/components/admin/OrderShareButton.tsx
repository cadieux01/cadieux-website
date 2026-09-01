"use client";

// Per-order "Share" button used in the /admin/orders action cell.
//
// Click → popover listing the active `delivery_partners` rows. Each
// row opens wa.me/<partnerPhone>?text=<message> in a new tab. Extras:
//   - "Copy message" copies the composed text to clipboard.
//   - "Share (other)" opens wa.me/?text=<message> (no partner) so the
//     operator can pick a contact themselves.
//
// Partners are fetched by the parent (/admin/orders/page.tsx) once and
// passed in; this component itself performs no network I/O.

import { useEffect, useRef, useState } from "react";

import type { AdminOrderRow } from "@/lib/admin-shared";
import { composeShareMessage } from "@/lib/order-share-message";

const CREAM = "#FBF3D4";
const FADED = "rgba(251,243,212,0.6)";
const BORDER = "rgba(251,243,212,0.35)";

export type ShareablePartner = {
  id: string;
  name: string;
  phone: string;
};

export function OrderShareButton({
  order,
  partners,
  partnersLoading,
  partnersError,
  buttonStyle,
}: {
  order: AdminOrderRow;
  partners: ShareablePartner[];
  partnersLoading: boolean;
  partnersError: string | null;
  /** Reuse the row's `buttonSm` style so this button matches the others. */
  buttonStyle: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
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

  const message = composeShareMessage(order);
  const encoded = encodeURIComponent(message);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(message);
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
        Share
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
            background: "#1D1D1F",
            border: `1px solid ${BORDER}`,
            padding: 8,
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            color: CREAM,
            boxShadow: "0 8px 24px rgba(29,29,31,0.6)",
          }}
        >
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
