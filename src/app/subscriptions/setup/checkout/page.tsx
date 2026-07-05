"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TurnstileWidget, { type TurnstileHandle } from "@/components/TurnstileWidget";
import {
  loadSetupState,
  saveAddress,
  totalUnitsPerDelivery,
  MIN_UNITS_PER_DELIVERY,
  type SetupAddress,
} from "@/lib/subscription-setup";

const BG = "#C0C8CE";
const GOLD = "#024628";
const TEXT = "#024628";
const FADED = "rgba(2,70,40,0.6)";
const FAINT = "rgba(2,70,40,0.2)";
const RED = "#ff8181";

type SavedCustomer = {
  id: string;
  full_name: string | null;
  phone: string;
  city: string | null;
  delivery_address: string | null;
};

export default function CheckoutPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [hasSetup, setHasSetup] = useState(false);
  const [savedCustomer, setSavedCustomer] = useState<SavedCustomer | null>(null);
  const [savedLoading, setSavedLoading] = useState(true);
  const [mode, setMode] = useState<"choose" | "new">("choose");

  useEffect(() => {
    setHydrated(true);
    const s = loadSetupState();
    const ok =
      totalUnitsPerDelivery(s) >= MIN_UNITS_PER_DELIVERY && s.selectedDates.length > 0;
    setHasSetup(ok);
    if (!ok) {
      router.replace("/subscriptions/setup");
      return;
    }
    const phone = typeof window !== "undefined" ? localStorage.getItem("cadieux_phone") : null;
    if (!phone) {
      setSavedLoading(false);
      return;
    }
    fetch(`/api/checkout?phone=${encodeURIComponent(phone)}`)
      .then((r) => r.json())
      .then((d) => setSavedCustomer(d.customer ?? null))
      .catch(() => setSavedCustomer(null))
      .finally(() => setSavedLoading(false));
  }, [router]);

  function useSaved() {
    if (!savedCustomer) return;
    const addr: SetupAddress = {
      customer_id: savedCustomer.id,
      full_name: savedCustomer.full_name ?? "",
      phone: savedCustomer.phone.replace(/\D/g, "").slice(-10),
      address: savedCustomer.delivery_address ?? "",
      city: savedCustomer.city ?? "",
      pincode: "",
      source: "saved",
    };
    saveAddress(addr);
    router.replace("/subscriptions/setup/payment");
  }

  if (!hydrated || !hasSetup) {
    return <main style={pageStyle} />;
  }

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <Link href="/subscriptions/setup" style={{ fontSize: 13, color: FADED, textDecoration: "none" }}>
          ← Back to schedule
        </Link>
        <h1
          style={{
            marginTop: 16,
            marginBottom: 6,
            fontFamily: "var(--font-heading)",
            fontWeight: 300,
            fontSize: "clamp(28px,5vw,42px)",
          }}
        >
          Delivery address
        </h1>
        <p style={{ color: FADED, fontSize: 14, marginTop: 0, marginBottom: 28 }}>
          Where should we deliver?
        </p>

        {mode === "choose" && (
          <>
            <div style={{ display: "grid", gap: 14 }}>
              <SavedCard
                loading={savedLoading}
                customer={savedCustomer}
                onUse={useSaved}
              />
              <NewAddressCard onSelect={() => setMode("new")} />
            </div>
          </>
        )}

        {mode === "new" && (
          <NewAddressForm
            onCancel={() => setMode("choose")}
            onDone={() => router.replace("/subscriptions/setup/payment")}
          />
        )}
      </div>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100dvh",
  background: BG,
  color: TEXT,
  padding: "60px 20px 100px",
  fontFamily: "var(--font-body)",
};

