"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TurnstileWidget, { type TurnstileHandle } from "@/components/TurnstileWidget";
import {
  loadSetupState,
  revalidateSetupState,
  saveAddress,
  totalUnitsPerDelivery,
  type SetupAddress,
} from "@/lib/subscription-setup";
import { fetchAddresses, type CustomerAddress } from "@/lib/addresses";

const BG = "#C0C8CE";
const GOLD = "#024628";
const TEXT = "#024628";
const FADED = "rgba(2,70,40,0.6)";
const FAINT = "rgba(2,70,40,0.2)";
const RED = "#991B1B";

type SavedCustomer = {
  id: string;
  full_name: string | null;
  phone: string;
  city: string | null;
  delivery_address: string | null;
};

type UnserviceableCtx = {
  pincode: string;
  address: string;
  areaName: string;
  phone: string;
  customerId: string | null;
};

// Pincode fallback for legacy customers.delivery_address free-text strings —
// only used when the address book is empty. Grabs the LAST 6-digit run in
// the string (Indian pincodes are exactly 6 digits and land at the tail).
function extractPincodeFromString(s: string | null | undefined): string {
  if (!s) return "";
  const matches = s.match(/\b\d{6}\b/g);
  return matches && matches.length > 0 ? matches[matches.length - 1] : "";
}

type QuoteResult =
  | { ok: true }
  | { ok: false; reason: "location_required" | "distance_unserviceable" };

// Mirrors the payment page's own quote check so a saved-address customer
// finds out BEFORE arriving at Razorpay that their pincode is off-map.
// Pass coords when available; the API prefers them and falls back to pincode.
async function fetchDeliveryQuote(args: {
  pincode: string;
  latitude: number | null;
  longitude: number | null;
}): Promise<QuoteResult> {
  const params = new URLSearchParams();
  if (args.latitude !== null && args.longitude !== null) {
    params.set("lat", String(args.latitude));
    params.set("lng", String(args.longitude));
  }
  if (/^\d{6}$/.test(args.pincode)) params.set("pincode", args.pincode);
  if (params.toString() === "") return { ok: false, reason: "location_required" };
  try {
    const r = await fetch(`/api/delivery-quote?${params.toString()}`);
    const d = await r.json().catch(() => ({}));
    if (d?.serviceable === true) return { ok: true };
    if (d?.serviceable === false) return { ok: false, reason: "distance_unserviceable" };
    return { ok: false, reason: "location_required" };
  } catch {
    return { ok: false, reason: "location_required" };
  }
}

