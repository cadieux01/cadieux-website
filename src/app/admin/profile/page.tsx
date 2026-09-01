"use client";

// Super-admin Profile page — /admin/profile
//
// Surfaces PIN management (Generate / Set / Forgot PIN) for the
// website admin. PIN is stored as a scrypt hash server-side;
// plaintext never persists anywhere. The security-question answer
// is validated server-side in the API route so it cannot be bypassed
// by reading client JS.

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";

// ─── shared design tokens (match AdminShell) ─────────────────────────────────
const CREAM = "#FBF3D4";
const FADED = "rgba(251,243,212,0.6)";
const MUTED = "rgba(251,243,212,0.4)";

const CARD: React.CSSProperties = {
  border: "1px solid rgba(251,243,212,0.18)",
  borderRadius: 2,
  padding: "1.5rem",
  background: "rgba(251,243,212,0.02)",
  marginBottom: "1.25rem",
};
const INPUT: React.CSSProperties = {
  display: "block",
  width: "100%",
  background: "transparent",
  border: "1px solid rgba(251,243,212,0.3)",
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
  letterSpacing: "0.25em",
  padding: "0.65rem 0.9rem",
  outline: "none",
  borderRadius: 0,
};
const BTN_PRIMARY: React.CSSProperties = {
  border: `1px solid ${CREAM}`,
  color: CREAM,
  background: "transparent",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase" as const,
  padding: "0.65rem 1.4rem",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};
const BTN_GHOST: React.CSSProperties = {
  border: "1px solid rgba(251,243,212,0.25)",
  color: FADED,
  background: "transparent",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase" as const,
  padding: "0.65rem 1.4rem",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};
const LABEL: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.28em",
  textTransform: "uppercase" as const,
  color: MUTED,
  marginBottom: "0.45rem",
};
const ERROR_STYLE: React.CSSProperties = {
  color: "#EF4444",
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
  letterSpacing: "0.06em",
  marginTop: "0.5rem",
};
const SUCCESS_STYLE: React.CSSProperties = {
  color: "#FBF3D4",
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
  letterSpacing: "0.06em",
  marginTop: "0.5rem",
};
const SECTION_TITLE: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontWeight: 300,
  color: CREAM,
  fontSize: "1rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
  marginBottom: "1rem",
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function PinInput({
  value,
  onChange,
  placeholder = "6-digit PIN",
  id,
  autoFocus,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  return (
    <input
      id={id}
      type="password"
      inputMode="numeric"
      maxLength={6}
      autoFocus={autoFocus}
      autoComplete={autoComplete ?? "off"}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      placeholder={placeholder}
      style={INPUT}
    />
  );
}

function errMsg(err: unknown): string {
  if (err instanceof AdminFetchError) return err.message;
  return "Network error. Please try again.";
}

// ─── status type ─────────────────────────────────────────────────────────────

type PinStatus = { exists: boolean; locked: boolean; lockedUntil: string | null };

// ─── Generate PIN panel ───────────────────────────────────────────────────────

function GeneratePanel({ onSuccess }: { onSuccess: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await adminFetch<{ ok: boolean; pin: string }>("/api/admin/pin", {
        method: "POST",
        body: JSON.stringify({ action: "generate" }),
      });
      setRevealed(data.pin);
      onSuccess();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  };

  if (revealed) {
    return (
      <div>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            color: FADED,
            letterSpacing: "0.06em",
            marginBottom: "1rem",
            lineHeight: 1.6,
          }}
        >
          Your PIN has been generated.{" "}
          <strong style={{ color: CREAM }}>Save it now</strong> — it will not be shown again.
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "2rem",
              letterSpacing: "0.4em",
              color: CREAM,
              fontWeight: 300,
            }}
          >
            {revealed}
          </span>
          <button style={BTN_GHOST} onClick={handleCopy}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p style={{ ...ERROR_STYLE, color: MUTED, marginTop: "0.75rem" }}>
          This PIN is now active. Note it down before closing.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "1rem",
          color: FADED,
          letterSpacing: "0.06em",
          marginBottom: "1.25rem",
          lineHeight: 1.6,
        }}
      >
        Generate a random 6-digit PIN. It will be shown{" "}
        <strong style={{ color: CREAM }}>once</strong> — save it before closing.
      </p>
      {error && <p style={ERROR_STYLE}>{error}</p>}
      <button style={BTN_PRIMARY} onClick={handleGenerate} disabled={busy}>
        {busy ? "Generating…" : "Generate PIN"}
      </button>
    </div>
  );
}

// ─── Set PIN panel ────────────────────────────────────────────────────────────

