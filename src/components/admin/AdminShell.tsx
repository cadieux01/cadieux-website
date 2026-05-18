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
// (dark walnut + gold accents) while staying visually distinct so the
// operator never confuses the two surfaces.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FormEvent, ReactNode, useEffect, useState } from "react";

import { ADMIN_PASSWORD, ADMIN_SESSION_KEY } from "@/lib/admin-shared";

// 30-day remember-me. We persist `{ expiresAt: <epoch-ms> }` in
// localStorage so the operator only logs in once a month. The previous
// sessionStorage flag is migrated transparently on first load.
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

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
      { href: "/admin/delivery-requests", label: "Delivery Requests" },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/admin/products", label: "Products" },
      { href: "/admin/service-areas", label: "Service Areas" },
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
    items: [{ href: "/admin/audit-log", label: "Audit Log" }],
  },
];

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const DARK_GREEN = "#024628";
const FADED = "rgba(192,200,206,0.6)";
const NAV_BG = "#0a0a0a";

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
  const pathname = usePathname();

  useEffect(() => {
    if (readRememberedAuth()) setAuthed(true);
    setChecking(false);
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
      <main className="min-h-screen relative" style={{ background: "rgb(6,4,2)" }}>
        <GrainOverlay />
        <PasswordGate
          onSuccess={() => {
            writeRememberedAuth();
            setAuthed(true);
          }}
        />
      </main>
    );
  }

  return (
    <main className="min-h-screen relative" style={{ background: "rgb(6,4,2)" }}>
      <GrainOverlay />
      <div className="relative z-10">
        <header
          className="border-b"
          style={{
            borderColor: "rgba(245,158,11,0.18)",
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
                    fontSize: "0.7rem",
                    letterSpacing: "0.2em",
                    color: "rgba(192,200,206,0.55)",
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
        border: "1px solid rgba(245,158,11,0.35)",
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
            background: open ? CREAM : GOLD,
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
            background: "rgba(0,0,0,0.6)",
          }}
        />
      ) : null}

      <aside
        aria-hidden={!open}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          zIndex: 305,
          width: "min(280px, 88vw)",
          height: "100dvh",
          background: NAV_BG,
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.32s cubic-bezier(0.22,1,0.36,1)",
          display: "flex",
          flexDirection: "column",
          borderRight: `1px solid ${DARK_GREEN}`,
          boxShadow: open ? "0 20px 40px -10px rgba(0,0,0,0.5)" : "none",
        }}
      >
        {/* Top: wordmark + sign-out */}
        <div
          style={{
            padding:
              "calc(1.25rem + env(safe-area-inset-top)) 1.25rem 1rem calc(1.25rem + env(safe-area-inset-left))",
            borderBottom: `1px solid ${DARK_GREEN}`,
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-body)",
              fontSize: 10,
              fontWeight: 300,
              letterSpacing: "0.5em",
              textTransform: "uppercase",
              color: "rgba(200,144,58,0.65)",
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
              fontSize: "0.62rem",
              letterSpacing: "0.28em",
              color: FADED,
              border: `1px solid rgba(245,158,11,0.3)`,
              padding: "0.4rem 0.85rem",
              background: "transparent",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            Sign out
          </button>
        </div>

        {/* Scrollable nav body */}
        <nav
          aria-label="Admin sections"
          style={{
            flex: 1,
            overflowY: "auto",
            overscrollBehavior: "contain",
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
                  fontSize: "0.55rem",
                  fontWeight: 400,
                  letterSpacing: "0.32em",
                  textTransform: "uppercase",
                  color: "rgba(200,144,58,0.55)",
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
                          fontSize: "0.95rem",
                          fontWeight: 300,
                          letterSpacing: "0.04em",
                          color: active ? CREAM : "rgba(251,243,212,0.7)",
                          background: active
                            ? "rgba(245,158,11,0.12)"
                            : "transparent",
                          borderLeft: `2px solid ${active ? GOLD : "transparent"}`,
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value === ADMIN_PASSWORD) {
      setError("");
      onSuccess();
    } else {
      setError("Incorrect password");
    }
  };

  return (
    <div className="relative z-10 min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-4">
        <h1
          className="text-center uppercase"
          style={{
            fontFamily: "var(--font-heading)",
            color: "#fbf3d4",
            fontWeight: 300,
            fontSize: "clamp(2.75rem, 7vw, 4.5rem)",
            letterSpacing: "0.2em",
            lineHeight: 1,
          }}
        >
          Cadieux Admin
        </h1>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Password"
          className="w-full px-4 py-3 bg-transparent outline-none"
          style={{
            border: "1px solid rgba(245, 158, 11, 0.35)",
            color: "#fbf3d4",
            fontFamily: "var(--font-body)",
            letterSpacing: "0.1em",
            fontSize: "0.9rem",
          }}
        />
        <button
          type="submit"
          className="w-full px-4 py-3 uppercase"
          style={{
            border: "1px solid #f59e0b",
            color: "#f59e0b",
            fontFamily: "var(--font-body)",
            letterSpacing: "0.25em",
            fontSize: "0.75rem",
            background: "transparent",
          }}
        >
          Enter
        </button>
        {error && (
          <p
            className="text-center text-sm"
            style={{
              color: "#ef4444",
              fontFamily: "var(--font-body)",
              letterSpacing: "0.1em",
            }}
          >
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
