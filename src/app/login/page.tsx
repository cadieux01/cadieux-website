"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    if (tab === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      });
      if (error) {
        setMessage({ text: error.message, ok: false });
      } else {
        setMessage({ text: "Check your email to confirm your account.", ok: true });
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage({ text: error.message, ok: false });
      } else {
        router.push("/");
      }
    }
    setLoading(false);
  }

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

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "rgb(6,4,2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Heading */}
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 300,
            fontSize: "clamp(2.4rem, 8vw, 3.6rem)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#fbf3d4",
            margin: "0 0 48px",
            textAlign: "center",
          }}
        >
          Cadieux
        </h1>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid rgba(192,200,206,0.12)",
            marginBottom: 40,
          }}
        >
          {(["login", "signup"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setMessage(null); }}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                borderBottom: tab === t ? "1px solid #d4a857" : "1px solid transparent",
                marginBottom: -1,
                padding: "10px 0",
                fontFamily: "var(--font-body)",
                fontWeight: 400,
                fontSize: "0.62rem",
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                color: tab === t ? "#fbf3d4" : "rgba(192,200,206,0.4)",
                cursor: "pointer",
                transition: "color 0.2s",
              }}
            >
              {t === "login" ? "Log In" : "Sign Up"}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {tab === "signup" && (
            <div>
              <label style={labelStyle}>Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
                autoComplete="name"
                style={{
                  ...inputStyle,
                  "::placeholder": { color: "rgba(192,200,206,0.3)" },
                } as React.CSSProperties}
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
              autoComplete={tab === "signup" ? "new-password" : "current-password"}
              minLength={6}
              style={inputStyle}
            />
          </div>

          {message && (
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontWeight: 300,
                fontSize: "0.8rem",
                letterSpacing: "0.02em",
                color: message.ok ? "#6fcf97" : "#eb5757",
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              {message.text}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 8,
              width: "100%",
              fontFamily: "var(--font-body)",
              fontSize: 11,
              fontWeight: 300,
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: "#080604",
              background: loading ? "rgba(240,223,200,0.5)" : "#f0dfc8",
              padding: "18px 0",
              border: "none",
              cursor: loading ? "default" : "pointer",
              transition: "background 0.2s",
            }}
          >
            {loading ? "Please wait…" : tab === "login" ? "Log In" : "Create Account"}
          </button>
        </form>

        {/* Divider */}
        <p
          style={{
            marginTop: 32,
            textAlign: "center",
            fontFamily: "var(--font-body)",
            fontWeight: 300,
            fontSize: "0.72rem",
            letterSpacing: "0.12em",
            color: "rgba(192,200,206,0.35)",
          }}
        >
          {tab === "login" ? (
            <>
              No account?{" "}
              <span
                onClick={() => { setTab("signup"); setMessage(null); }}
                style={{ color: "rgba(212,168,87,0.8)", cursor: "pointer", textDecoration: "underline" }}
              >
                Sign up
              </span>
            </>
          ) : (
            <>
              Already a member?{" "}
              <span
                onClick={() => { setTab("login"); setMessage(null); }}
                style={{ color: "rgba(212,168,87,0.8)", cursor: "pointer", textDecoration: "underline" }}
              >
                Log in
              </span>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