export default function CheckoutPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [hasSetup, setHasSetup] = useState(false);
  const [savedCustomer, setSavedCustomer] = useState<SavedCustomer | null>(null);
  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [mode, setMode] = useState<"choose" | "new">("choose");
  const [checking, setChecking] = useState(false);
  const [unserviceable, setUnserviceable] = useState<UnserviceableCtx | null>(null);

  useEffect(() => {
    setHydrated(true);
    const s = loadSetupState();
    // Guards against landing here with an empty wizard, or with dates that
    // have gone stale while the tab sat open — any positive number of
    // loaves is a valid subscription. The wizard owns the removal and the
    // explanation, so this only detects and redirects.
    const ok =
      totalUnitsPerDelivery(s) > 0 &&
      s.selectedDates.length > 0 &&
      !revalidateSetupState(s).removedAny;
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
    const digits = phone.replace(/\D/g, "").slice(-10);
    Promise.all([
      fetch(`/api/checkout?phone=${encodeURIComponent(phone)}`)
        .then((r) => r.json())
        .then((d) => (d.customer ?? null) as SavedCustomer | null)
        .catch(() => null),
      digits.length === 10 ? fetchAddresses(digits) : Promise.resolve([]),
    ])
      .then(([customer, addresses]) => {
        setSavedCustomer(customer);
        setSavedAddresses(addresses);
      })
      .finally(() => setSavedLoading(false));
  }, [router]);

  // Pick the address-book default row (or first) when available; otherwise
  // synthesise from the legacy customers.delivery_address free-text string.
  const bookRow: CustomerAddress | null =
    savedAddresses.find((a) => a.is_default) ?? savedAddresses[0] ?? null;

  async function useSaved() {
    if (!savedCustomer || checking) return;
    const digits = savedCustomer.phone.replace(/\D/g, "").slice(-10);

    // Address-book row is the source of truth for pincode + coords when
    // present. Falls back to the trailing-6-digit hit inside the legacy
    // single-string delivery_address so pre-book customers still work.
    const pincode = bookRow?.pincode ?? extractPincodeFromString(savedCustomer.delivery_address);
    const address = bookRow
      ? [bookRow.line1, bookRow.area].filter(Boolean).join(", ")
      : (savedCustomer.delivery_address ?? "");
    const area = bookRow?.area ?? "";
    const city = bookRow?.city ?? savedCustomer.city ?? "";
    const label = bookRow?.label ?? "";
    const latitude = bookRow?.latitude ?? null;
    const longitude = bookRow?.longitude ?? null;

    setChecking(true);
    const quote = await fetchDeliveryQuote({ pincode, latitude, longitude });
    setChecking(false);
    if (!quote.ok) {
      setUnserviceable({
        pincode,
        address,
        areaName: area || city,
        phone: digits,
        customerId: savedCustomer.id,
      });
      return;
    }
    const addr: SetupAddress = {
      customer_id: savedCustomer.id,
      full_name: savedCustomer.full_name ?? bookRow?.full_name ?? "",
      phone: digits,
      address,
      area,
      city,
      pincode,
      label,
      latitude,
      longitude,
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
        <Link href="/subscriptions/setup" style={{ fontSize: 16, color: FADED, textDecoration: "none" }}>
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
        <p style={{ color: FADED, fontSize: 16, marginTop: 0, marginBottom: 28 }}>
          Where should we deliver?
        </p>

        {unserviceable && (
          <UnserviceableCard
            ctx={unserviceable}
            onChangeAddress={() => {
              setUnserviceable(null);
              setMode("new");
            }}
          />
        )}

        {!unserviceable && mode === "choose" && (
          <>
            <div style={{ display: "grid", gap: 14 }}>
              <SavedCard
                loading={savedLoading}
                customer={savedCustomer}
                bookRow={bookRow}
                checking={checking}
                onUse={useSaved}
              />
              <NewAddressCard onSelect={() => setMode("new")} />
            </div>
          </>
        )}

        {!unserviceable && mode === "new" && (
          <NewAddressForm
            onCancel={() => setMode("choose")}
            onDone={() => router.replace("/subscriptions/setup/payment")}
            onUnserviceable={(ctx) => setUnserviceable(ctx)}
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
  bookRow,
  checking,
  onUse,
}: {
  loading: boolean;
  customer: SavedCustomer | null;
  bookRow: CustomerAddress | null;
  checking: boolean;
  onUse: () => void;
}) {
  if (loading) {
    return (
      <div style={cardStyle(false)}>
        <div style={{ color: FADED, fontSize: 16 }}>Looking up saved address…</div>
      </div>
    );
  }
  if (!customer) {
    return (
      <div style={cardStyle(false)}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 18, marginBottom: 4 }}>
          No saved address
        </div>
        <div style={{ color: FADED, fontSize: 16 }}>
          Add a new address below to verify your phone and continue.
        </div>
      </div>
    );
  }
  // Prefer the address-book row's structured fields when we have one —
  // that's where the real pincode + coords live. Fall back to the legacy
  // free-text customers.delivery_address otherwise.
  const displayName = customer.full_name || bookRow?.full_name || "—";
  const displayAddress = bookRow
    ? [bookRow.line1, bookRow.area, bookRow.city, bookRow.pincode]
        .filter(Boolean)
        .join(", ")
    : customer.delivery_address || "No address on file";
  const displayCity = bookRow?.city ?? customer.city ?? "";
  return (
    <button
      onClick={onUse}
      disabled={checking}
      style={{ ...cardButtonStyle(), opacity: checking ? 0.6 : 1, cursor: checking ? "wait" : "pointer" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 22 }}>
          {checking ? "Checking delivery area…" : "Use saved address"}
        </div>
        <div style={{ fontSize: 14, color: GOLD, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Verified
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 16, color: TEXT }}>
        {displayName}
      </div>
      <div style={{ marginTop: 4, fontSize: 16, color: FADED }}>
        {displayAddress}
      </div>
      <div style={{ marginTop: 4, fontSize: 16, color: FADED }}>
        {displayCity ? `${displayCity} · ` : ""}+91 {customer.phone.replace(/\D/g, "").slice(-10)}
      </div>
    </button>
  );
}

