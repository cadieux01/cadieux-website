"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

export type CartItem = {
  productIndex: number;
  name: string;
  price: number;
  qty: number;
  orderType: "once" | "sub";
  weeks?: number;
  day?: string;
  time?: string;
};

type Step = "check" | "signin" | "otp" | "address" | "confirm" | "done";

type Customer = {
  id?: string;
  full_name: string;
  phone: string;
  city: string;
  delivery_address: string;
};

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/* ── Shared styles ─────────────────────────────────────────────────────────── */
const inputSt: React.CSSProperties = {
  display: "block", width: "100%", boxSizing: "border-box",
  background: "rgba(251,243,212,0.05)", border: "1px solid rgba(251,243,212,0.15)",
  padding: "14px 16px", outline: "none",
  fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200,
  color: "#FBF3D4", letterSpacing: "0.05em",
};

const labelSt: React.CSSProperties = {
  display: "block", marginBottom: 8,
  fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200,
  letterSpacing: "0.35em", textTransform: "uppercase",
  color: "rgba(251,243,212,0.45)",
};

function btn(variant: "green" | "cream" | "dim", disabled = false): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "block", width: "100%",
    border: "none", padding: "16px 0", cursor: disabled ? "default" : "pointer",
    fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
    letterSpacing: "0.45em", textTransform: "uppercase",
    WebkitTapHighlightColor: "transparent", transition: "background 0.2s",
  };
  if (variant === "cream")
    return { ...base, background: disabled ? "rgba(240,223,200,0.5)" : "#f0dfc8", color: "#080604" };
  if (variant === "dim")
    return { ...base, background: "rgba(2,70,40,0.3)", color: "rgba(251,243,212,0.3)" };
  return {
    ...base,
    background: disabled ? "rgba(2,70,40,0.35)" : "#024628",
    color: disabled ? "rgba(251,243,212,0.35)" : "#FBF3D4",
  };
}

/* ── 6-box OTP ─────────────────────────────────────────────────────────────── */
function OtpBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = useCallback((i: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const digit = e.target.value.replace(/\D/g, "").slice(-1);
    const arr = (value.padEnd(6, " ")).split("").slice(0, 6);
    arr[i] = digit;
    const joined = arr.join("").trimEnd();
    onChange(joined);
    if (digit && i < 5) refs.current[i + 1]?.focus();
  }, [value, onChange]);

  const handleKeyDown = useCallback((i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !value[i] && i > 0) refs.current[i - 1]?.focus();
  }, [value]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    onChange(digits);
    refs.current[Math.min(digits.length, 5)]?.focus();
  }, [onChange]);

  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 28 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el; }}
          type="text" inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1} value={value[i] ?? ""}
          onChange={e => handleChange(i, e)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={handlePaste}
          style={{
            width: 42, height: 52, background: "rgba(251,243,212,0.05)",
            border: "1px solid rgba(251,243,212,0.18)", outline: "none",
            textAlign: "center", fontFamily: "var(--font-body)",
            fontWeight: 300, fontSize: 24, color: "#FBF3D4", caretColor: "#d4a857",
          }}
        />
      ))}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────────────── */
