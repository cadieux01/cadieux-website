"use client";

// Shared shell for the new admin pages. Renders:
//   • the password gate (sessionStorage-backed, identical to the legacy
//     /admin page) so the operator only logs in once a month
//   • a left-side hamburger drawer with grouped nav links — on ALL
//     viewports, replacing the previous top horizontal nav
//   • a sticky page header with title/subtitle/actions slot
//
// The previous top-bar / horizontally-scrolling-tabs design was
// replaced because the operator routinely deals with 10+ admin sections
// and we want a single discoverable place for ALL of them on every
// screen size. The drawer mirrors the look of the public Nav widget
// (INK surface, CREAM marks) while staying visually distinct so the
// operator never confuses the two surfaces.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FormEvent, ReactNode, useEffect, useState } from "react";

import { ADMIN_SESSION_KEY } from "@/lib/admin-shared";
import { CREAM, INK, TEXT_FADED, BORDER } from "./theme";
import {
  ADMIN_AUTH_LOGOUT_EVENT,
  adminTokenValid,
  clearAdminToken,
  notifyAdminAuthChange,
  setAdminToken,
} from "@/lib/admin-client";
import { IDLE, useIdleLogout } from "@/lib/session-timeout";

// 30-day UX remember-me — matches the server-side admin_session cookie
// TTL. The cookie is the real credential; this localStorage flag just
// lets us skip the password gate UI until the cookie also expires.
// The previous sessionStorage flag is migrated transparently on first
// load.
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

// Legacy: an "admin_authenticated=true" localStorage flag with no expiry
// used to keep the gate open. It outlived the real 30-day credentials
// (admin_session cookie + bearer token), so after cookie expiry the shell
// would open on the flag and every /api/admin/* call would 401. It has
// been REMOVED as a gate input: the only client-side gate hints are now
// (a) the bearer token's readable exp claim and (b) the localStorage
// remembered-auth record whose expiresAt tracks the cookie TTL. Any
// stale "admin_authenticated" value already sitting in an operator's
// browser is inert because nothing reads it any more; it is also purged
// during sign-out and on any 401 via ADMIN_AUTH_LOGOUT_EVENT below.
const LEGACY_ADMIN_AUTHED_FLAG = "admin_authenticated";

function readRememberedAuth(): boolean {
  if (typeof window === "undefined") return false;
  const session = sessionStorage.getItem(ADMIN_SESSION_KEY);
  const ls = localStorage.getItem(ADMIN_SESSION_KEY);
  if (ls) {
    try {
      const parsed = JSON.parse(ls) as { expiresAt?: number };
      if (
        parsed &&
        typeof parsed.expiresAt === "number" &&
        parsed.expiresAt > Date.now()
      ) {
        return true;
      }
      localStorage.removeItem(ADMIN_SESSION_KEY);
    } catch {
      localStorage.removeItem(ADMIN_SESSION_KEY);
    }
  }
  if (session === "1") {
    writeRememberedAuth();
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    return true;
  }
  return false;
}

function writeRememberedAuth(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    ADMIN_SESSION_KEY,
    JSON.stringify({ expiresAt: Date.now() + REMEMBER_MS })
  );
}

function clearRememberedAuth(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ADMIN_SESSION_KEY);
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  localStorage.removeItem(LEGACY_ADMIN_AUTHED_FLAG);
  clearAdminToken();
}

// Nav groups for the hamburger drawer. The order intentionally mirrors
// the operator's mental model: dashboard → active work → catalog →
// customer-facing care → system audit.
type NavItem = { href: string; label: string };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Dashboard",
    items: [{ href: "/admin/overview", label: "Overview" }],
  },
  {
    label: "Operations",
    items: [
      { href: "/admin/orders", label: "Orders" },
      { href: "/admin/subscriptions", label: "Subscriptions" },
      { href: "/admin/subscriptions/plans", label: "Subscription Plans" },
      { href: "/admin/requests", label: "Requests" },
      { href: "/admin/delivery-partners", label: "Delivery Partners" },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/admin/products", label: "Products" },
      { href: "/admin/locations", label: "Store Locator" },
      { href: "/admin/service-areas", label: "Areas We Serve" },
    ],
  },
  {
    label: "Customer Care",
    items: [
      { href: "/admin/customers", label: "Customers" },
      { href: "/admin/change-requests", label: "Change Requests" },
      { href: "/admin/feedback", label: "Feedback" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/admin/audit", label: "Audit" },
      { href: "/admin/settings", label: "Settings" },
      { href: "/admin/profile", label: "Profile" },
    ],
  },
];

