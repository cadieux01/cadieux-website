"use client";

// Brand-styled share affordance used across the public site:
//   • Product detail   — public link, brand caption
//   • Lab reports       — public link, brand caption
//   • Behind Cadieux    — public link, brand caption
//   • Order detail      — friendly summary only, NO link / PII
//   • Subscription page — friendly summary only, NO link / PII
//
// Behaviour:
//   1. If `navigator.share` is available, hand off to the native sheet
//      with `{title, text, url}` (or `{title, text}` when no url) so the
//      OS can route to WhatsApp / Instagram / Messages / etc.
//   2. If the native sheet is missing or rejects, fall back to a small
//      popover with two options:
//        – WhatsApp (`https://wa.me/?text=...`)
//        – Copy link   (when a url is provided)
//        – Copy text   (when no url; private item)
//
// Privacy: callers MUST NOT include phone numbers, addresses, or order
// IDs in `text` for private items. This component does not strip PII;
// it trusts the caller.

import { useEffect, useRef, useState } from "react";

const GRAIN_CREAM = "#FBF3D4";
const GOLD = "#024628";
const FOUNDATION_GREEN = "#024628";
const BORDER = "rgba(201,169,110,0.4)";

export type ShareButtonProps = {
  /** Short title shown to the OS share sheet (e.g. product name). */
  title: string;
  /** Brand-voice caption. For private items, this is the entire payload. */
  text: string;
  /** Public URL. Omit for private items (orders, subscriptions). */
  url?: string;
  /** Visual size of the button square. Default 40. */
  size?: number;
  /** When inside a card with its own click handler. */
  stopPropagation?: boolean;
  /** Optional override label rendered next to the icon (e.g. "Share story"). */
  label?: string;
};

export function ShareButton({
  title,
  text,
  url,
  size = 40,
  stopPropagation = false,
  label,
}: ShareButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState<"link" | "text" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const guard = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
  };

  // Single payload: caption + (optional) link, joined by a newline.
  // Used by the WhatsApp/copy fallbacks. The native sheet sees the
  // structured fields instead.
  const composed = url ? `${text}\n${url}` : text;

  async function handleClick(e: React.MouseEvent) {
    guard(e);
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share(url ? { title, text, url } : { title, text });
        return;
      } catch {
        // User cancelled or share rejected — fall back to popover.
      }
    }
    setMenuOpen((v) => !v);
  }

  async function copy(kind: "link" | "text") {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(kind === "link" && url ? url : composed);
        setCopied(kind);
        setTimeout(() => setCopied(null), 1500);
      }
    } catch {
      // Permission denied / unsupported — silent.
    }
  }

  const waHref = `https://wa.me/?text=${encodeURIComponent(composed)}`;

  return (
    <div
      ref={rootRef}
      style={{ position: "relative", display: "inline-block" }}
      onClick={guard}
      onMouseDown={guard}
    >
      <button
        type="button"
        title="Share"
        aria-label={label ? `Share — ${label}` : `Share ${title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={handleClick}
        style={{
          height: size,
          minWidth: size,
          padding: label ? "0 14px 0 12px" : 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          border: `1px solid ${BORDER}`,
          background: "transparent",
          color: GRAIN_CREAM,
          cursor: "pointer",
          borderRadius: 999,
          fontFamily: "var(--font-body)",
          fontSize: "0.875rem",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        <ShareIcon size={Math.round(size * 0.45)} />
        {label ? <span>{label}</span> : null}
      </button>

      {menuOpen ? (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 50,
            minWidth: 200,
            background: FOUNDATION_GREEN,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: 6,
            boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
          }}
        >
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setMenuOpen(false)}
            style={menuItemStyle}
          >
            <WhatsAppIcon size={16} />
            <span>WhatsApp</span>
          </a>
          {url ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => copy("link")}
              style={menuItemStyle}
            >
              <LinkIcon size={16} />
              <span>{copied === "link" ? "Copied!" : "Copy link"}</span>
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => copy("text")}
              style={menuItemStyle}
            >
              <LinkIcon size={16} />
              <span>{copied === "text" ? "Copied!" : "Copy text"}</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "10px 12px",
  background: "transparent",
  border: "none",
  color: GRAIN_CREAM,
  cursor: "pointer",
  textDecoration: "none",
  textAlign: "left",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.08em",
  borderRadius: 8,
};

function ShareIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function WhatsAppIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={GOLD}
      aria-hidden
    >
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 0 1 8.413 3.488 11.82 11.82 0 0 1 3.48 8.414c-.003 6.555-5.338 11.89-11.893 11.89a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.518 5.276l-.999 3.648 3.97-1.218zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.149-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
    </svg>
  );
}

function LinkIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={GOLD}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
