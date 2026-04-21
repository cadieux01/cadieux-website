"use client";

import { useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

// ─── shared styles ───────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid rgba(212, 168, 87, 0.45)",
  outline: "none",
  padding: "12px 0",
  fontFamily: "var(--font-body)",
  fontWeight: 300,
  fontSize: "0.95rem",
  letterSpacing: "0.04em",
  color: "#fbf3d4",
  caretColor: "#d4a857",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--font-body)",
  fontWeight: 400,
  fontSize: "0.6rem",
  letterSpacing: "0.35em",
  textTransform: "uppercase",
  color: "rgba(192,200,206,0.55)",
  marginBottom: 6,
};

const btnStyle = (disabled: boolean): React.CSSProperties => ({
  marginTop: 8,
  width: "100%",
  fontFamily: "var(--font-body)",
  fontSize: 11,
  fontWeight: 300,
  letterSpacing: "0.4em",
  textTransform: "uppercase",
  color: "#080604",
  background: disabled ? "rgba(240,223,200,0.5)" : "#f0dfc8",
  padding: "18px 0",
  border: "none",
  cursor: disabled ? "default" : "pointer",
  transition: "background 0.2s",
});

// ─── OTP boxes ───────────────────────────────────────────────────────────────
function OtpBoxes({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const handleKey = useCallback(
    (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && !value[i] && i > 0) {
        refs.current[i - 1]?.focus();
      }
    },
    [value]
  );

  const handleChange = useCallback(
    (i: number, e: React.ChangeEvent<HTMLInputElement>) => {
      const digit = e.target.value.replace(/\D/g, "").slice(-1);
      const next = value.split("");
      next[i] = digit;
      const joined = next.join("").slice(0, 6);
      onChange(joined);
      if (digit && i < 5) refs.current[i + 1]?.focus();
    },
    [value, onChange]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
      onChange(digits);
      const focusIdx = Math.min(digits.length, 5);
      refs.current[focusIdx]?.focus();
    },
    [onChange]
  );

  return (
    <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={value[i] ?? ""}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKey(i, e)}
          onPaste={handlePaste}
          style={{
            width: 40,
            height: 52,
            background: "transparent",
            border: "none",
            borderBottom: "2px solid rgba(212,168,87,0.55)",
            outline: "none",
            textAlign: "center",
            fontFamily: "var(--font-body)",
            fontWeight: 300,
            fontSize: 24,
            letterSpacing: "0.05em",
            color: "#fbf3d4",
            caretColor: "#d4a857",
          }}
        />
      ))}
    </div>
  );
}