export function AdminShell({
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [idleWarning, setIdleWarning] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    // Open the gate only if a client-side hint says the real credentials
    // (admin_session cookie + bearer token) are still within their 30-day
    // TTL. The server enforces real auth on every /api/admin request; if
    // this hint is wrong (token still parses as valid but the cookie was
    // rotated), the first 401 from adminFetch fires ADMIN_AUTH_LOGOUT_EVENT
    // and drops us back to the gate — see the listener below.
    if (adminTokenValid() || readRememberedAuth()) setAuthed(true);
    setChecking(false);
  }, []);

  // Any /api/admin/* 401 (30-day expiry, ADMIN_TOKEN rotation, revoked
  // cookie) → drop straight back to the PasswordGate instead of leaving
  // the operator staring at blank tiles and silently-failing mutations.
  // adminFetch has already cleared the client credentials by the time
  // this event fires.
  useEffect(() => {
    const onLogout = () => setAuthed(false);
    window.addEventListener(ADMIN_AUTH_LOGOUT_EVENT, onLogout);
    return () => window.removeEventListener(ADMIN_AUTH_LOGOUT_EVENT, onLogout);
  }, []);

  // 30-minute idle auto-logout. Warning fires 5 min before, the timer
  // itself signs out (POST /api/admin/logout to invalidate the server
  // cookie + clear localStorage + drop back to the gate). Cross-tab
  // safe via the shared localStorage timestamp inside useIdleLogout.
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

  // Clear the warning once the operator actually interacts again — the
  // hook itself re-arms behind the scenes, this just hides the banner.
  useEffect(() => {
    if (!idleWarning) return;
    const reset = () => setIdleWarning(null);
    const events = ["mousedown", "keydown", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, reset, { once: true });
    return () => {
      for (const e of events) window.removeEventListener(e, reset);
    };
  }, [idleWarning]);

  // Restore the native cursor on admin pages. globals.css sets
  // `body { cursor: none }` globally; BakeryCursor / AnimatedCursor
  // (which would add `html.anim-cursor`) are NOT mounted here
  // (ClientLayoutChrome returns null on /admin). Adding admin-page
  // lets the CSS rule `html.admin-page body { cursor: auto }` win.
  useEffect(() => {
    document.documentElement.classList.add("admin-page");
    return () => {
      document.documentElement.classList.remove("admin-page");
    };
  }, []);

  // Close the drawer whenever the route changes — clicking a nav link
  // already navigates, but route-level redirects shouldn't leave a
  // dangling open drawer.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Esc closes the drawer.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  if (checking) return null;

  if (!authed) {
    return (
      <main className="min-h-screen relative" style={{ background: INK }}>
        <GrainOverlay />
        <PasswordGate
          onSuccess={() => {
            writeRememberedAuth();
            // Stamp "just logged in" so the idle hook doesn't immediately
            // fire on a stale cross-tab cdx_last_activity timestamp.
            try {
              localStorage.setItem("cdx_last_activity", String(Date.now()));
            } catch { /* storage unavailable; in-memory timer still works */ }
            setAuthed(true);
          }}
        />
      </main>
    );
  }

  return (
    <main className="min-h-screen relative" style={{ background: INK }}>
      <GrainOverlay />
      {idleWarning ? (
        <div
          role="status"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 400,
            background: "rgba(251,243,212,0.95)",
            color: "#1D1D1F",
            padding: "0.65rem 1rem",
            textAlign: "center",
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            letterSpacing: "0.06em",
          }}
        >
          {idleWarning}
        </div>
      ) : null}
      <div className="relative z-10">
        <header
          className="border-b"
          style={{
            borderColor: "rgba(251,243,212,0.18)",
            padding:
              "1rem clamp(1rem, 4vw, 1.5rem) 1rem calc(clamp(1rem, 4vw, 1.5rem) + env(safe-area-inset-left))",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.9rem",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.9rem",
                minWidth: 0,
                flex: "1 1 auto",
              }}
            >
              <HamburgerButton
                open={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              />
              <Link
                href="/admin/overview"
                className="block"
                style={{ minWidth: 0, textDecoration: "none" }}
              >
                <h1
                  className="uppercase"
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontWeight: 300,
                    color: CREAM,
                    fontSize: "clamp(1.1rem, 3.4vw, 1.6rem)",
                    letterSpacing: "0.2em",
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  Cadieux Admin
                </h1>
              </Link>
            </div>
          </div>
        </header>

        <section
          style={{
            padding:
              "2rem clamp(1rem, 4vw, 1.5rem) 4rem calc(clamp(1rem, 4vw, 1.5rem) + env(safe-area-inset-left))",
          }}
        >
          <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
            <div style={{ minWidth: 0 }}>
              <h2
                className="uppercase"
                style={{
                  fontFamily: "var(--font-heading)",
                  fontWeight: 300,
                  color: CREAM,
                  fontSize: "clamp(1.5rem, 5vw, 2.4rem)",
                  letterSpacing: "0.18em",
                  lineHeight: 1.05,
                  wordBreak: "break-word",
                }}
              >
                {title}
              </h2>
              {subtitle ? (
                <p
                  className="mt-1 uppercase"
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "0.875rem",
                    letterSpacing: "0.2em",
                    color: "rgba(251,243,212,0.55)",
                    wordBreak: "break-word",
                  }}
                >
                  {subtitle}
                </p>
              ) : null}
            </div>
            {actions ? (
              <div className="flex flex-wrap gap-2">{actions}</div>
            ) : null}
          </div>

          {children}
        </section>
      </div>

      <AdminDrawer
        open={menuOpen}
        pathname={pathname}
        onClose={() => setMenuOpen(false)}
        onSignOut={() => {
          // Server cookie + local UX flag both need clearing.
          void fetch("/api/admin/logout", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
          }).catch(() => {});
          clearRememberedAuth();
          setAuthed(false);
          setMenuOpen(false);
        }}
      />
    </main>
  );
}