function SetPinPanel({
  pinExists,
  onSuccess,
}: {
  pinExists: boolean;
  onSuccess: () => void;
}) {
  const [newPin, setNewPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (newPin.length !== 6) { setError("PIN must be exactly 6 digits."); return; }
    if (pinExists && currentPin.length !== 6) { setError("Current PIN must be exactly 6 digits."); return; }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await adminFetch<{ ok: boolean }>("/api/admin/pin", {
        method: "POST",
        body: JSON.stringify({
          action: "set",
          pin: newPin,
          ...(pinExists ? { currentPin } : {}),
        }),
      });
      setSuccess(pinExists ? "PIN changed successfully." : "PIN set successfully.");
      setNewPin("");
      setCurrentPin("");
      onSuccess();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <p
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "1rem",
          color: FADED,
          letterSpacing: "0.06em",
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        {pinExists
          ? "Change your current PIN. You must enter the current PIN first."
          : "Choose a 6-digit PIN of your own."}
      </p>

      {pinExists && (
        <div>
          <label style={LABEL} htmlFor="current-pin">Current PIN</label>
          <PinInput
            id="current-pin"
            value={currentPin}
            onChange={setCurrentPin}
            placeholder="Current PIN"
            autoComplete="current-password"
          />
        </div>
      )}

      <div>
        <label style={LABEL} htmlFor="new-pin">New PIN</label>
        <PinInput
          id="new-pin"
          value={newPin}
          onChange={setNewPin}
          placeholder="New 6-digit PIN"
          autoComplete="new-password"
        />
      </div>

      {error && <p style={ERROR_STYLE}>{error}</p>}
      {success && <p style={SUCCESS_STYLE}>{success}</p>}

      <div>
        <button type="submit" style={BTN_PRIMARY} disabled={busy}>
          {busy ? "Saving…" : pinExists ? "Change PIN" : "Set PIN"}
        </button>
      </div>
    </form>
  );
}

// ─── Forgot PIN panel ─────────────────────────────────────────────────────────

function ForgotPinPanel({ onSuccess }: { onSuccess: () => void }) {
  const [answer, setAnswer] = useState("");
  const [newPin, setNewPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!answer.trim()) { setError("Please answer the security question."); return; }
    if (newPin.length !== 6) { setError("New PIN must be exactly 6 digits."); return; }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await adminFetch<{ ok: boolean }>("/api/admin/pin", {
        method: "POST",
        body: JSON.stringify({ action: "reset", answer: answer.trim(), newPin }),
      });
      setSuccess("PIN reset successfully.");
      setAnswer("");
      setNewPin("");
      onSuccess();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <p
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "1rem",
          color: FADED,
          letterSpacing: "0.06em",
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        Answer the security question to reset your PIN. Wrong answers are
        rate-limited (3 attempts per IP, then 30-minute lockout).
      </p>

      <div>
        <label style={LABEL} htmlFor="security-answer">
          Security question: Who is your best friend?
        </label>
        <input
          id="security-answer"
          type="text"
          autoComplete="off"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Your answer"
          style={{ ...INPUT, letterSpacing: "0.06em" }}
        />
      </div>

      <div>
        <label style={LABEL} htmlFor="reset-new-pin">New PIN</label>
        <PinInput
          id="reset-new-pin"
          value={newPin}
          onChange={setNewPin}
          placeholder="New 6-digit PIN"
          autoComplete="new-password"
        />
      </div>

      {error && <p style={ERROR_STYLE}>{error}</p>}
      {success && <p style={SUCCESS_STYLE}>{success}</p>}

      <div>
        <button type="submit" style={BTN_PRIMARY} disabled={busy}>
          {busy ? "Resetting…" : "Reset PIN"}
        </button>
      </div>
    </form>
  );
}

// ─── Active flow ──────────────────────────────────────────────────────────────