function SavedCard({
  loading,
  customer,
  onUse,
}: {
  loading: boolean;
  customer: SavedCustomer | null;
  onUse: () => void;
}) {
  if (loading) {
    return (
      <div style={cardStyle(false)}>
        <div style={{ color: FADED, fontSize: 14 }}>Looking up saved address…</div>
      </div>
    );
  }
  if (!customer) {
    return (
      <div style={cardStyle(false)}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 18, marginBottom: 4 }}>
          No saved address
        </div>
        <div style={{ color: FADED, fontSize: 13 }}>
          Add a new address below to verify your phone and continue.
        </div>
      </div>
    );
  }
  return (
    <button onClick={onUse} style={cardButtonStyle()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 22 }}>
          Use saved address
        </div>
        <div style={{ fontSize: 11, color: GOLD, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Verified
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 14, color: TEXT }}>
        {customer.full_name || "—"}
      </div>
      <div style={{ marginTop: 4, fontSize: 13, color: FADED }}>
        {customer.delivery_address || "No address on file"}
      </div>
      <div style={{ marginTop: 4, fontSize: 13, color: FADED }}>
        {customer.city ? `${customer.city} · ` : ""}+91 {customer.phone.replace(/\D/g, "").slice(-10)}
      </div>
    </button>
  );
}

function NewAddressCard({ onSelect }: { onSelect: () => void }) {
  return (
    <button onClick={onSelect} style={cardButtonStyle()}>
      <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 22 }}>
        Add new address
      </div>
      <div style={{ marginTop: 6, fontSize: 13, color: FADED }}>
        We'll verify your phone with a one-time code.
      </div>
    </button>
  );
}

function cardStyle(active: boolean): React.CSSProperties {
  return {
    padding: 20,
    borderRadius: 14,
    background: active ? "rgba(2,70,40,0.08)" : "rgba(2,70,40,0.03)",
    border: `1px solid ${active ? GOLD : FAINT}`,
  };
}

function cardButtonStyle(): React.CSSProperties {
  return {
    ...cardStyle(false),
    color: TEXT,
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
  };
}

// ── New-address form with OTP + Turnstile ────────────────────────────────