function HamburgerButton({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? "Close admin menu" : "Open admin menu"}
      aria-expanded={open}
      style={{
        background: "transparent",
        border: "1px solid rgba(251,243,212,0.35)",
        cursor: "pointer",
        padding: "0.55rem 0.7rem",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        flexShrink: 0,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            display: "block",
            width: 22,
            height: 1.5,
            background: CREAM,
            transition: "background 0.2s",
          }}
        />
      ))}
    </button>
  );
}

function AdminDrawer({
  open,
  pathname,
  onClose,
  onSignOut,
}: {
  open: boolean;
  pathname: string | null;
  onClose: () => void;
  onSignOut: () => void;
}) {
  return (
    <>
      {open ? (
        <div
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 304,
            background: "rgba(29,29,31,0.6)",
          }}
        />
      ) : null}

      {/* Outer slide wrapper: ONLY carries position + transform. The
          flex layout lives on the inner div so the transform doesn't
          interfere with iOS Safari's flex+overflow sizing (a known
          quirk that left the SYSTEM section unreachable even with
          minHeight:0 set on the nav). `bottom: 0` is a defensive
          fallback in case `100dvh` resolves to 0 (very old browsers). */}
      <aside
        aria-hidden={!open}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 305,
          width: "min(280px, 88vw)",
          height: "100dvh",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.32s cubic-bezier(0.22,1,0.36,1)",
          boxShadow: open ? "0 20px 40px -10px rgba(29,29,31,0.5)" : "none",
        }}
      >
        <div
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            background: INK,
            borderRight: `1px solid ${BORDER}`,
            // Strictly contain the children so the scrollable nav
            // can never push past the drawer bounds even if a child
            // miscomputes its intrinsic size.
            overflow: "hidden",
          }}
        >
        {/* Top: wordmark + sign-out — `flexShrink: 0` keeps this header
            at full height while the nav body below scrolls. */}
        <div
          style={{
            flexShrink: 0,
            padding:
              "calc(1.25rem + env(safe-area-inset-top)) 1.25rem 1rem calc(1.25rem + env(safe-area-inset-left))",
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: "0.5em",
              textTransform: "uppercase",
              color: "rgba(251,243,212,0.65)",
            }}
          >
            Cadieux Admin
          </p>
          <button
            type="button"
            onClick={onSignOut}
            className="uppercase"
            style={{
              marginTop: "0.85rem",
              fontFamily: "var(--font-body)",
              fontSize: "0.875rem",
              letterSpacing: "0.28em",
              color: TEXT_FADED,
              border: `1px solid rgba(251,243,212,0.3)`,
              padding: "0.4rem 0.85rem",
              background: "transparent",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            Sign out
          </button>
        </div>

        {/* Scrollable nav body. Explicit `flexBasis: 0` (unitless, not
            `0%`) avoids a long-standing Safari quirk where `flex: 1`
            shorthand sized column flex children off their content
            instead of the remaining track, pushing SYSTEM off-screen.
            `minHeight: 0` is what actually lets the child shrink to
            its allocated track and trigger overflow. */}
        <nav
          aria-label="Admin sections"
          data-lenis-prevent
          style={{
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: 0,
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
            padding:
              "0.75rem 0.75rem calc(1.25rem + env(safe-area-inset-bottom)) calc(0.75rem + env(safe-area-inset-left))",
          }}
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.label} style={{ marginTop: "1.25rem" }}>
              <p
                style={{
                  margin: "0 0 0.5rem",
                  padding: "0 0.5rem",
                  fontFamily: "var(--font-body)",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  letterSpacing: "0.32em",
                  textTransform: "uppercase",
                  color: "rgba(251,243,212,0.55)",
                }}
              >
                {group.label}
              </p>
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                }}
              >
                {group.items.map((item) => {
                  const active =
                    pathname === item.href ||
                    pathname?.startsWith(item.href + "/") ||
                    false;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        style={{
                          display: "block",
                          padding: "0.65rem 0.75rem",
                          fontFamily: "var(--font-heading)",
                          fontSize: "1rem",
                          fontWeight: 300,
                          letterSpacing: "0.04em",
                          color: active ? CREAM : "rgba(251,243,212,0.7)",
                          background: active
                            ? "rgba(251,243,212,0.12)"
                            : "transparent",
                          borderLeft: `2px solid ${active ? CREAM : "transparent"}`,
                          textDecoration: "none",
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        </div>
      </aside>
    </>
  );
}

function GrainOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 opacity-[0.08] mix-blend-overlay"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.6'/></svg>\")",
      }}
    />
  );
}

