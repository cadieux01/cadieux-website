"use client";

// /mkt/login — Supabase Auth sign-in for the marketing workspace.
//
// This replaces the admin PasswordGate ON /mkt ONLY. /admin keeps its
// own PasswordGate (shared HMAC token); the two surfaces are now two
// separate credential systems and that is deliberate: /mkt attributes
// actions to the human via auth.uid(), /admin does not.
//
// A ?denied=<reason> query string surfaces the reason this screen was
// shown — "your profile is inactive", "no profile record", or an admin
// gate on a downstream page.

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { MKT } from "@/components/mkt/theme";
import { mktBrowserClient } from "@/lib/mkt-auth-browser";

export default function MktLogin() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const router = useRouter();
  const search = useSearchParams();
  const denied = search.get("denied");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const sb = mktBrowserClient();
      const { error } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setErr(error.message);
        return;
      }
      // Server-side gate now has the cookie — let the layout run
      // readMktSession() against it.
      router.replace("/mkt");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async () => {
    setErr(null);
    setResetSent(false);
    try {
      const sb = mktBrowserClient();
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/mkt/login`,
      });
      if (error) setErr(error.message);
      else setResetSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Reset failed");
    }
  };

  const deniedMessage = denied ? messageFor(denied) : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: MKT.cream,
        color: MKT.ink,
        fontFamily: "var(--font-body)",
        display: "grid",
        placeItems: "center",
        padding: "2rem 1rem",
      }}
    >
      <form
        onSubmit={signIn}
        style={{
          background: "#FFFFFF",
          border: `1px solid ${MKT.ash}`,
          borderRadius: 10,
          padding: "1.4rem 1.4rem 1.2rem",
          maxWidth: 380,
          width: "100%",
          boxShadow: MKT.cardShadow,
          display: "grid",
          gap: "0.8rem",
        }}
      >
        <h1
          style={{
            margin: 0,
            color: MKT.green,
            fontSize: "1.3rem",
            fontWeight: 700,
          }}
        >
          Sign in to Marketing
        </h1>
        <p style={{ margin: 0, color: MKT.mute, fontSize: "0.9rem" }}>
          Use your Cadieux email and password.
        </p>

        {deniedMessage ? (
          <div
            role="alert"
            style={{
              border: `1px solid ${MKT.error}`,
              background: MKT.errorBg,
              padding: "0.6rem 0.8rem",
              color: MKT.error,
              borderRadius: 6,
              fontSize: "0.9rem",
            }}
          >
            {deniedMessage}
          </div>
        ) : null}

        <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.86rem" }}>
          <span style={{ color: MKT.mute }}>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.86rem" }}>
          <span style={{ color: MKT.mute }}>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </label>

        {err ? (
          <p role="alert" style={{ margin: 0, color: MKT.error, fontSize: "0.88rem" }}>
            {err}
          </p>
        ) : null}

        {resetSent ? (
          <p role="status" style={{ margin: 0, color: MKT.green, fontSize: "0.88rem" }}>
            Check your email for a reset link.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || !email || !password}
          style={{
            background: MKT.green,
            color: MKT.cream,
            border: "none",
            padding: "0.75rem 0.9rem",
            fontWeight: 600,
            borderRadius: 6,
            fontSize: "1rem",
            cursor: busy ? "wait" : "pointer",
            opacity: busy || !email || !password ? 0.7 : 1,
            marginTop: "0.2rem",
            minHeight: 44,
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <button
          type="button"
          onClick={sendReset}
          disabled={!email}
          style={{
            background: "transparent",
            color: MKT.blue,
            border: "none",
            // iOS tap-target minimum is 44px. A plain link-like
            // button needs real padding to reach it; the text alone
            // reads as ~21px tall and a fat-finger tap lands between
            // it and the Sign-in button above.
            padding: "0.7rem 0.1rem",
            textAlign: "left",
            fontSize: "0.95rem",
            cursor: email ? "pointer" : "not-allowed",
            minHeight: 44,
          }}
        >
          Forgot your password?
        </button>
      </form>
    </div>
  );
}

function messageFor(code: string): string {
  switch (code) {
    case "no-profile":
      return "Signed in, but no Marketing profile is linked to this email. Ask an admin to add you.";
    case "inactive":
    case "deactivated":
    case "deleted":
      return "This account is not active. Ask an admin to reactivate it.";
    case "admin":
      return "That screen is admin-only.";
    default:
      return `Access refused: ${code}`;
  }
}

// fontSize: 16px (1rem) is the iOS line — anything smaller forces
// Safari to zoom the page on focus to hit its ~16px minimum reading
// size, which is then stuck zoomed when the keyboard dismisses.
// Measured on iPhone 14: 0.98rem (15.68px) triggered the zoom; 1rem
// did not. Leave this at 1rem minimum on EVERY input in the mkt
// tree; the scoped CSS in MktShell applies the same rule to inputs
// inside the gate.
const inputStyle: React.CSSProperties = {
  border: `1px solid ${MKT.ash}`,
  borderRadius: 6,
  padding: "0.7rem 0.8rem",
  fontSize: "1rem",
  background: "#FFFFFF",
  color: MKT.ink,
  minHeight: 44,
};
