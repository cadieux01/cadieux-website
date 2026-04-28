"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PRODUCTS } from "@/lib/data";

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const GOLD = "201,169,110";

type Step = "intro" | "weeks" | "days" | "time" | "summary";

const WEEK_OPTIONS = [
  { weeks: 1, label: "1 Week", sub: "Single trial run" },
  { weeks: 2, label: "2 Weeks", sub: "Short commitment" },
  { weeks: 4, label: "4 Weeks", sub: "One full month" },
  { weeks: 8, label: "8 Weeks", sub: "Two months" },
  { weeks: 12, label: "12 Weeks", sub: "A full quarter" },
];

const DAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

// 2-hour delivery windows from 6 AM to 8 PM
const SLOTS = [
  "6:00 – 8:00 AM",
  "8:00 – 10:00 AM",
  "10:00 AM – 12:00 PM",
  "12:00 – 2:00 PM",
  "2:00 – 4:00 PM",
  "4:00 – 6:00 PM",
  "6:00 – 8:00 PM",
];

export default function SubscriptionPage() {
  return (
    <Suspense fallback={null}>
      <SubscriptionInner />
    </Suspense>
  );
}

function SubscriptionInner() {
  const searchParams = useSearchParams();
  const slug = searchParams.get("slug");
  const product = useMemo(() => PRODUCTS.find((p) => p.slug === slug) || null, [slug]);

  // If a product was passed in via query, jump straight into the wizard.
  const [step, setStep] = useState<Step>(product ? "weeks" : "intro");
  const [weeks, setWeeks] = useState<number | null>(null);
  const [days, setDays] = useState<string[]>([]);
  const [slot, setSlot] = useState<string | null>(null);

  function toggleDay(key: string) {
    setDays((prev) => (prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key]));
  }

  function reset() {
    setStep(product ? "weeks" : "intro");
    setWeeks(null);
    setDays([]);
    setSlot(null);
  }

  const stepIndex = { intro: 0, weeks: 1, days: 2, time: 3, summary: 4 }[step];

  const dayLabels = days
    .map((k) => DAYS.find((d) => d.key === k)?.label || "")
    .filter(Boolean);

  // Running total: variant price × delivery days per week × number of weeks.
  const total = product && weeks ? product.price * days.length * weeks : 0;
  const perWeek = product ? product.price * days.length : 0;

  return (
    <div style={{ minHeight: "100dvh", background: "rgb(6,4,2)", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      <Link href="/" style={{
        position: "fixed", top: 24, left: 20, zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#4369B2", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(24px,6vw,80px) 120px", maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 12px", fontFamily: "var(--font-heading)", fontSize: "clamp(48px,11vw,88px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>
          Subscription
        </h1>
        <p style={{ margin: "0 0 28px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.5)" }}>
          {product ? product.tag : "Recurring deliveries"}
        </p>

        {/* Variant header — shown when a product was passed via query */}
        {product && step !== "intro" && (
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
            padding: "14px 16px",
            background: "#0a0805",
            border: `0.5px solid rgba(${GOLD},0.35)`,
            borderRadius: 12,
            marginBottom: 22,
            gap: 12,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 400, color: "#FBF3D4", letterSpacing: "0.01em" }}>
                {product.title}
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.25em", textTransform: "uppercase", color: `rgba(${GOLD},0.7)`, marginTop: 4 }}>
                ₹{product.price} per loaf
              </div>
            </div>
            <Link href={`/shop/${product.slug}`} style={{
              fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300,
              letterSpacing: "0.3em", textTransform: "uppercase",
              color: "rgba(240,223,200,0.5)", textDecoration: "none",
              flexShrink: 0,
            }}>
              Change →
            </Link>
          </div>
        )}

        {/* Progress dots */}
        {step !== "intro" && (
          <div style={{ display: "flex", gap: 8, marginBottom: 28, alignItems: "center" }}>
            {["weeks", "days", "time", "summary"].map((s, i) => {
              const active = stepIndex - 1 >= i;
              return (
                <div key={s} style={{
                  flex: 1, height: 2,
                  background: active ? `rgba(${GOLD},0.85)` : "rgba(240,223,200,0.12)",
                  transition: "background 280ms ease",
                  borderRadius: 2,
                }} />
              );
            })}
          </div>
        )}

        {/* INTRO */}
        {step === "intro" && (
          <>
            <p style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "rgba(240,223,200,0.55)", lineHeight: 1.7, margin: "0 0 28px" }}>
              Cadieux loaves at your door, fresh on the days that suit you. Pick a duration, choose your delivery days, and lock in a 2-hour window.
            </p>
            <button
              type="button"
              onClick={() => setStep("weeks")}
              className="cdx-sub-cta"
              style={{
                display: "inline-flex", alignItems: "center", gap: 10,
                background: `rgba(${GOLD},0.1)`,
                border: `1px solid rgba(${GOLD},0.6)`,
                borderRadius: 10,
                padding: "14px 28px",
                fontFamily: "var(--font-body)",
                fontSize: 11, fontWeight: 400,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: `rgba(${GOLD},0.95)`,
                cursor: "pointer",
                transition: "background 200ms ease, border-color 200ms ease, color 200ms ease",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Subscribe <span aria-hidden="true">→</span>
            </button>
          </>
        )}

        {/* STEP 1 — WEEKS */}
        {step === "weeks" && (
          <Section
            title="How many weeks?"
            sub="Pick a subscription length"
            onBack={() => setStep(product ? "intro" : "intro")}
          >
            {WEEK_OPTIONS.map(({ weeks: w, label, sub }) => (
              <OptionRow
                key={w}
                selected={weeks === w}
                onClick={() => { setWeeks(w); setStep("days"); }}
                title={label}
                sub={sub}
              />
            ))}
          </Section>
        )}

        {/* STEP 2 — DAYS */}
        {step === "days" && (
          <Section
            title="Which days?"
            sub={`Delivery days across all ${weeks} ${weeks === 1 ? "week" : "weeks"}`}
            onBack={() => setStep("weeks")}
          >
            {DAYS.map(({ key, label }) => {
              const active = days.includes(key);
              return (
                <OptionRow
                  key={key}
                  selected={active}
                  onClick={() => toggleDay(key)}
                  title={label}
                  sub={active ? "Selected" : "Tap to select"}
                  multi
                />
              );
            })}

            {/* Running total — only when a product was passed in */}
            {product && (
              <div style={{
                marginTop: 10,
                padding: "16px 18px",
                background: `rgba(${GOLD},0.08)`,
                border: `1px solid rgba(${GOLD},0.45)`,
                borderRadius: 12,
                display: "flex", flexDirection: "column", gap: 6,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.3em", textTransform: "uppercase", color: `rgba(${GOLD},0.75)` }}>
                    Per week
                  </span>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "#f5f0e8" }}>
                    ₹{perWeek}
                    <span style={{ color: "rgba(240,223,200,0.45)", fontSize: 10, marginLeft: 6, letterSpacing: "0.1em" }}>
                      {days.length > 0 ? `(${days.length} × ₹${product.price})` : ""}
                    </span>
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: 10, borderTop: "1px dashed rgba(240,223,200,0.12)" }}>
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: 14, fontWeight: 400, letterSpacing: "0.05em", color: "#FBF3D4", textTransform: "uppercase" }}>
                    Total ({weeks} {weeks === 1 ? "wk" : "wks"})
                  </span>
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 500, color: "#FBF3D4", letterSpacing: "0.01em" }}>
                    ₹{total}
                  </span>
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={days.length === 0}
              onClick={() => setStep("time")}
              className="cdx-sub-next"
              style={{
                marginTop: 16,
                width: "100%",
                background: days.length === 0 ? "transparent" : `rgba(${GOLD},0.12)`,
                border: `1px solid rgba(${GOLD},${days.length === 0 ? 0.25 : 0.65})`,
                borderRadius: 10,
                padding: "14px 18px",
                fontFamily: "var(--font-body)",
                fontSize: 11, fontWeight: 400,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: days.length === 0 ? "rgba(240,223,200,0.3)" : `rgba(${GOLD},0.95)`,
                cursor: days.length === 0 ? "not-allowed" : "pointer",
                transition: "background 200ms ease, border-color 200ms ease, color 200ms ease",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Continue {days.length > 0 && `· ${days.length} ${days.length === 1 ? "day" : "days"}`} →
            </button>
          </Section>
        )}

        {/* STEP 3 — TIME */}
        {step === "time" && (
          <Section
            title="Pick a delivery window"
            sub="Each slot is a 2-hour period"
            onBack={() => setStep("days")}
          >
            {SLOTS.map((s) => (
              <OptionRow
                key={s}
                selected={slot === s}
                onClick={() => { setSlot(s); setStep("summary"); }}
                title={s}
                sub="2-hour window"
              />
            ))}
          </Section>
        )}

        {/* STEP 4 — SUMMARY */}
        {step === "summary" && (
          <Section
            title="Review"
            sub="Confirm your subscription"
            onBack={() => setStep("time")}
          >
            {product && <SummaryRow label="Bread" value={`${product.title} · ₹${product.price}`} />}
            <SummaryRow label="Duration" value={`${weeks} ${weeks === 1 ? "week" : "weeks"}`} />
            <SummaryRow label="Days" value={dayLabels.join(", ")} />
            <SummaryRow label="Window" value={slot || ""} />
            {product && (
              <div style={{
                marginTop: 8,
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                padding: "16px 0",
              }}>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 16, fontWeight: 400, letterSpacing: "0.05em", color: "#FBF3D4", textTransform: "uppercase" }}>
                  Total
                </span>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 32, fontWeight: 500, color: "#FBF3D4", letterSpacing: "0.01em" }}>
                  ₹{total}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => alert("Subscription saved. We'll be in touch.")}
              style={{
                marginTop: 16,
                width: "100%",
                background: `rgba(${GOLD},0.18)`,
                border: `1px solid rgba(${GOLD},0.75)`,
                borderRadius: 10,
                padding: "16px 18px",
                fontFamily: "var(--font-body)",
                fontSize: 11, fontWeight: 400,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: "#FBF3D4",
                cursor: "pointer",
                transition: "background 200ms ease, border-color 200ms ease",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Confirm subscription
            </button>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: 10,
                width: "100%",
                background: "transparent",
                border: "1px solid rgba(240,223,200,0.15)",
                borderRadius: 10,
                padding: "12px 18px",
                fontFamily: "var(--font-body)",
                fontSize: 10, fontWeight: 300,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: "rgba(240,223,200,0.5)",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Start over
            </button>
          </Section>
        )}
      </div>

      <style>{`
        .cdx-sub-cta:hover { background: rgba(${GOLD},0.18) !important; border-color: rgba(${GOLD},0.9) !important; color: #FBF3D4 !important; }
        .cdx-sub-row:hover { background: rgba(${GOLD},0.06) !important; border-color: rgba(${GOLD},0.7) !important; }
        .cdx-sub-next:hover:not(:disabled) { background: rgba(${GOLD},0.2) !important; border-color: rgba(${GOLD},0.9) !important; color: #FBF3D4 !important; }
        .cdx-sub-back:hover { color: rgba(${GOLD},0.95) !important; }
      `}</style>
    </div>
  );
}