// Dead-end blocker for out-of-range pincodes — mirrors the one-time
// checkout's "Send Request to Deliver Here" CTA so a subscription customer
// who is off the map has SOMETHING to press instead of a broken Pay button.
function UnserviceableCard({
  ctx,
  onChangeAddress,
}: {
  ctx: UnserviceableCtx;
  onChangeAddress: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function submitRequest() {
    if (submitting || submitted) return;
    setSubmitting(true);
    setError("");
    try {
      const r = await fetch("/api/delivery-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: ctx.phone,
          pincode: ctx.pincode,
          area_name: ctx.areaName || null,
          address: ctx.address,
          customer_id: ctx.customerId,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        setError(d.error ?? "Could not send request. Please try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ ...cardStyle(true), display: "grid", gap: 12 }}>
      <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 22 }}>
        {submitted ? "Request received" : "We don't deliver here yet"}
      </div>
      <div style={{ fontSize: 16, color: FADED }}>
        {submitted
          ? "Thanks — we'll reach out on +91 " + ctx.phone + " once we can deliver to this pincode."
          : "This pincode is outside our current delivery area, so we can't start a subscription here. Send a request and we'll get in touch when we can serve your area."}
      </div>
      <div style={{ fontSize: 16, color: TEXT }}>
        {ctx.address || "—"}
        {ctx.pincode ? ` · ${ctx.pincode}` : ""}
      </div>
      {error && <div style={{ fontSize: 16, color: RED }}>{error}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {!submitted && (
          <button
            onClick={submitRequest}
            disabled={submitting}
            style={primaryBtnStyle(!submitting)}
          >
            {submitting ? "Sending…" : "Send Request to Deliver Here"}
          </button>
        )}
        <button onClick={onChangeAddress} style={ghostBtnStyle}>
          {submitted ? "Try a different address" : "Change address"}
        </button>
      </div>
    </div>
  );
}

function NewAddressCard({ onSelect }: { onSelect: () => void }) {
  return (
    <button onClick={onSelect} style={cardButtonStyle()}>
      <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 22 }}>
        Add new address
      </div>
      <div style={{ marginTop: 6, fontSize: 16, color: FADED }}>
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
  onUnserviceable,
}: {
  onCancel: () => void;
  onDone: () => void;
  onUnserviceable: (ctx: UnserviceableCtx) => void;
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
    const digits = phone.replace(/\D/g, "");
    const trimmedPincode = pincode.trim();
    setSaving(true); setError("");
    // Check serviceability BEFORE saving — so the customer never lands on
    // the Pay screen with an off-map pincode, and we get a clean chance to
    // route them to "Send Request to Deliver Here" instead.
    const quote = await fetchDeliveryQuote({
      pincode: trimmedPincode,
      latitude: null,
      longitude: null,
    });
    if (!quote.ok) {
      setSaving(false);
      onUnserviceable({
        pincode: trimmedPincode,
        address: address.trim(),
        areaName: city.trim(),
        phone: digits,
        customerId: "",
      });
      return;
    }
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_customer",
          full_name: name.trim(),
          phone: digits,
          delivery_address: address.trim(),
          city: city.trim(),
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? "Failed to save address."); return; }
      localStorage.setItem("cadieux_phone", digits);
      // Phase 2 will populate area/label/coords from the shared address
      // component; today's manual form doesn't collect them.
      saveAddress({
        customer_id: d.customer.id,
        full_name: name.trim(),
        phone: digits,
        address: address.trim(),
        area: "",
        city: city.trim(),
        pincode: trimmedPincode,
        label: "",
        latitude: null,
        longitude: null,
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
          <div style={{ fontSize: 14, color: FADED, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
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
              <div style={{ fontSize: 16, color: FADED, marginBottom: 10 }}>
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
            <div style={{ marginTop: 10, fontSize: 16, color: RED }}>{otpError}</div>
          )}
        </div>
      )}

      {otpVerified && (
        <div style={{ ...cardStyle(false), borderColor: GOLD, color: GOLD, fontSize: 16 }}>
          ✓ Phone verified.
        </div>
      )}

      {error && <div style={{ fontSize: 16, color: RED }}>{error}</div>}

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
      <div style={{ fontSize: 16, color: FADED, marginBottom: 5, letterSpacing: "0.05em" }}>{label}</div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "#FBF3D4",
  border: `1px solid ${FAINT}`,
  borderRadius: 8,
  color: TEXT,
  fontSize: 16,
  fontFamily: "var(--font-body)",
};

function primaryBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "10px 22px",
    borderRadius: 999,
    border: "none",
    background: active ? GOLD : FAINT,
    color: active ? "#FBF3D4" : FADED,
    fontSize: 14,
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
  fontSize: 14,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  cursor: "pointer",
};
