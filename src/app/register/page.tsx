"use client";

// Team-PIN-gated shareable link to the Register-new-order form.
//
// Sunny shares cadieux.in/register with team members. A member types
// the 6-digit TEAM_ORDER_PIN, receives a 7-day signed token, and can
// then fill in orders on behalf of walk-in / phone customers.
//
// The PIN unlocks ONLY four endpoints (POST /api/admin/orders, POST
// /api/admin/subscriptions/create, GET /api/admin/customers, GET
// /api/admin/products) — every other admin surface still requires
// the full admin password. See src/lib/admin-auth.ts for the
// verifyAdminOrTeamOrder gate.
//
// This page deliberately does NOT render AdminShell (which is the
// full-fat admin nav + logout). The team link is scoped to order
// entry only.

import { useCallback, useEffect, useState } from "react";

import { RegisterOrderForm } from "@/components/RegisterOrderForm";
import {
  clearTeamOrderToken,
  setTeamOrderToken,
  teamOrderTokenValid,
} from "@/lib/team-order-client";

export default function TeamRegisterPage() {
  // Track auth state with a rev counter so unlock + logout both trigger
  // a re-check. Start null → checking so we don't flash the PIN gate at
  // a member who already has a valid token in localStorage.
  const [authed, setAuthed] = useState<boolean | null>(null);

  const recheck = useCallback(() => {
    setAuthed(teamOrderTokenValid());
  }, []);

  useEffect(() => {
    recheck();
    // The team-order client dispatches this event on any 401 so we
    // drop back to the PIN gate immediately instead of leaving the
    // operator on a form that will fail on submit.
    const onLogout = () => setAuthed(false);
    window.addEventListener("team-order-auth-logout", onLogout);
    return () => window.removeEventListener("team-order-auth-logout", onLogout);
  }, [recheck]);

  const onUnlock = useCallback(() => {
    recheck();
  }, [recheck]);

  const onSignOut = useCallback(() => {
    clearTeamOrderToken();
    setAuthed(false);
  }, []);

  if (authed === null) {
    // First-paint loading: nothing to show. Keeps the PIN gate from
    // flashing at a member who already unlocked earlier.
    return <div style={pageWrap} />;
  }

  if (!authed) {
    return (
      <div style={pageWrap}>
        <TeamPinGate onUnlock={onUnlock} />
      </div>
    );
  }

  return (
    <div style={pageWrap}>
      <header style={headerRow}>
        <div>
          <h1 style={brandMark}>CADIEUX</h1>
          <p style={brandSub}>Team order entry</p>
        </div>
        <button
          type="button"
          style={signOutChip}
          onClick={onSignOut}
          className="uppercase"
        >
          Sign out
        </button>
      </header>
      <RegisterOrderForm authMode="team_order" />
    </div>
  );
}

// ── PIN gate ─────────────────────────────────────────────────────────
function TeamPinGate({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setError(null);
    if (pin.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/team-order/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pin }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        token?: string;
        error?: string;
      };
      if (!res.ok || !j.ok || !j.token) {
        setError(j.error ?? "Incorrect PIN");
        return;
      }
      setTeamOrderToken(j.token);
      onUnlock();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in");
    } finally {
      setBusy(false);
    }
  }, [pin, onUnlock]);

  return (
    <div style={gateWrap}>
      <div style={gateCard}>
        <h1 style={brandMark}>CADIEUX</h1>
        <p style={brandSub}>Team order entry</p>
        <p style={gateHelp}>
          Enter the shared team PIN to open the order form.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          <input
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Team PIN"
            style={gateInput}
            autoFocus
          />
          {error && <div style={gateError}>{error}</div>}
          <button
            type="submit"
            disabled={busy || pin.length === 0}
            style={{
              ...gateButton,
              opacity: busy || pin.length === 0 ? 0.5 : 1,
            }}
            className="uppercase"
          >
            {busy ? "Signing in…" : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── styles ───────────────────────────────────────────────────────────
const CREAM = "#FBF3D4";
const CREAM_MUTED = "rgba(251,243,212,0.72)";
const GREEN = "#024628";
const GREEN_INPUT = "#012d1a";

const pageWrap: React.CSSProperties = {
  minHeight: "100vh",
  background: GREEN,
  color: CREAM,
  padding: "clamp(1rem, 4vw, 1.5rem)",
  fontFamily: "var(--font-body)",
};

const headerRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-end",
  maxWidth: 640,
  margin: "0 auto 1rem",
  flexWrap: "wrap",
  gap: "0.75rem",
};

const brandMark: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-display, var(--font-body))",
  letterSpacing: "0.28em",
  fontSize: "1rem",
  color: CREAM,
};

const brandSub: React.CSSProperties = {
  margin: "0.25rem 0 0",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: CREAM_MUTED,
};

const signOutChip: React.CSSProperties = {
  padding: "0.4rem 0.9rem",
  border: `1px solid rgba(251,243,212,0.35)`,
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  background: "transparent",
  color: CREAM_MUTED,
  cursor: "pointer",
};

const gateWrap: React.CSSProperties = {
  minHeight: "70vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "2rem 1rem",
};

const gateCard: React.CSSProperties = {
  maxWidth: 380,
  width: "100%",
  padding: "1.75rem",
  border: `1px solid rgba(251,243,212,0.35)`,
  background: "rgba(251,243,212,0.04)",
  borderRadius: 8,
  color: CREAM,
};

const gateHelp: React.CSSProperties = {
  fontSize: "1rem",
  color: CREAM_MUTED,
  margin: "1rem 0 1.25rem",
  lineHeight: 1.5,
};

const gateInput: React.CSSProperties = {
  padding: "0.65rem 0.8rem",
  background: GREEN_INPUT,
  color: CREAM,
  border: `1px solid ${CREAM}`,
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
  borderRadius: 4,
  outline: "none",
  letterSpacing: "0.3em",
  textAlign: "center",
};

const gateButton: React.CSSProperties = {
  padding: "0.65rem 1rem",
  border: `1px solid ${CREAM}`,
  background: CREAM,
  color: GREEN,
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.24em",
  cursor: "pointer",
  fontWeight: 600,
  borderRadius: 4,
};

const gateError: React.CSSProperties = {
  padding: "0.5rem 0.7rem",
  border: "1px solid rgba(239,68,68,0.6)",
  background: "rgba(239,68,68,0.15)",
  color: "rgba(254,226,226,0.98)",
  fontSize: "1rem",
  borderRadius: 4,
};