/* ── Step shell with title + back link ── */
function Section({ title, sub, onBack, children }: { title: string; sub: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="cdx-sub-back"
        style={{
          background: "transparent", border: "none", cursor: "pointer",
          padding: 0, marginBottom: 18,
          fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300,
          letterSpacing: "0.3em", textTransform: "uppercase",
          color: "rgba(240,223,200,0.45)",
          display: "inline-flex", alignItems: "center", gap: 8,
          transition: "color 200ms ease",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span aria-hidden="true">←</span> Back
      </button>

      <h2 style={{ margin: "0 0 6px", fontFamily: "var(--font-heading)", fontSize: 28, fontWeight: 400, color: "#FBF3D4", letterSpacing: "0.01em" }}>
        {title}
      </h2>
      <p style={{ margin: "0 0 22px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(240,223,200,0.4)" }}>
        {sub}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

/* ── A single tappable row card ── */
function OptionRow({ title, sub, selected, onClick, multi = false }: {
  title: string; sub: string; selected: boolean; onClick: () => void; multi?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cdx-sub-row"
      style={{
        width: "100%",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        background: selected ? `rgba(${GOLD},0.1)` : "#0a0805",
        border: `1px solid rgba(${GOLD},${selected ? 0.85 : 0.4})`,
        borderRadius: 12,
        padding: "16px 20px",
        cursor: "pointer",
        textAlign: "left",
        color: "#f5f0e8",
        transition: "background 200ms ease, border-color 200ms ease",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 400, color: "#f5f0e8", letterSpacing: "0.01em" }}>
          {title}
        </span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, color: "#8a7a5a", letterSpacing: "0.18em", textTransform: "uppercase" }}>
          {sub}
        </span>
      </span>
      <span aria-hidden="true" style={{
        flexShrink: 0,
        width: 20, height: 20,
        borderRadius: multi ? 4 : "50%",
        border: `1px solid rgba(${GOLD},${selected ? 0.95 : 0.4})`,
        background: selected ? `rgba(${GOLD},0.95)` : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background 200ms ease, border-color 200ms ease",
      }}>
        {selected && (
          <span style={{ color: "#0a0805", fontSize: 12, lineHeight: 1, fontWeight: 600 }}>✓</span>
        )}
      </span>
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      padding: "14px 0",
      borderBottom: "1px solid rgba(240,223,200,0.08)",
      gap: 16,
    }}>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.3em", textTransform: "uppercase", color: `rgba(${GOLD},0.7)` }}>
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 300, color: "#f5f0e8", textAlign: "right", letterSpacing: "0.02em" }}>
        {value}
      </span>
    </div>
  );
}