function NewAddressForm({
  onCancel,
  onDone,
}: {
  onCancel: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");

  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);
  const refreshTurnstile = () => {
    setTurnstileToken("");
    turnstileRef.current?.reset();
  };

  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [otpError, setOtpError] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function sendOtp() {
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) { setOtpError("Enter a valid 10-digit number."); return; }
    if (!turnstileToken) { setOtpError("Please complete the human-verification check."); return; }
    setSending(true); setOtpError("");
    try {
      const r = await fetch("/api/verify/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits, turnstileToken }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        setOtpError(d.error ?? "Failed to send code.");
        refreshTurnstile();
        return;
      }
      setOtpSent(true);
      setOtpCode("");
      refreshTurnstile();
    } catch {
      setOtpError("Network error. Try again.");
      refreshTurnstile();
    } finally {
      setSending(false);
    }
  }

  async function verifyOtp() {
    const digits = phone.replace(/\D/g, "");
    const code = otpCode.replace(/\D/g, "");
    if (code.length !== 6) { setOtpError("Enter the 6-digit code."); return; }
    setVerifying(true); setOtpError("");
    try {
      const r = await fetch("/api/verify/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits, code }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setOtpError(d.error ?? "Invalid code."); return; }
      setOtpVerified(true);
    } catch {
      setOtpError("Network error. Try again.");
    } finally {
      setVerifying(false);
    }
  }

  async function saveAndContinue() {
    if (!otpVerified) { setError("Please verify your phone first."); return; }
    if (!name.trim() || !address.trim() || !city.trim() || !pincode.trim()) {
      setError("Please fill all address fields.");
      return;
    }
    setSaving(true); setError("");
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_customer",
          full_name: name.trim(),
          phone: phone.replace(/\D/g, ""),
          delivery_address: address.trim(),
          city: city.trim(),
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? "Failed to save address."); return; }
      localStorage.setItem("cadieux_phone", phone.replace(/\D/g, ""));
      saveAddress({
        customer_id: d.customer.id,
        full_name: name.trim(),
        phone: phone.replace(/\D/g, ""),
        address: address.trim(),
        city: city.trim(),
        pincode: pincode.trim(),
        source: "new",
      });
      onDone();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={cardStyle(true)}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 22, marginBottom: 16 }}>
          New delivery address
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <Field label="Full name">
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Phone (10 digits)">
            <input
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setOtpSent(false); setOtpVerified(false); }}
              inputMode="numeric"
              maxLength={10}
              disabled={otpVerified}
              style={inputStyle}
            />
          </Field>
          <Field label="Address">
            <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="City">
              <input value={city} onChange={(e) => setCity(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Pincode">
              <input
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                style={inputStyle}
              />
            </Field>
          </div>
        </div>
      </div>

      {!otpVerified && (
        <div style={cardStyle(false)}>
          <div style={{ fontSize: 12, color: FADED, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
            Verify phone
          </div>

          {!otpSent && (
            <>
              <div style={{ marginBottom: 10 }}>
                <TurnstileWidget
                  ref={turnstileRef}
                  onVerify={(t) => setTurnstileToken(t)}
                  onExpire={() => setTurnstileToken("")}
                  theme="dark"
                />
              </div>
              <button
                onClick={sendOtp}
                disabled={sending || phone.replace(/\D/g, "").length !== 10 || !turnstileToken}
                style={primaryBtnStyle(!sending && phone.replace(/\D/g, "").length === 10 && Boolean(turnstileToken))}
              >
                {sending ? "Sending…" : "Send code"}
              </button>
            </>
          )}

          {otpSent && (
            <>
              <div style={{ fontSize: 13, color: FADED, marginBottom: 10 }}>
                We sent a 6-digit code to +91 {phone}.
              </div>
              <input
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="6-digit code"
                style={{ ...inputStyle, marginBottom: 10, textAlign: "center", letterSpacing: "0.4em" }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={verifyOtp}
                  disabled={verifying || otpCode.length !== 6}
                  style={primaryBtnStyle(!verifying && otpCode.length === 6)}
                >
                  {verifying ? "Verifying…" : "Verify"}
                </button>
                <button onClick={() => { setOtpSent(false); setOtpCode(""); setOtpError(""); }} style={ghostBtnStyle}>
                  Resend
                </button>
              </div>
            </>
          )}

          {otpError && (
            <div style={{ marginTop: 10, fontSize: 13, color: RED }}>{otpError}</div>
          )}
        </div>
      )}

      {otpVerified && (
        <div style={{ ...cardStyle(false), borderColor: GOLD, color: GOLD, fontSize: 13 }}>
          ✓ Phone verified.
        </div>
      )}

      {error && <div style={{ fontSize: 13, color: RED }}>{error}</div>}

      <div style={{ display: "flex", gap: 10, justifyContent: "space-between", marginTop: 6 }}>
        <button onClick={onCancel} style={ghostBtnStyle}>Back</button>
        <button
          onClick={saveAndContinue}
          disabled={!otpVerified || saving}
          style={primaryBtnStyle(otpVerified && !saving)}
        >
          {saving ? "Saving…" : "Continue to payment"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 12, color: FADED, marginBottom: 5, letterSpacing: "0.05em" }}>{label}</div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "#0a0a0a",
  border: `1px solid ${FAINT}`,
  borderRadius: 8,
  color: TEXT,
  fontSize: 14,
  fontFamily: "var(--font-body)",
};

function primaryBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "10px 22px",
    borderRadius: 999,
    border: "none",
    background: active ? GOLD : FAINT,
    color: active ? "#0a0a0a" : FADED,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    cursor: active ? "pointer" : "not-allowed",
  };
}

const ghostBtnStyle: React.CSSProperties = {
  padding: "10px 22px",
  borderRadius: 999,
  border: `1px solid ${FAINT}`,
  background: "transparent",
  color: TEXT,
  fontSize: 13,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  cursor: "pointer",
};