function PasswordGate({ onSuccess }: { onSuccess: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      // `credentials: "include"` (not "same-origin") so the Set-Cookie
      // is honoured even when the host redirects apex -> www mid-POST.
      // The cookie is scoped to `.cadieux.in` server-side so it then
      // applies on whichever host the page is loaded from.
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ password: value }),
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
      });

      let data: { ok?: boolean; error?: string; token?: string } | null = null;
      try {
        data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          token?: string;
        };
      } catch {
        // Non-JSON response (e.g. an HTML redirect page) — handled below.
        data = null;
      }

      if (res.ok && data?.ok) {
        // Persist the bearer token so admin requests authenticate via the
        // Authorization header (Safari ITP drops the cookie). Older servers
        // that only set the cookie won't return a token — that's fine, the
        // cookie path still applies there.
        if (data.token) setAdminToken(data.token);
        // Release any admin requests that mounted (and paused) before login.
        notifyAdminAuthChange();
        onSuccess();
        return;
      }

      // Always surface something — never silently clear the field.
      if (res.status === 429) {
        setError(
          data?.error ||
            "Too many attempts. Please wait a minute and try again.",
        );
      } else if (res.status === 401) {
        setError("Incorrect password");
      } else if (res.redirected || !data) {
        setError(
          "Login could not complete — please open https://www.cadieux.in/admin (with “www”) and try again.",
        );
      } else {
        setError(data.error || `Login failed (status ${res.status}).`);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative z-10 min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-4">
        <h1
          className="text-center uppercase"
          style={{
            fontFamily: "var(--font-heading)",
            color: "#FBF3D4",
            fontWeight: 300,
            fontSize: "clamp(2.75rem, 7vw, 4.5rem)",
            letterSpacing: "0.2em",
            lineHeight: 1,
          }}
        >
          Cadieux Admin
        </h1>
        {/* Hidden username field — gives the browser password manager a
            stable identity to associate the saved admin password with, so
            "save password" + autofill work (a lone password field is often
            ignored by managers). Off-screen, not display:none, so it stays
            in the autofill flow without being interactive. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value="admin"
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", border: 0 }}
        />
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            name="password"
            id="admin-password"
            autoComplete="current-password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Password"
            className="w-full px-4 py-3 pr-12 bg-transparent outline-none"
            style={{
              border: "1px solid rgba(251,243,212,0.35)",
              color: "#FBF3D4",
              fontFamily: "var(--font-body)",
              letterSpacing: "0.1em",
              fontSize: "1rem",
            }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
            className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity"
            style={{ color: showPassword ? "#FBF3D4" : "rgba(251, 243, 212, 0.45)" }}
          >
            {showPassword ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        </div>
        <button
          type="submit"
          className="w-full px-4 py-3 uppercase"
          style={{
            border: "1px solid #FBF3D4",
            color: "#FBF3D4",
            fontFamily: "var(--font-body)",
            letterSpacing: "0.25em",
            fontSize: "0.875rem",
            background: "transparent",
          }}
        >
          Enter
        </button>
        {error && (
          <p
            className="text-center text-sm"
            style={{
              color: "#EF4444",
              fontFamily: "var(--font-body)",
              letterSpacing: "0.1em",
            }}
          >
            {error}
          </p>
        )}
        {/* Discreet recovery hint for the owner. Deliberately vague —
            this gate is publicly reachable, so it must NOT reference
            the underlying credential store or hosting provider. */}
        <p
          className="text-center"
          style={{
            marginTop: "0.25rem",
            color: "rgba(251, 243, 212, 0.35)",
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          Locked out? Contact your administrator.
        </p>
      </form>
    </div>
  );
}
