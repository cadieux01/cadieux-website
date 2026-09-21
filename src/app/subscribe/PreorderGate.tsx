"use client";

// The two pre-order-dependent fragments of /subscribe, lifted out of the
// server component so the page itself can stay on its `revalidate = 3600`
// ISR cache.
//
// Before this split, /subscribe called `noStore()` purely to keep these two
// fragments honest after an admin flips the toggle. noStore() marks the
// WHOLE page dynamic, so every visitor paid a cold server render plus three
// serial-ish DB reads for a page whose other 99% is static marketing copy —
// it was the only page on the site doing this, and measurably the slowest.
//
// The toggle now arrives client-side via the same `usePreorderMode()` hook
// /subscriptions/setup and /checkout already use, so it is never stale by
// more than one fetch. `enabled` is `null` while that fetch is in flight and
// both fragments treat null as "not pre-order" — identical to the wizard's
// behaviour, and the server still refuses subscription creation outright, so
// the brief window cannot produce a subscription we don't want.

import Link from "next/link";
import { usePreorderMode } from "@/hooks/usePreorderMode";

export function PreorderNotice() {
  const { enabled } = usePreorderMode();
  if (!enabled) return null;
  return (
    <div
      style={{
        background: "#FBF3D4",
        border: "1px solid rgba(2,70,40,0.25)",
        padding: "16px 20px",
        margin: "0 0 24px",
      }}
    >
      <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.35em", textTransform: "uppercase", color: "#024628" }}>
        Pre-order
      </p>
      <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 300, lineHeight: 1.55, color: "#024628" }}>
        Subscriptions open once daily deliveries begin. In the meantime, reserve a single loaf now — we&apos;ll confirm your first delivery date by SMS + WhatsApp.
      </p>
    </div>
  );
}

const CTA_BASE = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  background: "#FBF3D4",
  color: "#024628",
  border: "1px solid #FBF3D4",
  borderRadius: 999,
  padding: "12px 22px",
  fontFamily: "var(--font-body)",
  fontSize: 14,
  fontWeight: 500,
  letterSpacing: "0.25em",
  textTransform: "uppercase" as const,
};

export function SubscribeCta() {
  const { enabled } = usePreorderMode();

  if (enabled) {
    return (
      <span
        aria-disabled="true"
        title="Subscriptions open once daily deliveries begin. Reserve a single loaf now to be first in line."
        style={{
          ...CTA_BASE,
          opacity: 0.55,
          cursor: "not-allowed",
          userSelect: "none",
        }}
      >
        Start your subscription
        <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
          →
        </span>
      </span>
    );
  }

  return (
    <Link
      href="/subscriptions/setup"
      className="cdx-subscribe-primary"
      style={{
        ...CTA_BASE,
        textDecoration: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      Start your subscription
      <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
        →
      </span>
    </Link>
  );
}