type ActiveFlow = "none" | "generate" | "set" | "forgot";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminProfilePage() {
  const [status, setStatus] = useState<PinStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeFlow, setActiveFlow] = useState<ActiveFlow>("none");

  const fetchStatus = useCallback(async () => {
    try {
      const data = await adminFetch<PinStatus>("/api/admin/pin");
      setStatus(data);
    } catch {
      // silently ignore — page still renders without status
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleSuccess = useCallback(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const pinExists = status?.exists ?? false;
  const pinLocked = status?.locked ?? false;

  return (
    <AdminShell title="Profile" subtitle="Account & security settings">

      {/* ── Identity ── */}
      <div style={CARD}>
        <p style={SECTION_TITLE}>Identity</p>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            color: FADED,
            letterSpacing: "0.06em",
            lineHeight: 1.7,
            margin: 0,
          }}
        >
          This admin area uses a{" "}
          <strong style={{ color: CREAM }}>single shared password</strong> for access, set via
          the <code style={{ color: CREAM, fontSize: "1rem" }}>ADMIN_PASSWORD</code> environment
          variable — contact whoever manages the server to rotate it. There is no per-operator
          login ID. The security PIN below is a{" "}
          <strong style={{ color: CREAM }}>separate, additional layer</strong> you can use to
          gate sensitive operations.
        </p>
      </div>

      {/* ── PIN management ── */}
      <div style={CARD}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <p style={{ ...SECTION_TITLE, margin: 0 }}>Security PIN</p>
          {!loading && (
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.875rem",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                padding: "0.25rem 0.7rem",
                border: `1px solid ${
                  pinLocked ? "#EF4444" : pinExists ? CREAM : "rgba(251,243,212,0.4)"
                }`,
                color: pinLocked ? "#EF4444" : pinExists ? "#FBF3D4" : CREAM,
              }}
            >
              {pinLocked ? "Locked" : pinExists ? "Active" : "Not set"}
            </span>
          )}
        </div>

        {loading ? (
          <p style={{ color: MUTED, fontFamily: "var(--font-body)", fontSize: "1rem" }}>
            Loading…
          </p>
        ) : pinLocked ? (
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "1rem",
              color: "#EF4444",
              letterSpacing: "0.06em",
              lineHeight: 1.6,
            }}
          >
            This PIN is temporarily locked due to too many incorrect attempts. Use the{" "}
            <button
              style={{
                background: "none",
                border: "none",
                color: CREAM,
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                fontSize: "0.875rem",
                letterSpacing: "0.06em",
                padding: 0,
                textDecoration: "underline",
              }}
              onClick={() => setActiveFlow("forgot")}
            >
              Forgot PIN
            </button>{" "}
            flow to reset it via the security question.
          </p>
        ) : (
          <>
            {activeFlow === "none" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
                <button style={BTN_PRIMARY} onClick={() => setActiveFlow("generate")}>
                  {pinExists ? "Re-generate PIN" : "Generate PIN"}
                </button>
                <button style={BTN_GHOST} onClick={() => setActiveFlow("set")}>
                  {pinExists ? "Change PIN" : "Set PIN"}
                </button>
                <button
                  style={{ ...BTN_GHOST, color: MUTED, borderColor: "transparent" }}
                  onClick={() => setActiveFlow("forgot")}
                >
                  Forgot PIN
                </button>
              </div>
            )}

            {activeFlow !== "none" && (
              <div style={{ marginBottom: "1.25rem" }}>
                <button style={BTN_GHOST} onClick={() => setActiveFlow("none")}>
                  ← Back
                </button>
              </div>
            )}

            {activeFlow === "generate" && (
              <>
                <p style={{ ...SECTION_TITLE, fontSize: "1rem", marginBottom: "0.75rem" }}>
                  Generate a random PIN
                </p>
                <GeneratePanel onSuccess={handleSuccess} />
              </>
            )}

            {activeFlow === "set" && (
              <>
                <p style={{ ...SECTION_TITLE, fontSize: "1rem", marginBottom: "0.75rem" }}>
                  {pinExists ? "Change PIN" : "Set a PIN"}
                </p>
                <SetPinPanel
                  pinExists={pinExists}
                  onSuccess={() => { handleSuccess(); setActiveFlow("none"); }}
                />
              </>
            )}

            {activeFlow === "forgot" && (
              <>
                <p style={{ ...SECTION_TITLE, fontSize: "1rem", marginBottom: "0.75rem" }}>
                  Forgot PIN — reset via security question
                </p>
                <ForgotPinPanel
                  onSuccess={() => { handleSuccess(); setActiveFlow("none"); }}
                />
              </>
            )}
          </>
        )}
      </div>

      {/* ── Footer notes ── */}
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "1rem",
          color: MUTED,
          letterSpacing: "0.05em",
          lineHeight: 1.7,
        }}
      >
        <p style={{ margin: "0 0 0.25rem" }}>
          <strong style={{ color: "rgba(251,243,212,0.55)" }}>PIN storage:</strong> Only a
          scrypt hash is stored — the plaintext PIN is never persisted anywhere.
        </p>
        <p style={{ margin: 0 }}>
          <strong style={{ color: "rgba(251,243,212,0.55)" }}>Separate systems:</strong> This
          PIN is independent of the admin password and the logistics dashboard&apos;s PIN.
        </p>
      </div>
    </AdminShell>
  );
}
