"use client";

import { useRouter } from "next/navigation";
import { CSSProperties, ReactNode, useEffect, useState } from "react";
import {
  SETUP_STEPS,
  SetupStep,
  loadDraft,
  saveDraft,
  type SubscriptionDraft,
} from "@/lib/subscription-draft";

export const GOLD = "#c9a96e";
const BG = "#0e0e0e";

const STEP_LABELS: Record<SetupStep, string> = {
  product: "Product",
  frequency: "Frequency",
  day: "Day",
  duration: "Duration",
  "time-slot": "Time slot",
  address: "Address",
  review: "Review",
  checkout: "Checkout",
};

/**
 * Shared shell. Hydrates draft from sessionStorage, provides progress bar,
 * back button, and a primary CTA. Each step renders its own content via the
 * `render` prop.
 */
type Props = {
  step: SetupStep;
  title: string;
  subtitle?: string;
  canBack?: boolean;
  nextLabel?: string;
  hideNext?: boolean;
  render: (
    draft: SubscriptionDraft,
    update: (patch: Partial<SubscriptionDraft>) => void
  ) => {
    body: ReactNode;
    canContinue: boolean;
    onContinue: () => void | Promise<void>;
  };
};

export default function SetupShell({
  step,
  title,
  subtitle,
  canBack = true,
  nextLabel,
  hideNext,
  render,
}: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<SubscriptionDraft | null>(null);
  const idx = SETUP_STEPS.indexOf(step);

  useEffect(() => {
    setDraft(loadDraft());
  }, []);

  function update(patch: Partial<SubscriptionDraft>) {
    setDraft((prev) => {
      const cur = prev ?? loadDraft();
      const next = { ...cur, ...patch };
      saveDraft(next);
      return next;
    });
  }

  if (!draft) {
    return <main style={{ minHeight: "100dvh", background: BG }} />;
  }

  const { body, canContinue, onContinue } = render(draft, update);

  function back() {
    if (idx > 0) router.push(`/subscriptions/setup/${SETUP_STEPS[idx - 1]}`);
    else router.push("/subscription");
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: BG,
        color: "#FBF3D4",
        fontFamily: "var(--font-body)",
        padding: "80px 20px 120px",
      }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            {SETUP_STEPS.map((s, i) => (
              <div
                key={s}
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 2,
                  background: i <= idx ? GOLD : "rgba(240,223,200,0.12)",
                }}
              />
            ))}
          </div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: "rgba(240,223,200,0.5)",
            }}
          >
            Step {idx + 1} of {SETUP_STEPS.length} · {STEP_LABELS[step]}
          </div>
        </div>

        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 300,
            fontSize: "clamp(28px,5vw,42px)",
            margin: "0 0 8px",
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p style={{ margin: "0 0 32px", color: "rgba(240,223,200,0.65)", fontSize: 15, lineHeight: 1.6 }}>
            {subtitle}
          </p>
        )}

        <div style={{ marginBottom: 40 }}>{body}</div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          {canBack ? (
            <button
              onClick={back}
              style={{
                padding: "14px 22px",
                background: "transparent",
                border: "1px solid rgba(240,223,200,0.25)",
                borderRadius: 999,
                color: "#FBF3D4",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              ← Back
            </button>
          ) : (
            <span />
          )}
          {!hideNext && (
            <button
              onClick={() => onContinue()}
              disabled={!canContinue}
              style={{
                padding: "14px 28px",
                background: !canContinue ? "rgba(201,169,110,0.3)" : GOLD,
                border: "none",
                borderRadius: 999,
                color: "#0a0a0a",
                fontSize: 14,
                fontWeight: 600,
                cursor: !canContinue ? "not-allowed" : "pointer",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              {nextLabel ?? "Continue →"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

export const optionCardStyle = (selected: boolean): CSSProperties => ({
  textAlign: "left",
  padding: "16px 18px",
  background: selected ? "rgba(201,169,110,0.12)" : "rgba(255,255,255,0.03)",
  border: `1px solid ${selected ? GOLD : "rgba(240,223,200,0.15)"}`,
  borderRadius: 12,
  color: "#FBF3D4",
  cursor: "pointer",
  width: "100%",
  fontFamily: "inherit",
});

export const inputStyle: CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(240,223,200,0.18)",
  borderRadius: 10,
  color: "#FBF3D4",
  fontSize: 15,
  fontFamily: "inherit",
  outline: "none",
};

export const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 11,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: "rgba(240,223,200,0.55)",
  marginBottom: 6,
};