// ─── Phone tab ───────────────────────────────────────────────────────────────
function PhoneLogin({ onSuccess }: { onSuccess: () => void }) {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function sendOtp() {
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) {
      setMessage({ text: "Enter a valid 10-digit mobile number.", ok: false });
      return;
    }
    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithOtp({ phone: "+91" + digits });
    setLoading(false);
    if (error) {
      setMessage({ text: error.message, ok: false });
    } else {
      setStep("otp");
    }
  }

  async function verifyOtp() {
    if (otp.length !== 6) {
      setMessage({ text: "Enter the 6-digit code.", ok: false });
      return;
    }
    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.verifyOtp({
      phone: "+91" + phone.replace(/\D/g, ""),
      token: otp,
      type: "sms",
    });
    setLoading(false);
    if (error) {
      setMessage({ text: error.message, ok: false });
    } else {
      onSuccess();
    }
  }

  function reset() {
    setStep("phone");
    setOtp("");
    setMessage(null);
  }

  const amberLink: React.CSSProperties = {
    fontFamily: "var(--font-body)",
    fontWeight: 300,
    fontSize: "0.72rem",
    letterSpacing: "0.12em",
    color: "rgba(212,168,87,0.8)",
    cursor: "pointer",
    textDecoration: "underline",
    background: "none",
    border: "none",
    padding: 0,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {step === "phone" ? (
        <div>
          <label style={labelStyle}>Mobile Number</label>
          <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid rgba(212,168,87,0.45)" }}>
            <span style={{
              fontFamily: "var(--font-body)",
              fontWeight: 300,
              fontSize: "0.95rem",
              color: "rgba(192,200,206,0.6)",
              paddingBottom: 12,
              paddingTop: 12,
              marginRight: 6,
              whiteSpace: "nowrap",
            }}>
              +91
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="98765 43210"
              maxLength={10}
              autoComplete="tel-national"
              style={{ ...inputStyle, borderBottom: "none", flex: 1 }}
            />
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{
            fontFamily: "var(--font-body)",
            fontWeight: 300,
            fontSize: "0.78rem",
            letterSpacing: "0.06em",
            color: "rgba(192,200,206,0.55)",
            margin: 0,
            textAlign: "center",
          }}>
            Code sent to +91 {phone}
          </p>
          <OtpBoxes value={otp} onChange={setOtp} />
        </div>
      )}

      {message && (
        <p style={{
          fontFamily: "var(--font-body)",
          fontWeight: 300,
          fontSize: "0.8rem",
          letterSpacing: "0.02em",
          color: message.ok ? "#6fcf97" : "#eb5757",
          margin: 0,
          lineHeight: 1.5,
        }}>
          {message.text}
        </p>
      )}

      <button
        onClick={step === "phone" ? sendOtp : verifyOtp}
        disabled={loading}
        style={btnStyle(loading)}
      >
        {loading ? "Please wait…" : step === "phone" ? "Send OTP" : "Verify"}
      </button>

      {step === "otp" && (
        <p style={{ margin: 0, textAlign: "center" }}>
          <button onClick={reset} style={amberLink}>Resend OTP</button>
        </p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
type MainTab = "email" | "phone";
type EmailTab = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mainTab, setMainTab] = useState<MainTab>("email");
  const [emailTab, setEmailTab] = useState<EmailTab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  function switchMain(t: MainTab) {
    setMainTab(t);
    setMessage(null);
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    if (emailTab === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      });
      setMessage(error
        ? { text: error.message, ok: false }
        : { text: "Check your email to confirm your account.", ok: true });
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage({ text: error.message, ok: false });
      else router.push("/");
    }
    setLoading(false);
  }

  const tabBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    background: "transparent",
    border: "none",
    borderBottom: active ? "1px solid #d4a857" : "1px solid transparent",
    marginBottom: -1,
    padding: "10px 0",
    fontFamily: "var(--font-body)",
    fontWeight: 400,
    fontSize: "0.62rem",
    letterSpacing: "0.35em",
    textTransform: "uppercase",
    color: active ? "#fbf3d4" : "rgba(192,200,206,0.4)",
    cursor: "pointer",
    transition: "color 0.2s",
  });

  return (
    <main style={{
      minHeight: "100vh",
      background: "rgb(6,4,2)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 24px",
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Heading */}
        <h1 style={{
          fontFamily: "var(--font-heading)",
          fontWeight: 300,
          fontSize: "clamp(2.4rem, 8vw, 3.6rem)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "#fbf3d4",
          margin: "0 0 48px",
          textAlign: "center",
        }}>
          Cadieux
        </h1>

        {/* Main tabs: Email / Phone */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(192,200,206,0.12)", marginBottom: 32 }}>
          <button style={tabBtn(mainTab === "email")} onClick={() => switchMain("email")}>Email</button>
          <button style={tabBtn(mainTab === "phone")} onClick={() => switchMain("phone")}>Phone</button>
        </div>

        {/* ── Phone flow ── */}
        {mainTab === "phone" && (
          <PhoneLogin onSuccess={() => router.push("/")} />
        )}

        {/* ── Email flow ── */}
        {mainTab === "email" && (
          <>
            {/* Email sub-tabs: Log In / Sign Up */}
            <div style={{ display: "flex", borderBottom: "1px solid rgba(192,200,206,0.08)", marginBottom: 32 }}>
              {(["login", "signup"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setEmailTab(t); setMessage(null); }}
                  style={{
                    ...tabBtn(emailTab === t),
                    fontSize: "0.55rem",
                    color: emailTab === t ? "rgba(251,243,212,0.8)" : "rgba(192,200,206,0.3)",
                    borderBottom: emailTab === t ? "1px solid rgba(212,168,87,0.5)" : "1px solid transparent",
                  }}
                >
                  {t === "login" ? "Log In" : "Sign Up"}
                </button>
              ))}
            </div>

            <form onSubmit={handleEmailSubmit} style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              {emailTab === "signup" && (
                <div>
                  <label style={labelStyle}>Full Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    required
                    autoComplete="name"
                    style={inputStyle}
                  />
                </div>
              )}
              <div>
                <label style={labelStyle}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete={emailTab === "signup" ? "new-password" : "current-password"}
                  minLength={6}
                  style={inputStyle}
                />
              </div>

              {message && (
                <p style={{
                  fontFamily: "var(--font-body)",
                  fontWeight: 300,
                  fontSize: "0.8rem",
                  letterSpacing: "0.02em",
                  color: message.ok ? "#6fcf97" : "#eb5757",
                  margin: 0,
                  lineHeight: 1.5,
                }}>
                  {message.text}
                </p>
              )}

              <button type="submit" disabled={loading} style={btnStyle(loading)}>
                {loading ? "Please wait…" : emailTab === "login" ? "Log In" : "Create Account"}
              </button>
            </form>

            <p style={{
              marginTop: 32,
              textAlign: "center",
              fontFamily: "var(--font-body)",
              fontWeight: 300,
              fontSize: "0.72rem",
              letterSpacing: "0.12em",
              color: "rgba(192,200,206,0.35)",
            }}>
              {emailTab === "login" ? (
                <>No account?{" "}
                  <span onClick={() => { setEmailTab("signup"); setMessage(null); }}
                    style={{ color: "rgba(212,168,87,0.8)", cursor: "pointer", textDecoration: "underline" }}>
                    Sign up
                  </span>
                </>
              ) : (
                <>Already a member?{" "}
                  <span onClick={() => { setEmailTab("login"); setMessage(null); }}
                    style={{ color: "rgba(212,168,87,0.8)", cursor: "pointer", textDecoration: "underline" }}>
                    Log in
                  </span>
                </>
              )}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
