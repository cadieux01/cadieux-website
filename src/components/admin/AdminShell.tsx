"use client";

// Shared shell for the new admin pages — handles the password gate
// (sessionStorage-backed, identical to src/app/admin/page.tsx) and
// renders the top-bar nav so every new page has the same look.
//
// The existing /admin page does NOT use this — we leave it alone.
// New pages (/admin/orders, /admin/customers, etc.) wrap their body
// in <AdminShell title="…">.

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
  // Back-compat: if the old sessionStorage flag is still set, treat
  // the user as authed and upgrade them to the new localStorage record
  // immediately so they don't get bounced to the password gate.
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
      // Expired — clean up.
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

const NAV: { href: string; label: string }[] = [
  { href: "/admin/overview", label: "Overview" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/subscriptions", label: "Subscriptions" },
  { href: "/admin/change-requests", label: "Change Requests" },
  { href: "/admin/feedback", label: "Feedback" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/audit-log", label: "Audit Log" },
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
  const pathname = usePathname();

  useEffect(() => {
    if (readRememberedAuth()) setAuthed(true);
    setChecking(false);
  }, []);

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
          className="px-6 py-5 border-b"
          style={{ borderColor: "rgba(245,158,11,0.18)" }}
        >
          <div className="flex items-center justify-between flex-wrap gap-3">
            <Link href="/admin/overview" className="block">
              <h1
                className="uppercase"
                style={{
                  fontFamily: "var(--font-heading)",
                  fontWeight: 300,
                  color: "#fbf3d4",
                  fontSize: "1.6rem",
                  letterSpacing: "0.2em",
                  lineHeight: 1,
                }}
              >
                Cadieux Admin
              </h1>
            </Link>
            <button
              type="button"
              onClick={() => {
                clearRememberedAuth();
                setAuthed(false);
              }}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.7rem",
                letterSpacing: "0.25em",
                color: "rgba(192,200,206,0.6)",
                border: "1px solid rgba(245,158,11,0.3)",
                padding: "0.4rem 0.9rem",
                background: "transparent",
              }}
            >
              Sign out
            </button>
          </div>

          {/*
            Mobile-responsive nav. On phones the row is horizontally
            scrollable (snap-to-link) so a wider list of tabs never gets
            cut off; from md upward it wraps naturally. The hidden
            scrollbar keeps the dark-walnut aesthetic intact — the
            visible cue is the gold underline on the active link.
          */}
          <nav
            className="mt-4 flex flex-nowrap md:flex-wrap gap-x-5 gap-y-2 overflow-x-auto md:overflow-visible -mx-6 px-6 md:mx-0 md:px-0 admin-nav-scroller"
            style={{ scrollSnapType: "x mandatory" }}
            aria-label="Admin sections"
          >
            {NAV.map((item) => {
              const active =
                pathname === item.href || pathname?.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="uppercase whitespace-nowrap"
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "0.7rem",
                    letterSpacing: "0.25em",
                    color: active ? "#fbf3d4" : "rgba(245,158,11,0.7)",
                    paddingBottom: "2px",
                    borderBottom: active
                      ? "1px solid #f59e0b"
                      : "1px solid transparent",
                    scrollSnapAlign: "start",
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <style jsx>{`
            .admin-nav-scroller::-webkit-scrollbar {
              display: none;
            }
            .admin-nav-scroller {
              scrollbar-width: none;
              -ms-overflow-style: none;
            }
          `}</style>
        </header>

        <section className="px-6 py-8">
          <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
            <div>
              <h2
                className="uppercase"
                style={{
                  fontFamily: "var(--font-heading)",
                  fontWeight: 300,
                  color: "#fbf3d4",
                  fontSize: "clamp(1.6rem, 3vw, 2.4rem)",
                  letterSpacing: "0.18em",
                  lineHeight: 1.05,
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
                  }}
                >
                  {subtitle}
                </p>
              ) : null}
            </div>
            {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
          </div>

          {children}
        </section>
      </div>
    </main>
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
