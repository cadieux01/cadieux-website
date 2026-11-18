"use client";

// Chrome for /mkt and future marketing surfaces. Deliberately
// different from AdminShell — /admin is dark + austere, /mkt is light
// + on brand (cream surface, green primary, blue accent). But the
// GATE is the same: a valid admin session, same POST /api/admin/login,
// same 30-day remember-me. We import PasswordGate + the three
// remembered-auth helpers from AdminShell rather than duplicating
// them — one authoritative gate per surface that needs the admin
// session, see the export banner on those helpers.
//
// A note on the password screen itself: PasswordGate is INK-themed
// because it lives inside AdminShell too, and retheming it here would
// bifurcate the login UX. That screen appears at most once a month
// (the cookie's TTL is 30 days). The CRM surface — which is what the
// operator actually works on — is cream.

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import {
  PasswordGate,
  clearRememberedAuth,
  readRememberedAuth,
  writeRememberedAuth,
} from "@/components/admin/AdminShell";
import {
  ADMIN_AUTH_LOGOUT_EVENT,
  adminTokenValid,
} from "@/lib/admin-client";
import { IDLE, useIdleLogout } from "@/lib/session-timeout";
import { MKT } from "./theme";

export function MktShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [idleWarning, setIdleWarning] = useState<string | null>(null);

  useEffect(() => {
    if (adminTokenValid() || readRememberedAuth()) setAuthed(true);
    setChecking(false);
  }, []);

  useEffect(() => {
    const onLogout = () => setAuthed(false);
    window.addEventListener(ADMIN_AUTH_LOGOUT_EVENT, onLogout);
    return () =>
      window.removeEventListener(ADMIN_AUTH_LOGOUT_EVENT, onLogout);
  }, []);

  useIdleLogout({
    enabled: authed,
    timeoutMs: IDLE.SUPER_ADMIN,
    warnBeforeMs: 5 * 60 * 1000,
    onWarn: () =>
      setIdleWarning(
        "You'll be signed out in 5 minutes due to inactivity. Move the mouse or press a key to stay signed in.",
      ),
    onTimeout: () => {
      void fetch("/api/admin/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      }).catch(() => {});
      clearRememberedAuth();
      setAuthed(false);
      setIdleWarning(null);
    },
  });

  useEffect(() => {
    if (!idleWarning) return;
    const reset = () => setIdleWarning(null);
    const events = ["mousedown", "keydown", "touchstart"] as const;
    for (const e of events)
      window.addEventListener(e, reset, { once: true });
    return () => {
      for (const e of events) window.removeEventListener(e, reset);
    };
  }, [idleWarning]);

  if (checking) return null;

  if (!authed) {
    // PasswordGate is dark; see module comment. This is deliberate —
    // same credentials, same component, a 30-day remember-me means the
    // operator sees this screen about once a month.
    return (
      <main
        style={{
          minHeight: "100vh",
          position: "relative",
          background: "#1D1D1F",
        }}
      >
        <PasswordGate
          onSuccess={() => {
            writeRememberedAuth();
            try {
              localStorage.setItem(
                "cdx_last_activity",
                String(Date.now()),
              );
            } catch {
              /* storage unavailable; in-memory timer still works */
            }
            setAuthed(true);
          }}
        />
      </main>
    );
  }

  return (
    <div
      className="mkt-scope"
      style={{
        background: MKT.cream,
        minHeight: "100vh",
        color: MKT.ink,
        fontFamily: "var(--font-body)",
      }}
    >
      {/* Scoped reset. The customer-facing layout paints <body> ash
          and the admin subtree paints it ink; /mkt is cream on top of
          both without fighting, because this div sets background +
          min-height itself. The !important on text-color is there
          because several admin components we might pull in via adminFetch
          surfaces (e.g. StatusBadge) set a cream text colour that would
          vanish on this background. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .mkt-scope, .mkt-scope * {
              box-sizing: border-box;
            }
            .mkt-scope a { color: ${MKT.blue}; text-decoration: none; }
            .mkt-scope a:hover { text-decoration: underline; text-underline-offset: 2px; }
            .mkt-scope input, .mkt-scope select, .mkt-scope textarea {
              font-family: var(--font-body);
              color: ${MKT.ink};
              background: #FFFFFF;
              border: 1px solid ${MKT.ash};
              padding: 0.5rem 0.75rem;
              border-radius: 6px;
              outline: none;
              transition: border-color 140ms ease, box-shadow 140ms ease;
            }
            .mkt-scope input:focus, .mkt-scope select:focus, .mkt-scope textarea:focus {
              border-color: ${MKT.blue};
              box-shadow: 0 0 0 3px rgba(67,105,178,0.18);
            }
            .mkt-scope button { font-family: var(--font-body); }
            .mkt-scope ::placeholder { color: rgba(29,29,31,0.45); }

            /* Reduced motion — honour the OS setting. 120-150ms is
               already modest; this cuts it to instant for anyone who
               has asked for it. */
            @media (prefers-reduced-motion: reduce) {
              .mkt-scope *, .mkt-scope *::before, .mkt-scope *::after {
                transition-duration: 0ms !important;
                animation-duration: 0ms !important;
              }
            }
          `,
        }}
      />

      {idleWarning ? (
        <div
          role="status"
          style={{
            background: MKT.green,
            color: MKT.cream,
            padding: "0.6rem 1rem",
            fontSize: "0.92rem",
            textAlign: "center",
            fontFamily: "var(--font-body)",
          }}
        >
          {idleWarning}
        </div>
      ) : null}

      <header
        style={{
          borderBottom: `1px solid ${MKT.ash}`,
          padding:
            "0.9rem clamp(1rem, 4vw, 1.5rem) 0.9rem calc(clamp(1rem, 4vw, 1.5rem) + env(safe-area-inset-left))",
          background: "#FFFDF4",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.75rem",
            maxWidth: 1400,
            marginInline: "auto",
          }}
        >
          <Link
            href="/mkt"
            style={{
              color: MKT.green,
              fontWeight: 600,
              fontSize: "1.05rem",
              letterSpacing: "0.02em",
            }}
          >
            Cadieux · Marketing
          </Link>
          <nav
            style={{
              display: "flex",
              gap: "1rem",
              alignItems: "baseline",
              fontSize: "0.92rem",
            }}
          >
            <Link href="/admin/overview" style={{ color: MKT.ink }}>
              Admin
            </Link>
          </nav>
        </div>
      </header>

      <section
        style={{
          padding:
            "1.4rem clamp(1rem, 4vw, 1.5rem) 3rem calc(clamp(1rem, 4vw, 1.5rem) + env(safe-area-inset-left))",
          maxWidth: 1400,
          marginInline: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.6rem",
            marginBottom: "1.4rem",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontFamily: "var(--font-body)",
                fontWeight: 700,
                fontSize: "clamp(1.4rem, 3.5vw, 1.85rem)",
                color: MKT.green,
                letterSpacing: "-0.01em",
                lineHeight: 1.1,
              }}
            >
              {title}
            </h1>
            {subtitle ? (
              <p
                style={{
                  margin: "0.2rem 0 0",
                  color: MKT.mute,
                  fontSize: "0.98rem",
                }}
              >
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {actions}
            </div>
          ) : null}
        </div>
        {children}
      </section>
    </div>
  );
}
