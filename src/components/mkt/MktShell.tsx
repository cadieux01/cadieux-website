"use client";

// Chrome for /mkt. Pure chrome — the GATE now lives in /mkt/layout.tsx
// (server-side, Supabase Auth). Earlier phases had MktShell run the
// admin PasswordGate here; that is gone, so by the time this file
// renders, the caller is a known profile with status='active'.
//
// What this renders:
//   * page title + subtitle + action slot (same API as before).
//   * a small identity chip top-right with the signed-in name, role,
//     and a Sign out button.
//   * a NotificationBar that reads logistics.notifications for
//     auth.uid() via /api/mkt/notifications.
//
// Idle logout is DROPPED here — the Supabase session TTL and refresh
// flow handle that, and the previous idle-timer depended on the admin
// HMAC cookie which /mkt no longer uses. /admin keeps its idle timer
// unchanged.

import Link from "next/link";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { useMktProfile } from "@/components/mkt/MktProfileContext";
import { NotificationBar } from "@/components/mkt/NotificationBar";
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
  const profile = useMktProfile();
  const router = useRouter();

  const signOut = async () => {
    try {
      await fetch("/api/mkt/auth/signout", { method: "POST" });
    } catch {
      /* best-effort; the server clears the cookie via the route, but
         if the network drops we still want the user off the page. */
    }
    router.replace("/mkt/login");
    router.refresh();
  };

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
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .mkt-scope, .mkt-scope * { box-sizing: border-box; }
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
            @media (prefers-reduced-motion: reduce) {
              .mkt-scope *, .mkt-scope *::before, .mkt-scope *::after {
                transition-duration: 0ms !important;
                animation-duration: 0ms !important;
              }
            }
          `,
        }}
      />

      <header
        style={{
          borderBottom: `1px solid ${MKT.ash}`,
          padding:
            "0.8rem clamp(1rem, 4vw, 1.5rem) 0.8rem calc(clamp(1rem, 4vw, 1.5rem) + env(safe-area-inset-left))",
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
              alignItems: "center",
              fontSize: "0.92rem",
              flexWrap: "wrap",
            }}
          >
            <Link href="/mkt" style={{ color: MKT.ink }}>CRM</Link>
            <Link href="/mkt/tasks" style={{ color: MKT.ink }}>Tasks</Link>
            <Link href="/mkt/campaigns" style={{ color: MKT.ink }}>Campaigns</Link>
            <Link href="/mkt/calendar" style={{ color: MKT.ink }}>Calendar</Link>
            {profile.role === "admin" ? (
              <Link href="/mkt/team" style={{ color: MKT.ink }}>Team</Link>
            ) : null}
            <NotificationBar />
            <IdentityChip
              name={profile.full_name ?? profile.email ?? "You"}
              role={profile.role}
              onSignOut={signOut}
            />
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

function IdentityChip({
  name,
  role,
  onSignOut,
}: {
  name: string;
  role: string;
  onSignOut: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: "0.25rem 0.55rem",
        border: `1px solid ${MKT.ash}`,
        borderRadius: 999,
        background: "#FFFFFF",
      }}
    >
      <span style={{ color: MKT.ink, fontSize: "0.88rem" }}>{name}</span>
      <span
        style={{
          color: MKT.green,
          fontSize: "0.72rem",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontWeight: 700,
        }}
      >
        {role}
      </span>
      <button
        type="button"
        onClick={onSignOut}
        style={{
          border: 0,
          background: "transparent",
          color: MKT.blue,
          fontSize: "0.82rem",
          cursor: "pointer",
          padding: "0 0.1rem",
        }}
      >
        Sign out
      </button>
    </div>
  );
}
