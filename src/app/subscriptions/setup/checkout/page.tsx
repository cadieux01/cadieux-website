"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SetupShell, { GOLD, inputStyle, labelStyle } from "../SetupShell";
import TurnstileWidget, { type TurnstileHandle } from "@/components/TurnstileWidget";
import {
  clearDraft,
  draftTotal,
  firstIncompleteStep,
} from "@/lib/subscription-draft";
import { PRODUCTS } from "@/lib/data";

export default function CheckoutStep() {
  const router = useRouter();

  // OTP / Turnstile state lives outside the SetupShell render closure, so we
  // hoist it here.
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string } | null>(null);

  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);
  const refreshTurnstile = () => {
    setTurnstileToken("");
    turnstileRef.current?.reset();
  };

  // Persist phone for /orders auto-lookup
  useEffect(() => {
    /* nothing on mount */
  }, []);

  return (
    <SetupShell
      step="checkout"
      title={done ? "Subscription confirmed" : "Confirm & pay"}
      subtitle={
        done
          ? "We'll text you before each delivery."
          : "Verify your phone and pay on delivery to start your plan."
      }
      hideNext={true}
      canBack={!done}
      render={(draft) => {
        const total = draftTotal(draft);
        const product = PRODUCTS.find((p) => p.slug === draft.product_slug);
        const incomplete = firstIncompleteStep(draft);

        async function sendOtp() {
          setError("");
          if (!turnstileToken) {
            setError("Please complete the verification first.");
            return;
          }
          if (!/^\d{10}$/.test(draft.address.phone.replace(/\D/g, "").slice(-10))) {
            setError("Enter a valid 10-digit phone in the address step.");
            return;
          }
          setBusy(true);
          try {
            const r = await fetch("/api/verify/send", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                phone: draft.address.phone,
                turnstileToken,
              }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error ?? "Failed to send code");
            setOtpSent(true);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to send code");
          } finally {
            refreshTurnstile();
            setBusy(false);
          }
        }

        async function verifyOtp() {
          setError("");
          setBusy(true);
          try {
            const r = await fetch("/api/verify/check", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ phone: draft.address.phone, code: otpCode }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error ?? "Invalid code");
            setOtpVerified(true);
            try {
              localStorage.setItem("cadieux_phone", draft.address.phone);
            } catch {
              /* ignore */
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : "Invalid code");
          } finally {
            setBusy(false);
          }
        }

        async function placeSubscription() {
          if (incomplete) {
            setError(`Please complete ${incomplete} step first.`);
            return;
          }
          if (!turnstileToken) {
            setError("Please complete the verification first.");
            return;
          }
          setBusy(true);
          setError("");
          try {
            // 1. Save customer
            const cr = await fetch("/api/checkout", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "save_customer",
                full_name: draft.address.name,
                phone: draft.address.phone,
                delivery_address: `${draft.address.line1}${draft.address.line2 ? ", " + draft.address.line2 : ""}, ${draft.address.city} - ${draft.address.pincode}`,
                city: draft.address.city,
              }),
            });
            const cj = await cr.json().catch(() => ({}));
            if (!cr.ok || !cj.customer?.id) {
              throw new Error(cj.error ?? "Failed to save customer");
            }

            // 2. Create subscription
            const sr = await fetch("/api/subscriptions", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                customer_id: cj.customer.id,
                product_slug: draft.product_slug,
                quantity_per_delivery: draft.quantity_per_delivery,
                frequency: draft.frequency,
                day_of_week: draft.day_of_week,
                time_slot: draft.time_slot,
                total_weeks: draft.total_weeks,
                delivery_address: draft.address,
                payment_method: draft.payment_method,
                turnstileToken,
              }),
            });
            const sj = await sr.json().catch(() => ({}));
            if (!sr.ok || !sj.subscription_id) {
              throw new Error(sj.error ?? "Failed to create subscription");
            }
            clearDraft();
            setDone({ id: sj.subscription_id });
          } catch (e) {
            setError(e instanceof Error ? e.message : "Something went wrong");
            refreshTurnstile();
          } finally {
            setBusy(false);
          }
        }

        if (done) {
          return {
            canContinue: false,
            onContinue: () => {},
            body: (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <div style={{ fontSize: 18, color: GOLD, marginBottom: 12 }}>
                  All set ✓
                </div>
                <div style={{ marginBottom: 24, color: "rgba(240,223,200,0.7)" }}>
                  Your subscription is active. We'll deliver every {draft.frequency === "bi-weekly" ? "two weeks" : "week"} on {draft.day_of_week}.
                </div>
                <button
                  onClick={() => router.push("/subscriptions/track")}
                  style={{
                    padding: "14px 28px",
                    background: GOLD,
                    border: "none",
                    borderRadius: 999,
                    color: "#0a0a0a",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  Track deliveries →
                </button>
              </div>
            ),
          };
        }

        return {
          canContinue: false,
          onContinue: () => {},
          body: (
            <div>
              <div style={{ marginBottom: 24, padding: 16, background: "rgba(255,255,255,0.03)", borderRadius: 12 }}>
                <div style={{ fontSize: 13, color: "rgba(240,223,200,0.7)" }}>
                  {product?.name} × {draft.quantity_per_delivery} · {draft.total_weeks} weeks
                </div>
                <div style={{ marginTop: 6, fontSize: 22, color: GOLD, fontWeight: 600 }}>
                  ₹{total.toLocaleString("en-IN")}
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: "rgba(240,223,200,0.5)" }}>
                  Pay on delivery (cash / UPI)
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Verification</label>
                <TurnstileWidget
                  ref={turnstileRef}
                  onVerify={(t) => setTurnstileToken(t)}
                  onExpire={() => setTurnstileToken("")}
                  theme="dark"
                />
              </div>

              {!otpVerified && (
                <>
                  {!otpSent ? (
                    <button
                      onClick={sendOtp}
                      disabled={busy || !turnstileToken}
                      style={{
                        width: "100%",
                        padding: "14px",
                        background: !turnstileToken ? "rgba(201,169,110,0.3)" : GOLD,
                        border: "none",
                        borderRadius: 999,
                        color: "#0a0a0a",
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: !turnstileToken ? "not-allowed" : "pointer",
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                      }}
                    >
                      {busy ? "Sending…" : `Send OTP to ${draft.address.phone}`}
                    </button>
                  ) : (
                    <div style={{ display: "grid", gap: 12 }}>
                      <div>
                        <label style={labelStyle}>OTP</label>
                        <input
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value)}
                          style={inputStyle}
                          placeholder="6-digit code"
                        />
                      </div>
                      <button
                        onClick={verifyOtp}
                        disabled={busy || otpCode.length < 4}
                        style={{
                          padding: "14px",
                          background: GOLD,
                          border: "none",
                          borderRadius: 999,
                          color: "#0a0a0a",
                          fontSize: 14,
                          fontWeight: 600,
                          cursor: "pointer",
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                        }}
                      >
                        {busy ? "Verifying…" : "Verify code"}
                      </button>
                    </div>
                  )}
                </>
              )}

              {otpVerified && (
                <button
                  onClick={placeSubscription}
                  disabled={busy || !turnstileToken}
                  style={{
                    width: "100%",
                    padding: "14px",
                    background: !turnstileToken ? "rgba(201,169,110,0.3)" : GOLD,
                    border: "none",
                    borderRadius: 999,
                    color: "#0a0a0a",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: !turnstileToken ? "not-allowed" : "pointer",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  {busy ? "Placing…" : `Confirm subscription · ₹${total.toLocaleString("en-IN")}`}
                </button>
              )}

              {error && (
                <div style={{ marginTop: 12, color: "#ff9b9b", fontSize: 13 }}>{error}</div>
              )}
            </div>
          ),
        };
      }}
    />
  );
}
