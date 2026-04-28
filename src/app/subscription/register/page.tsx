"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
const GOLD = "201,169,110";
const PENDING_SUB_KEY = "cadieux_pending_subscription";

const DAY_LABELS: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

type PendingSub = {
  bread_slug: string;
  bread_name: string;
  bread_price: number;
  weeks: number;
  days: string[];
  slot_mode: "same" | "custom" | null;
  slot: string | null;
  slots_by_day: Record<string, string> | null;
  total: number;
};

type SaveState = "idle" | "saving" | "saved" | "error";

export default function SubscriptionRegisterPage() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingSub | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PENDING_SUB_KEY);
      if (raw) setPending(JSON.parse(raw));
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setError(null);

    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const trimmedAddr = address.trim();
    if (!trimmedName || !trimmedPhone || !trimmedAddr) {
      setError("Name, phone and address are required.");
      return;
    }

    setSaveState("saving");
    const { error: insertErr } = await supabase.from("subscriptions").insert({
      ...pending,
      customer_name: trimmedName,
      customer_phone: trimmedPhone,
      customer_address: trimmedAddr,
      customer_city: city.trim() || null,
      customer_pincode: pincode.trim() || null,
      status: "pending",
    });
    if (insertErr) {
      setSaveState("error");
      setError(insertErr.message || "Could not save subscription");
      return;
    }
    setSaveState("saved");
    try { sessionStorage.removeItem(PENDING_SUB_KEY); } catch { /* ignore */ }
  }

  if (!hydrated) return null;

  if (!pending) {
    return (
      <div style={{ minHeight: "100dvh", background: "rgb(6,4,2)", color: "#FBF3D4", padding: 40 }}>
        <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 540, margin: "80px auto" }}>
          <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 32, fontWeight: 300, letterSpacing: "0.05em" }}>
            No pending subscription
          </h1>
          <p style={{ marginTop: 16, fontFamily: "var(--font-body)", fontSize: 14, color: "rgba(240,223,200,0.6)" }}>
            Pick a bread and set up your subscription first.
          </p>
          <Link href="/shop" style={{
            display: "inline-block", marginTop: 24,
            padding: "12px 18px",
            border: `1px solid rgba(${GOLD},0.6)`,
            color: `rgba(${GOLD},0.95)`,
            fontFamily: "var(--font-body)", fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase",
            textDecoration: "none",
          }}>
            Browse breads →
          </Link>
        </div>
      </div>
    );
  }

  const dayLabels = pending.days.map((k) => DAY_LABELS[k] ?? k).join(", ");

  return (
    <div style={{ minHeight: "100dvh", background: "rgb(6,4,2)", color: "#FBF3D4", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 540, margin: "0 auto", padding: "60px 24px 80px" }}>
        <Link href="/subscription" style={{
          fontFamily: "var(--font-body)", fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase",
          color: `rgba(${GOLD},0.7)`, textDecoration: "none",
        }}>
          ← CADIEUX
        </Link>

        <h1 style={{
          marginTop: 32,
          fontFamily: "var(--font-heading)", fontSize: 44, fontWeight: 300,
          letterSpacing: "0.02em", lineHeight: 1.1,
        }}>
          Registration
        </h1>
        <p style={{
          marginTop: 8,
          fontFamily: "var(--font-body)", fontSize: 11,
          letterSpacing: "0.3em", textTransform: "uppercase",
          color: `rgba(${GOLD},0.6)`,
        }}>
          One last step before checkout
        </p>

        {/* Order summary card */}
        <div style={{
          marginTop: 32,
          padding: 18,
          border: `1px solid rgba(${GOLD},0.25)`,
          borderRadius: 12,
          background: `rgba(${GOLD},0.04)`,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 400 }}>
              {pending.bread_name}
            </span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 11, letterSpacing: "0.2em", color: "rgba(240,223,200,0.5)" }}>
              ₹{pending.bread_price} / loaf
            </span>
          </div>
          <SummaryLine label="Duration" value={`${pending.weeks} ${pending.weeks === 1 ? "week" : "weeks"}`} />
          <SummaryLine label="Days" value={dayLabels} />
          {pending.slot_mode === "same" && pending.slot && (
            <SummaryLine label="Timings" value={pending.slot} />
          )}
          {pending.slot_mode === "custom" && pending.slots_by_day && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", color: `rgba(${GOLD},0.7)` }}>
                Timings
              </span>
              {pending.days.map((k) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "rgba(240,223,200,0.65)" }}>{DAY_LABELS[k] ?? k}</span>
                  <span>{pending.slots_by_day?.[k] ?? "—"}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{
            marginTop: 6, paddingTop: 10,
            borderTop: "1px dashed rgba(240,223,200,0.12)",
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
          }}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 14, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Total
            </span>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 500 }}>
              ₹{pending.total}
            </span>
          </div>
        </div>

        {saveState === "saved" ? (
          <div style={{
            marginTop: 32,
            padding: 24,
            border: "1px solid rgba(34,197,94,0.5)",
            background: "rgba(34,197,94,0.08)",
            borderRadius: 12,
          }}>
            <p style={{ fontFamily: "var(--font-heading)", fontSize: 22, fontWeight: 400, color: "#bbf7d0" }}>
              Subscription confirmed ✓
            </p>
            <p style={{ marginTop: 8, fontFamily: "var(--font-body)", fontSize: 13, color: "rgba(240,223,200,0.7)" }}>
              Thanks {name.trim() || "there"} — we&apos;ll be in touch on {phone.trim()} to finalise your delivery schedule.
            </p>
            <button
              type="button"
              onClick={() => router.push("/")}
              style={{
                marginTop: 18,
                padding: "12px 18px",
                border: `1px solid rgba(${GOLD},0.6)`,
                background: "transparent",
                color: `rgba(${GOLD},0.95)`,
                fontFamily: "var(--font-body)", fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              Back to home →
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Full Name *" value={name} onChange={setName} />
            <Field label="Phone Number *" value={phone} onChange={setPhone} type="tel" />
            <Field label="Delivery Address *" value={address} onChange={setAddress} multiline />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 14 }}>
              <Field label="City" value={city} onChange={setCity} />
              <Field label="Pincode" value={pincode} onChange={setPincode} />
            </div>

            {error && (
              <p style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "#fca5a5" }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={saveState === "saving"}
              style={{
                marginTop: 8,
                padding: "16px 18px",
                background: `rgba(${GOLD},0.18)`,
                border: `1px solid rgba(${GOLD},0.75)`,
                borderRadius: 10,
                fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 400,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: "#FBF3D4",
                cursor: saveState === "saving" ? "default" : "pointer",
                opacity: saveState === "saving" ? 0.6 : 1,
                transition: "opacity 200ms ease",
              }}
            >
              {saveState === "saving" ? "Confirming…" : "Confirm subscription"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", color: `rgba(${GOLD},0.7)` }}>
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "#f5f0e8" }}>
        {value}
      </span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  multiline?: boolean;
}) {
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    background: "transparent",
    border: `1px solid rgba(${GOLD},0.3)`,
    borderRadius: 8,
    color: "#FBF3D4",
    fontFamily: "var(--font-body)",
    fontSize: 14,
    letterSpacing: "0.02em",
    outline: "none",
  };
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{
        fontFamily: "var(--font-body)", fontSize: 10,
        letterSpacing: "0.3em", textTransform: "uppercase",
        color: `rgba(${GOLD},0.7)`,
      }}>
        {label}
      </span>
      {multiline ? (
        <textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      )}
    </label>
  );
}