export default function CheckoutModal({
  cart,
  total,
  onClose,
  onOrderPlaced,
}: {
  cart: CartItem[];
  total: number;
  onClose: () => void;
  onOrderPlaced: () => void;
}) {
  const [step, setStep] = useState<Step>("check");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // otpToken no longer needed — Supabase tracks session server-side
  const [otpCode, setOtpCode] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [orderNum, setOrderNum] = useState("");

  // ── On mount: check localStorage ──────────────────────────────────────────
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("cadieux_phone") : null;
    if (!saved) { setStep("signin"); return; }
    setPhone(saved);
    fetch(`/api/checkout?phone=${encodeURIComponent(saved)}`)
      .then(r => r.json())
      .then(data => {
        if (data.customer) {
          setCustomer(data.customer);
          setName(data.customer.full_name ?? "");
          setAddress(data.customer.delivery_address ?? "");
          setCity(data.customer.city ?? "");
          setStep("confirm");
        } else {
          setStep("address");
        }
      })
      .catch(() => setStep("signin"));
  }, []);

  // ── OTP flow (Supabase phone auth) ────────────────────────────────────────
  async function sendOtp() {
    if (!name.trim()) { setError("Please enter your name."); return; }
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) { setError("Enter a valid 10-digit number."); return; }

    const fullPhone = "+91" + digits;
    console.log("[OTP] Sending to:", fullPhone);
    setLoading(true); setError("");

    const { data, error } = await supabase.auth.signInWithOtp({ phone: fullPhone });
    console.log("[OTP] signInWithOtp response:", { data, error });

    setLoading(false);
    if (error) {
      console.error("[OTP] Error:", error.message, error);
      setError("Supabase error: " + error.message);
      return;
    }
    setStep("otp");
  }

  async function resendOtp() {
    const fullPhone = "+91" + phone.replace(/\D/g, "");
    console.log("[OTP] Resending to:", fullPhone);
    setLoading(true); setError("");

    const { data, error } = await supabase.auth.signInWithOtp({ phone: fullPhone });
    console.log("[OTP] resend response:", { data, error });

    setLoading(false);
    if (error) {
      setError("Supabase error: " + error.message);
      return;
    }
    setOtpCode("");
  }

  async function verifyOtp() {
    const code = otpCode.replace(/\D/g, "");
    if (code.length !== 6) { setError("Enter the 6-digit code."); return; }

    const fullPhone = "+91" + phone.replace(/\D/g, "");
    console.log("[OTP] Verifying:", { phone: fullPhone, token: code });
    setLoading(true); setError("");

    const { data, error } = await supabase.auth.verifyOtp({
      phone: fullPhone,
      token: code,
      type: "sms",
    });
    console.log("[OTP] verifyOtp response:", { data, error });

    setLoading(false);
    if (error) {
      console.error("[OTP] Verify error:", error.message, error);
      setError("Supabase error: " + error.message);
      setOtpCode("");
      return;
    }
    setStep("address");
  }

  // ── Save customer → confirm ────────────────────────────────────────────────
  async function saveAddress() {
    if (!address.trim() || !city.trim()) { setError("Please fill all fields."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_customer",
          full_name: name, phone: phone.replace(/\D/g, ""),
          delivery_address: address, city,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      localStorage.setItem("cadieux_phone", phone.replace(/\D/g, ""));
      setCustomer(data.customer);
      setEditing(false);
      setStep("confirm");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally { setLoading(false); }
  }

  // ── Place order ────────────────────────────────────────────────────────────
  async function placeOrder() {
    const deliveryAddr = editing ? address : (customer?.delivery_address ?? address);
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "place_order",
          customer_id: customer?.id,
          delivery_address: deliveryAddr,
          total_amount: total,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Order failed");
      setOrderNum(data.order_id?.slice(0, 8).toUpperCase() ?? Math.random().toString(36).slice(2,10).toUpperCase());
      setStep("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally { setLoading(false); }
  }

  const masked = `+91 ••••• ${phone.replace(/\D/g, "").slice(-5)}`;
  const displayAddress = customer?.delivery_address || address;
  const displayCity = customer?.city || city;
  const displayName = customer?.full_name || name;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes check-draw {
          from { stroke-dashoffset: 80; opacity: 0; }
          to   { stroke-dashoffset: 0;  opacity: 1; }
        }
        @keyframes circle-draw {
          from { stroke-dashoffset: 220; }
          to   { stroke-dashoffset: 0; }
        }
      `}</style>

      {/* Backdrop */}
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 300,
          background: "rgba(0,0,0,0.9)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "16px",
        }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        {/* Card */}
        <div style={{
          width: "100%", maxWidth: 480,
          background: "#111",
          maxHeight: "92dvh", overflowY: "auto",
          padding: "44px 36px 56px",
          position: "relative",
        }}>
          {/* Grain */}
          <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none" }} />

          {/* Close */}
          {step !== "done" && (
            <button onClick={onClose} style={{
              position: "absolute", top: 20, right: 20,
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(251,243,212,0.35)", fontSize: 20, lineHeight: 1,
              WebkitTapHighlightColor: "transparent",
            }}>✕</button>
          )}

          <div style={{ position: "relative", zIndex: 1 }}>

            {/* ── LOADING CHECK ── */}
            {step === "check" && (
              <p style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", color: "rgba(251,243,212,0.4)", textAlign: "center", padding: "40px 0" }}>
                Loading…
              </p>
            )}

            {/* ── SIGN IN ── */}
            {step === "signin" && (
              <>
                <p style={{ margin: "0 0 4px", fontFamily: "var(--font-heading)", fontSize: "clamp(32px,8vw,48px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.06em", lineHeight: 1 }}>
                  Cadieux
                </p>
                <p style={{ margin: "0 0 36px", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(200,144,58,0.7)" }}>
                  Enter your number to continue
                </p>

                <label style={{ display: "block", marginBottom: 24 }}>
                  <span style={labelSt}>Your Name</span>
                  <input type="text" value={name} onChange={e => { setName(e.target.value); setError(""); }}
                    placeholder="e.g. Arjun Sharma" autoComplete="name" style={inputSt} />
                </label>

                <label style={{ display: "block", marginBottom: 32 }}>
                  <span style={labelSt}>Mobile Number</span>
                  <input
                    type="tel" inputMode="numeric" autoComplete="tel-national"
                    value={"+91" + phone}
                    onChange={e => {
                      const raw = e.target.value.replace(/^\+91/, "");
                      setPhone(raw.replace(/\D/g, "").slice(0, 10));
                      setError("");
                    }}
                    onFocus={e => { const l = e.target.value.length; e.target.setSelectionRange(l, l); }}
                    placeholder="+91"
                    style={{
                      ...inputSt,
                      border: "none",
                      borderBottom: "1px solid #c8903a",
                      background: "transparent",
                      padding: "12px 0",
                    }}
                  />
                </label>

                {error && <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 11, color: "#e05a5a", letterSpacing: "0.05em" }}>{error}</p>}
                <button onClick={sendOtp} disabled={loading} style={btn("cream", loading)}>
                  {loading ? "Sending…" : "Send OTP"}
                </button>
              </>
            )}

            {/* ── OTP ── */}
            {step === "otp" && (
              <>
                <p style={{ margin: "0 0 6px", fontFamily: "var(--font-heading)", fontSize: "clamp(28px,7vw,40px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1.1 }}>Verify</p>
                <p style={{ margin: "0 0 32px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.25em", color: "rgba(251,243,212,0.4)" }}>
                  6-digit code sent to {masked}
                </p>
                <OtpBoxes value={otpCode} onChange={setOtpCode} />
                {error && <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 11, color: "#e05a5a", letterSpacing: "0.05em" }}>{error}</p>}
                <button onClick={verifyOtp} disabled={loading || otpCode.replace(/\D/g,"").length < 6} style={btn("cream", loading || otpCode.replace(/\D/g,"").length < 6)}>
                  {loading ? "Verifying…" : "Verify"}
                </button>
                <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between" }}>
                  <button onClick={() => { setStep("signin"); setOtpCode(""); setError(""); }} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.35)", WebkitTapHighlightColor: "transparent" }}>
                    ← Change number
                  </button>
                  <button onClick={resendOtp} disabled={loading} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "#4369B2", WebkitTapHighlightColor: "transparent" }}>
                    Resend code
                  </button>
                </div>
              </>
            )}

            {/* ── ADDRESS ── */}
            {step === "address" && (
              <>
                <p style={{ margin: "0 0 6px", fontFamily: "var(--font-heading)", fontSize: "clamp(28px,7vw,40px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1.1 }}>
                  Delivery Details
                </p>
                <p style={{ margin: "0 0 32px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(212,168,87,0.75)" }}>
                  Where should we deliver?
                </p>

                <label style={{ display: "block", marginBottom: 20 }}>
                  <span style={labelSt}>Full Name</span>
                  <input type="text" value={name} onChange={e => { setName(e.target.value); setError(""); }}
                    placeholder="e.g. Arjun Sharma" autoComplete="name" style={inputSt} />
                </label>
                <label style={{ display: "block", marginBottom: 20 }}>
                  <span style={labelSt}>Delivery Address</span>
                  <input type="text" value={address} onChange={e => { setAddress(e.target.value); setError(""); }}
                    placeholder="Flat / Street / Area" autoComplete="street-address" style={inputSt} />
                </label>
                <label style={{ display: "block", marginBottom: 28 }}>
                  <span style={labelSt}>City</span>
                  <input type="text" value={city} onChange={e => { setCity(e.target.value); setError(""); }}
                    placeholder="Visakhapatnam" autoComplete="address-level2" style={inputSt} />
                </label>

                {error && <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 11, color: "#e05a5a", letterSpacing: "0.05em" }}>{error}</p>}
                <button onClick={saveAddress} disabled={loading} style={btn("green", loading)}>
                  {loading ? "Saving…" : "Continue"}
                </button>
              </>
            )}

            {/* ── CONFIRM ── */}
            {step === "confirm" && !editing && (
              <>
                <p style={{ margin: "0 0 40px", fontFamily: "var(--font-heading)", fontSize: "clamp(28px,7vw,40px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1.1 }}>
                  Order Summary
                </p>

                {/* Cart items */}
                <div style={{ marginBottom: 28 }}>
                  {cart.map((item, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(240,223,200,0.08)", padding: "16px 0" }}>
                      <div>
                        <p style={{ margin: "0 0 4px", fontFamily: "var(--font-heading)", fontSize: "clamp(16px,4vw,24px)", fontWeight: 300, color: "#FBF3D4" }}>{item.name}</p>
                        <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(251,243,212,0.4)" }}>
                          Qty {item.qty} · ₹{item.price} each
                        </p>
                      </div>
                      <p style={{ margin: 0, fontFamily: "var(--font-heading)", fontSize: "clamp(16px,4vw,24px)", fontWeight: 300, color: "#FBF3D4" }}>₹{item.price * item.qty}</p>
                    </div>
                  ))}
                </div>

                {/* Total */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(240,223,200,0.15)", paddingTop: 20, marginBottom: 28 }}>
                  <div>
                    <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(251,243,212,0.5)" }}>Total</p>
                    <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(251,243,212,0.3)" }}>Incl. GST</p>
                  </div>
                  <p style={{ margin: 0, fontFamily: "var(--font-heading)", fontSize: "clamp(24px,6vw,36px)", fontWeight: 300, color: "#FBF3D4" }}>₹{total}</p>
                </div>

                {/* Delivery info */}
                <div style={{ background: "rgba(251,243,212,0.04)", border: "1px solid rgba(251,243,212,0.1)", padding: "20px 20px", marginBottom: 32 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(251,243,212,0.45)" }}>Delivering to</span>
                    <button onClick={() => { setEditing(true); }}
                      style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "#4369B2", WebkitTapHighlightColor: "transparent" }}>
                      Edit
                    </button>
                  </div>
                  <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "#FBF3D4", letterSpacing: "0.03em" }}>{displayName}</p>
                  <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "rgba(251,243,212,0.6)", letterSpacing: "0.03em" }}>{displayAddress}</p>
                  <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "rgba(251,243,212,0.4)", letterSpacing: "0.03em" }}>{displayCity}</p>
                </div>

                {error && <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 11, color: "#e05a5a", letterSpacing: "0.05em" }}>{error}</p>}
                <button onClick={placeOrder} disabled={loading} style={btn("cream", loading)}>
                  {loading ? "Placing order…" : "Confirm Order"}
                </button>
              </>
            )}

            {/* ── CONFIRM (EDITING) ── */}
            {step === "confirm" && editing && (
              <>
                <p style={{ margin: "0 0 6px", fontFamily: "var(--font-heading)", fontSize: "clamp(28px,7vw,40px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1.1 }}>
                  Edit Address
                </p>
                <p style={{ margin: "0 0 32px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(212,168,87,0.75)" }}>
                  Update your delivery details
                </p>
                <label style={{ display: "block", marginBottom: 20 }}>
                  <span style={labelSt}>Full Name</span>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} style={inputSt} />
                </label>
                <label style={{ display: "block", marginBottom: 20 }}>
                  <span style={labelSt}>Delivery Address</span>
                  <input type="text" value={address} onChange={e => setAddress(e.target.value)} style={inputSt} />
                </label>
                <label style={{ display: "block", marginBottom: 28 }}>
                  <span style={labelSt}>City</span>
                  <input type="text" value={city} onChange={e => setCity(e.target.value)} style={inputSt} />
                </label>
                {error && <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 11, color: "#e05a5a" }}>{error}</p>}
                <button onClick={saveAddress} disabled={loading} style={btn("green", loading)}>
                  {loading ? "Saving…" : "Save & Continue"}
                </button>
                <button onClick={() => { setEditing(false); setError(""); }} style={{ ...btn("dim"), marginTop: 12 }}>
                  Cancel
                </button>
              </>
            )}

            {/* ── DONE ── */}
            {step === "done" && (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                {/* Animated checkmark */}
                <svg width="72" height="72" viewBox="0 0 72 72" style={{ marginBottom: 28 }}>
                  <circle
                    cx="36" cy="36" r="34" fill="none"
                    stroke="#024628" strokeWidth="2"
                    strokeDasharray="220" strokeDashoffset="0"
                    style={{ animation: "circle-draw 0.5s ease forwards" }}
                  />
                  <polyline
                    points="22,37 32,47 52,26" fill="none"
                    stroke="#FBF3D4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    strokeDasharray="80" strokeDashoffset="0"
                    style={{ animation: "check-draw 0.4s 0.4s ease forwards", opacity: 0 }}
                  />
                </svg>

                <p style={{ margin: "0 0 8px", fontFamily: "var(--font-heading)", fontSize: "clamp(32px,8vw,48px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.06em" }}>
                  Order Placed
                </p>
                <p style={{ margin: "0 0 8px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(212,168,87,0.75)" }}>
                  Order #{orderNum}
                </p>
                <p style={{ margin: "0 0 40px", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, letterSpacing: "0.06em", color: "rgba(251,243,212,0.45)", lineHeight: 1.7 }}>
                  Estimated delivery: 1–2 days<br />
                  We&apos;ll reach out on your number to confirm.
                </p>

                <button
                  onClick={() => { onOrderPlaced(); }}
                  style={btn("cream")}
                >
                  Back to Home
                </button>
              </div>
            )}

          </div>
        </div>
      </div>
    </>
  );
}
