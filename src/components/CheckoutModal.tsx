"use client";

import { useState, useEffect } from "react";
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

type Step = "form" | "payment" | "done";
type FormMode = "returning" | "edit" | "fresh";

type Customer = {
  id?: string;
  full_name: string;
  phone: string;
  city: string;
  delivery_address: string;
};

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const inputSt: React.CSSProperties = {
  display: "block", width: "100%", boxSizing: "border-box",
  background: "transparent",
  border: "none", borderBottom: "1px solid rgba(240,223,200,0.18)",
  padding: "10px 0", outline: "none",
  fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200,
  color: "#FBF3D4", letterSpacing: "0.04em",
};

const labelSt: React.CSSProperties = {
  display: "block", marginBottom: 6,
  fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200,
  letterSpacing: "0.4em", textTransform: "uppercase",
  color: "rgba(200,144,58,0.65)",
};

const sectionHead: React.CSSProperties = {
  margin: "0 0 20px",
  fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200,
  letterSpacing: "0.5em", textTransform: "uppercase",
  color: "rgba(240,223,200,0.28)",
};

/* ── Main component ─────────────────────────────────────────────────────── */
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
  const [step, setStep] = useState<Step>("form");
  const [formMode, setFormMode] = useState<FormMode>("fresh");

  // Form fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [addressLine, setAddressLine] = useState("");
  const [area, setArea] = useState("");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [savedCustomer, setSavedCustomer] = useState<Customer | null>(null);

  // Loading states
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);

  // Errors
  const [error, setError] = useState("");
  const [otpError, setOtpError] = useState("");
  const [orderNum, setOrderNum] = useState("");

  /* ── Pre-fill on mount ─────────────────────────────────────────────────── */
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("cadieux_phone") : null;
    if (!saved) return;
    setPhone(saved);

    // Skip OTP if already verified this session
    const sessionPhone = sessionStorage.getItem("cadieux_verified_phone");
    if (sessionPhone === saved) setOtpVerified(true);

    // Load previous customer details
    fetch(`/api/checkout?phone=${encodeURIComponent(saved)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.customer) return;
        const c = d.customer as Customer;
        setSavedCustomer(c);
        setCustomer(c);
        setName(c.full_name ?? "");
        setCity(c.city ?? "");
        prefillAddress(c.delivery_address ?? "");
        setFormMode("returning");
      })
      .catch(() => {});
  }, []);

  function prefillAddress(raw: string) {
    // stored as "AddressLine, Area, City - 530045"
    const pincodeMatch = raw.match(/(\d{6})\s*$/);
    if (pincodeMatch) {
      setPincode(pincodeMatch[1]);
      const withoutPincode = raw.replace(/[\s,–\-]+\d{6}\s*$/, "").trim();
      const parts = withoutPincode.split(",").map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        setAddressLine(parts[0]);
        // middle parts = area (everything except first and last = city)
        setArea(parts.slice(1, parts.length > 2 ? -1 : undefined).join(", "));
      } else {
        setAddressLine(withoutPincode);
      }
    } else {
      setAddressLine(raw);
    }
  }

  /* ── OTP ───────────────────────────────────────────────────────────────── */
  async function sendOtp() {
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) { setOtpError("Enter a valid 10-digit number."); return; }
    setSendingOtp(true); setOtpError("");
    const { error } = await supabase.auth.signInWithOtp({ phone: "+91" + digits });
    setSendingOtp(false);
    if (error) { setOtpError("Error: " + error.message); return; }
    setOtpSent(true);
    setOtpCode("");
  }

  async function verifyOtp() {
    if (otpCode.replace(/\D/g, "").length !== 6) { setOtpError("Enter the 6-digit code."); return; }
    setVerifyingOtp(true); setOtpError("");
    const { error } = await supabase.auth.verifyOtp({
      phone: "+91" + phone.replace(/\D/g, ""),
      token: otpCode.replace(/\D/g, ""),
      type: "sms",
    });
    setVerifyingOtp(false);
    if (error) { setOtpError("Invalid code. Try again."); setOtpCode(""); return; }
    setOtpVerified(true);
    setOtpSent(false);
    sessionStorage.setItem("cadieux_verified_phone", phone.replace(/\D/g, ""));
  }

  /* ── Submit form → save to Supabase → payment step ─────────────────────── */
  async function handleSubmit() {
    setError("");
    if (!name.trim())                             { setError("Please enter your name."); return; }
    if (phone.replace(/\D/g,"").length !== 10)    { setError("Enter a valid 10-digit number."); return; }
    if (!otpVerified)                             { setError("Please verify your phone number."); return; }
    if (!addressLine.trim())                      { setError("Please enter your delivery address."); return; }
    if (!area.trim())                             { setError("Please enter your area / locality."); return; }
    if (!city.trim())                             { setError("Please enter your city."); return; }
    if (pincode.replace(/\D/g,"").length !== 6)  { setError("Enter a valid 6-digit pincode."); return; }

    const fullAddress = `${addressLine.trim()}, ${area.trim()}, ${city.trim()} - ${pincode.trim()}`;

    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_customer",
          full_name: name.trim(),
          phone: phone.replace(/\D/g, ""),
          delivery_address: fullAddress,
          city: city.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to save details."); return; }
      localStorage.setItem("cadieux_phone", phone.replace(/\D/g, ""));
      setCustomer(data.customer);
      setStep("payment");
    } catch {
      setError("Something went wrong. Try again.");
    } finally { setSubmitting(false); }
  }

  /* ── COD order ──────────────────────────────────────────────────────────── */
  async function placeOrderCOD() {
    const fullAddress = `${addressLine.trim()}, ${area.trim()}, ${city.trim()} - ${pincode.trim()}`;
    setOrderLoading(true); setError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "place_order",
          customer_id: customer?.id,
          delivery_address: fullAddress,
          total_amount: total,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Order failed."); return; }
      setOrderNum(data.order_id?.slice(0, 8).toUpperCase() ?? Math.random().toString(36).slice(2, 10).toUpperCase());
      setStep("done");
    } catch {
      setError("Something went wrong.");
    } finally { setOrderLoading(false); }
  }

  /* ── Razorpay online payment ─────────────────────────────────────────────── */
  async function payOnline() {
    setOrderLoading(true); setError("");
    try {
      const res = await fetch("/api/create-order", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: total * 100 }),
      });
      if (!res.ok) {
        setError("Online payment unavailable. Please use Cash on Delivery.");
        return;
      }
      const { order_id } = await res.json();

      // Load Razorpay script
      const loaded = await new Promise<boolean>(resolve => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((window as any).Razorpay) { resolve(true); return; }
        const s = document.createElement("script");
        s.src = "https://checkout.razorpay.com/v1/checkout.js";
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.body.appendChild(s);
      });

      setOrderLoading(false);
      if (!loaded) { setError("Failed to load payment gateway. Please use Cash on Delivery."); return; }

      const fullAddress = `${addressLine.trim()}, ${area.trim()}, ${city.trim()} - ${pincode.trim()}`;

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: total * 100,
        currency: "INR",
        name: "Cadieux",
        description: "Protein Bread",
        order_id,
        handler: async (response: { razorpay_payment_id: string }) => {
          setOrderLoading(true);
          const r = await fetch("/api/checkout", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "place_order",
              customer_id: customer?.id,
              delivery_address: fullAddress,
              total_amount: total,
            }),
          });
          const d = await r.json();
          setOrderLoading(false);
          console.log("[Payment] Success, Razorpay ID:", response.razorpay_payment_id);
          setOrderNum(d.order_id?.slice(0, 8).toUpperCase() ?? "ONLINE");
          setStep("done");
        },
        prefill: { name, contact: "+91" + phone.replace(/\D/g, "") },
        theme: { color: "#024628" },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new (window as any).Razorpay(options).open();
    } catch {
      setError("Something went wrong.");
      setOrderLoading(false);
    }
  }

  const fullAddressDisplay = [addressLine, area, city, pincode].filter(Boolean).join(", ");

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <>
      <style>{`
        @keyframes check-draw { from { stroke-dashoffset: 80; opacity: 0; } to { stroke-dashoffset: 0; opacity: 1; } }
        @keyframes circle-draw { from { stroke-dashoffset: 220; } to { stroke-dashoffset: 0; } }
      `}</style>

      {/* Backdrop */}
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 300,
          background: "rgba(0,0,0,0.92)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "16px",
        }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        {/* Card */}
        <div style={{
          width: "100%", maxWidth: 480,
          background: "#0e0e0e",
          maxHeight: "92dvh", overflowY: "auto",
          position: "relative",
        }}>
          {/* Grain */}
          <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.04, pointerEvents: "none", zIndex: 0 }} />

          {/* Close */}
          {step !== "done" && (
            <button onClick={onClose} style={{
              position: "absolute", top: 18, right: 18, zIndex: 10,
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(240,223,200,0.25)", fontSize: 18, lineHeight: 1,
              WebkitTapHighlightColor: "transparent",
            }}>✕</button>
          )}

          <div style={{ position: "relative", zIndex: 1, padding: "40px 28px 52px" }}>

            {/* ══ FORM STEP ══════════════════════════════════════════════════ */}
            {step === "form" && (
              <>
                {/* Header */}
                <p style={{ margin: "0 0 4px", fontFamily: "var(--font-heading)", fontSize: "clamp(28px,7vw,38px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.06em", lineHeight: 1 }}>
                  Checkout
                </p>
                <p style={{ margin: "0 0 28px", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.45em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)" }}>
                  {formMode === "returning" ? "Welcome back" : "Fill in your details to place order"}
                </p>

                {/* Cart summary */}
                <div style={{ marginBottom: 28 }}>
                  <p style={sectionHead}>Your Order</p>
                  {cart.map((item, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(240,223,200,0.07)", padding: "11px 0" }}>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "rgba(240,223,200,0.65)", letterSpacing: "0.03em" }}>
                        {item.name} × {item.qty}
                      </span>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "#FBF3D4" }}>₹{item.price * item.qty}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(240,223,200,0.12)", paddingTop: 12, marginTop: 4 }}>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(240,223,200,0.35)" }}>Total (Incl. GST)</span>
                    <span style={{ fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 300, color: "#FBF3D4" }}>₹{total}</span>
                  </div>
                </div>

                <div style={{ borderTop: "1px solid rgba(240,223,200,0.06)", marginBottom: 28 }} />

                {/* ── RETURNING CUSTOMER CARD ──────────────────────────────── */}
                {formMode === "returning" && savedCustomer && (
                  <>
                    <p style={sectionHead}>Saved Details</p>

                    {/* Details card */}
                    <div style={{
                      background: "rgba(240,223,200,0.04)",
                      border: "1px solid rgba(240,223,200,0.1)",
                      padding: "18px 20px",
                      marginBottom: 16,
                    }}>
                      <p style={{ margin: "0 0 6px", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "#FBF3D4", letterSpacing: "0.04em" }}>
                        {savedCustomer.full_name}
                      </p>
                      <p style={{ margin: "0 0 6px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, color: "rgba(240,223,200,0.55)", letterSpacing: "0.04em" }}>
                        +91 {savedCustomer.phone}
                      </p>
                      {savedCustomer.delivery_address && (
                        <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, color: "rgba(240,223,200,0.4)", letterSpacing: "0.03em", lineHeight: 1.65 }}>
                          {savedCustomer.delivery_address}
                        </p>
                      )}
                    </div>

                    {error && (
                      <p style={{ margin: "0 0 12px", fontFamily: "var(--font-body)", fontSize: 11, color: "#e05a5a", letterSpacing: "0.04em" }}>
                        {error}
                      </p>
                    )}

                    {/* Proceed with saved details */}
                    <button
                      onClick={() => { setError(""); setStep("payment"); }}
                      style={{
                        display: "block", width: "100%",
                        background: "#f0dfc8", border: "none", padding: "17px 0",
                        cursor: "pointer",
                        fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                        letterSpacing: "0.45em", textTransform: "uppercase",
                        color: "#080604",
                        WebkitTapHighlightColor: "transparent",
                        marginBottom: 10,
                      }}
                    >
                      Proceed to Payment
                    </button>

                    {/* Edit saved details */}
                    <button
                      onClick={() => { setFormMode("edit"); setError(""); }}
                      style={{
                        display: "block", width: "100%",
                        background: "transparent",
                        border: "1px solid rgba(240,223,200,0.14)",
                        padding: "15px 0",
                        cursor: "pointer",
                        fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                        letterSpacing: "0.4em", textTransform: "uppercase",
                        color: "rgba(240,223,200,0.55)",
                        WebkitTapHighlightColor: "transparent",
                        marginBottom: 28,
                      }}
                    >
                      Edit Details
                    </button>

                    {/* Divider + fresh start */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                      <div style={{ flex: 1, height: 1, background: "rgba(240,223,200,0.07)" }} />
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 8, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(240,223,200,0.25)" }}>or</span>
                      <div style={{ flex: 1, height: 1, background: "rgba(240,223,200,0.07)" }} />
                    </div>

                    <button
                      onClick={() => {
                        setFormMode("fresh");
                        setName(""); setPhone(""); setAddressLine(""); setArea(""); setCity(""); setPincode("");
                        setOtpVerified(false); setOtpSent(false); setOtpCode(""); setOtpError("");
                        setCustomer(null); setError("");
                      }}
                      style={{
                        display: "block", width: "100%",
                        background: "none", border: "none",
                        cursor: "pointer", padding: "10px 0",
                        fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200,
                        letterSpacing: "0.35em", textTransform: "uppercase",
                        color: "rgba(200,144,58,0.5)",
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      Order with a Different Number
                    </button>
                  </>
                )}

                {/* ── EDIT / FRESH FORM ────────────────────────────────────── */}
                {(formMode === "edit" || formMode === "fresh") && (
                  <>
                    <p style={sectionHead}>Your Details</p>

                    {/* Full Name */}
                    <label style={{ display: "block", marginBottom: 22 }}>
                      <span style={labelSt}>Full Name *</span>
                      <input type="text" value={name}
                        onChange={e => { setName(e.target.value); setError(""); }}
                        placeholder="e.g. Arjun Sharma"
                        autoComplete="name"
                        style={inputSt}
                      />
                    </label>

                    {/* Mobile + OTP */}
                    <div style={{ marginBottom: 22 }}>
                      <span style={labelSt}>Mobile Number *</span>
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
                        <div style={{ flex: 1, display: "flex", alignItems: "flex-end", ...inputSt, padding: 0 }}>
                          <span style={{ padding: "10px 0 10px 12px", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "rgba(240,223,200,0.5)", userSelect: "none", letterSpacing: "0.05em" }}>+91</span>
                          <input
                            type="tel" inputMode="numeric" autoComplete="tel-national"
                            value={phone}
                            onChange={e => {
                              setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                              setOtpError(""); setError("");
                              if (otpVerified) { setOtpVerified(false); setOtpSent(false); setOtpCode(""); }
                            }}
                            placeholder="10-digit number"
                            style={{ flex: 1, background: "none", border: "none", outline: "none", padding: "10px 12px 10px 6px", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "#FBF3D4", letterSpacing: "0.05em" }}
                          />
                        </div>
                        {otpVerified ? (
                          <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, marginBottom: 2 }}>
                            <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.2em", color: "#4ade80" }}>✓ Verified</span>
                            <button
                              onClick={() => { setOtpVerified(false); setOtpSent(false); setOtpCode(""); setOtpError(""); }}
                              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "var(--font-body)", fontSize: 8, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(200,144,58,0.55)", WebkitTapHighlightColor: "transparent" }}
                            >Edit</button>
                          </div>
                        ) : (
                          <button
                            onClick={sendOtp}
                            disabled={sendingOtp || phone.replace(/\D/g,"").length < 10}
                            style={{
                              flexShrink: 0, marginBottom: 2,
                              background: "none",
                              border: "1px solid rgba(200,144,58,0.45)",
                              padding: "7px 14px",
                              cursor: (sendingOtp || phone.replace(/\D/g,"").length < 10) ? "default" : "pointer",
                              fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200,
                              letterSpacing: "0.3em", textTransform: "uppercase",
                              color: (sendingOtp || phone.replace(/\D/g,"").length < 10) ? "rgba(200,144,58,0.3)" : "rgba(200,144,58,0.85)",
                              WebkitTapHighlightColor: "transparent",
                            }}
                          >
                            {sendingOtp ? "Sending…" : otpSent ? "Resend" : "Send OTP"}
                          </button>
                        )}
                      </div>

                      {otpSent && !otpVerified && (
                        <div style={{ marginTop: 14 }}>
                          <span style={{ ...labelSt, marginBottom: 8 }}>Enter OTP *</span>
                          <input
                            type="text" inputMode="numeric" autoComplete="one-time-code"
                            maxLength={6}
                            value={otpCode}
                            onChange={e => { setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setOtpError(""); }}
                            placeholder="6-digit code"
                            style={{ ...inputSt, letterSpacing: "0.4em", fontSize: 18, borderBottomColor: "rgba(200,144,58,0.45)" }}
                            autoFocus
                          />
                          <button
                            onClick={verifyOtp}
                            disabled={verifyingOtp || otpCode.replace(/\D/g,"").length < 6}
                            style={{
                              marginTop: 12, display: "block", width: "100%",
                              background: (verifyingOtp || otpCode.replace(/\D/g,"").length < 6) ? "rgba(240,223,200,0.12)" : "#f0dfc8",
                              border: "none", padding: "13px 0",
                              cursor: (verifyingOtp || otpCode.replace(/\D/g,"").length < 6) ? "default" : "pointer",
                              fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300,
                              letterSpacing: "0.4em", textTransform: "uppercase",
                              color: (verifyingOtp || otpCode.replace(/\D/g,"").length < 6) ? "rgba(8,6,4,0.35)" : "#080604",
                              WebkitTapHighlightColor: "transparent",
                            }}
                          >
                            {verifyingOtp ? "Verifying…" : "Verify"}
                          </button>
                        </div>
                      )}

                      {otpError && (
                        <p style={{ margin: "8px 0 0", fontFamily: "var(--font-body)", fontSize: 11, color: "#e05a5a", letterSpacing: "0.04em" }}>
                          {otpError}
                        </p>
                      )}
                    </div>

                    {/* Delivery Address */}
                    <label style={{ display: "block", marginBottom: 22 }}>
                      <span style={labelSt}>Delivery Address *</span>
                      <input type="text" value={addressLine}
                        onChange={e => { setAddressLine(e.target.value); setError(""); }}
                        placeholder="Flat no. / House no. / Building name"
                        autoComplete="address-line1"
                        style={inputSt}
                      />
                    </label>

                    {/* Area */}
                    <label style={{ display: "block", marginBottom: 22 }}>
                      <span style={labelSt}>Area / Locality *</span>
                      <input type="text" value={area}
                        onChange={e => { setArea(e.target.value); setError(""); }}
                        placeholder="Street / Colony / Locality"
                        autoComplete="address-line2"
                        style={inputSt}
                      />
                    </label>

                    {/* City + Pincode */}
                    <div style={{ display: "flex", gap: 16, marginBottom: 32 }}>
                      <label style={{ flex: 1 }}>
                        <span style={labelSt}>City *</span>
                        <input type="text" value={city}
                          onChange={e => { setCity(e.target.value); setError(""); }}
                          placeholder="Visakhapatnam"
                          autoComplete="address-level2"
                          style={inputSt}
                        />
                      </label>
                      <label style={{ flex: "0 0 110px" }}>
                        <span style={labelSt}>Pincode *</span>
                        <input type="text" inputMode="numeric" maxLength={6}
                          value={pincode}
                          onChange={e => { setPincode(e.target.value.replace(/\D/g,"").slice(0,6)); setError(""); }}
                          placeholder="530045"
                          autoComplete="postal-code"
                          style={inputSt}
                        />
                      </label>
                    </div>

                    {error && (
                      <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 11, color: "#e05a5a", letterSpacing: "0.04em" }}>
                        {error}
                      </p>
                    )}

                    <button
                      onClick={handleSubmit}
                      disabled={submitting}
                      style={{
                        display: "block", width: "100%",
                        background: submitting ? "rgba(240,223,200,0.5)" : "#f0dfc8",
                        border: "none", padding: "17px 0",
                        cursor: submitting ? "default" : "pointer",
                        fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                        letterSpacing: "0.45em", textTransform: "uppercase",
                        color: "#080604",
                        WebkitTapHighlightColor: "transparent",
                        transition: "background 0.2s",
                      }}
                    >
                      {submitting ? "Saving…" : "Proceed to Payment"}
                    </button>

                    {/* Back to saved details if editing */}
                    {savedCustomer && (
                      <button
                        onClick={() => {
                          setFormMode("returning");
                          setName(savedCustomer.full_name ?? "");
                          setPhone(savedCustomer.phone ?? "");
                          setCustomer(savedCustomer);
                          prefillAddress(savedCustomer.delivery_address ?? "");
                          setOtpVerified(true); setOtpSent(false); setOtpCode(""); setOtpError(""); setError("");
                        }}
                        style={{
                          display: "block", width: "100%", background: "none", border: "none",
                          cursor: "pointer", marginTop: 18,
                          fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200,
                          letterSpacing: "0.3em", textTransform: "uppercase",
                          color: "rgba(240,223,200,0.22)",
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        ← Back
                      </button>
                    )}
                  </>
                )}
              </>
            )}

            {/* ══ PAYMENT STEP ═══════════════════════════════════════════════ */}
            {step === "payment" && (
              <>
                <p style={{ margin: "0 0 4px", fontFamily: "var(--font-heading)", fontSize: "clamp(28px,7vw,38px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.06em" }}>
                  Payment
                </p>
                <p style={{ margin: "0 0 28px", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.45em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)" }}>
                  Choose how to pay
                </p>

                {/* Order summary card */}
                <div style={{ background: "rgba(240,223,200,0.04)", border: "1px solid rgba(240,223,200,0.08)", padding: "16px 18px", marginBottom: 28 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(240,223,200,0.35)" }}>Order Total</p>
                      <p style={{ margin: "4px 0 0", fontFamily: "var(--font-heading)", fontSize: 28, fontWeight: 300, color: "#FBF3D4" }}>₹{total}</p>
                    </div>
                  </div>
                  <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, color: "rgba(240,223,200,0.5)", letterSpacing: "0.03em" }}>
                    {name} · +91 {phone.replace(/\D/g, "")}
                  </p>
                  <p style={{ margin: "4px 0 0", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, color: "rgba(240,223,200,0.35)", letterSpacing: "0.03em", lineHeight: 1.6 }}>
                    {fullAddressDisplay}
                  </p>
                </div>

                {error && (
                  <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 11, color: "#e05a5a" }}>
                    {error}
                  </p>
                )}

                {/* Pay Online (Razorpay) */}
                <button
                  onClick={payOnline}
                  disabled={orderLoading}
                  style={{
                    display: "block", width: "100%",
                    background: orderLoading ? "rgba(2,70,40,0.35)" : "#024628",
                    border: "none", padding: "18px 0", marginBottom: 10,
                    cursor: orderLoading ? "default" : "pointer",
                    fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                    letterSpacing: "0.4em", textTransform: "uppercase",
                    color: orderLoading ? "rgba(251,243,212,0.35)" : "#FBF3D4",
                    WebkitTapHighlightColor: "transparent",
                    transition: "background 0.2s",
                  }}
                >
                  {orderLoading ? "Processing…" : "Pay Online"}
                </button>
                <p style={{ margin: "0 0 20px", textAlign: "center", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.3em", color: "rgba(240,223,200,0.22)", textTransform: "uppercase" }}>
                  UPI · Cards · Net Banking · Wallets
                </p>

                {/* Cash on Delivery */}
                <button
                  onClick={placeOrderCOD}
                  disabled={orderLoading}
                  style={{
                    display: "block", width: "100%",
                    background: "transparent",
                    border: "1px solid rgba(240,223,200,0.14)",
                    padding: "17px 0",
                    cursor: orderLoading ? "default" : "pointer",
                    fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                    letterSpacing: "0.4em", textTransform: "uppercase",
                    color: orderLoading ? "rgba(240,223,200,0.2)" : "rgba(240,223,200,0.55)",
                    WebkitTapHighlightColor: "transparent",
                    transition: "border-color 0.2s",
                  }}
                >
                  Cash on Delivery
                </button>
                <p style={{ margin: "8px 0 0", textAlign: "center", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.3em", color: "rgba(240,223,200,0.2)", textTransform: "uppercase" }}>
                  Pay when it arrives
                </p>

                <button
                  onClick={() => setStep("form")}
                  style={{
                    display: "block", width: "100%", background: "none", border: "none",
                    cursor: "pointer", marginTop: 28,
                    fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200,
                    letterSpacing: "0.3em", textTransform: "uppercase",
                    color: "rgba(240,223,200,0.22)",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  ← Edit Details
                </button>
              </>
            )}

            {/* ══ DONE STEP ══════════════════════════════════════════════════ */}
            {step === "done" && (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <svg width="72" height="72" viewBox="0 0 72 72" style={{ marginBottom: 28 }}>
                  <circle cx="36" cy="36" r="34" fill="none" stroke="#024628" strokeWidth="2"
                    strokeDasharray="220" strokeDashoffset="0"
                    style={{ animation: "circle-draw 0.5s ease forwards" }}
                  />
                  <polyline points="22,37 32,47 52,26" fill="none"
                    stroke="#FBF3D4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    strokeDasharray="80" strokeDashoffset="0"
                    style={{ animation: "check-draw 0.4s 0.4s ease forwards", opacity: 0 }}
                  />
                </svg>
                <p style={{ margin: "0 0 8px", fontFamily: "var(--font-heading)", fontSize: "clamp(32px,8vw,48px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.06em" }}>
                  Order Placed
                </p>
                <p style={{ margin: "0 0 8px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(200,144,58,0.75)" }}>
                  Order #{orderNum}
                </p>
                <p style={{ margin: "0 0 40px", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, letterSpacing: "0.06em", color: "rgba(240,223,200,0.45)", lineHeight: 1.7 }}>
                  Estimated delivery: 1–2 days<br />
                  We&apos;ll reach out on your number to confirm.
                </p>
                <button
                  onClick={onOrderPlaced}
                  style={{
                    display: "block", width: "100%",
                    background: "#f0dfc8", border: "none", padding: "17px 0",
                    cursor: "pointer",
                    fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                    letterSpacing: "0.45em", textTransform: "uppercase",
                    color: "#080604",
                    WebkitTapHighlightColor: "transparent",
                  }}
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
