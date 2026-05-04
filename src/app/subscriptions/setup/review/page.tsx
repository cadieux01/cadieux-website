"use client";

import { useRouter } from "next/navigation";
import SetupShell, { GOLD } from "../SetupShell";
import { PRODUCTS } from "@/lib/data";
import {
  DAY_OPTIONS,
  FREQUENCIES,
  draftTotal,
  firstIncompleteStep,
} from "@/lib/subscription-draft";

const ROW: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  padding: "12px 0",
  borderBottom: "1px solid rgba(240,223,200,0.08)",
};
const KEY: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "rgba(240,223,200,0.55)",
};
const VAL: React.CSSProperties = { fontSize: 15, color: "#FBF3D4", textAlign: "right" };

export default function ReviewStep() {
  const router = useRouter();
  return (
    <SetupShell
      step="review"
      title="Review your plan"
      subtitle="Last check before checkout. You can go back to edit any step."
      nextLabel="Go to checkout →"
      render={(draft) => {
        const product = PRODUCTS.find((p) => p.slug === draft.product_slug);
        const day = DAY_OPTIONS.find((d) => d.key === draft.day_of_week);
        const freq = FREQUENCIES.find((f) => f.key === draft.frequency);
        const total = draftTotal(draft);
        const incomplete = firstIncompleteStep(draft);
        return {
          canContinue: incomplete === null,
          onContinue: () => router.push("/subscriptions/setup/checkout"),
          body: (
            <div>
              <div style={{ display: "grid", gap: 0 }}>
                <div style={ROW}>
                  <span style={KEY}>Product</span>
                  <span style={VAL}>
                    {product?.name ?? "—"} × {draft.quantity_per_delivery}
                  </span>
                </div>
                <div style={ROW}>
                  <span style={KEY}>Frequency</span>
                  <span style={VAL}>{freq?.label ?? "—"}</span>
                </div>
                <div style={ROW}>
                  <span style={KEY}>Day</span>
                  <span style={VAL}>{day?.label ?? "—"}</span>
                </div>
                <div style={ROW}>
                  <span style={KEY}>Time</span>
                  <span style={VAL}>{draft.time_slot ?? "—"}</span>
                </div>
                <div style={ROW}>
                  <span style={KEY}>Duration</span>
                  <span style={VAL}>{draft.total_weeks ?? "—"} weeks</span>
                </div>
                <div style={ROW}>
                  <span style={KEY}>Address</span>
                  <span style={VAL}>
                    {draft.address.line1}
                    {draft.address.line2 ? `, ${draft.address.line2}` : ""}
                    <br />
                    {draft.address.city} — {draft.address.pincode}
                    <br />
                    {draft.address.name} · {draft.address.phone}
                  </span>
                </div>
                <div style={{ ...ROW, borderBottom: "none", marginTop: 8 }}>
                  <span style={{ ...KEY, color: GOLD }}>Total</span>
                  <span style={{ ...VAL, fontSize: 22, color: GOLD }}>
                    ₹{total.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>
              {incomplete && (
                <div style={{ marginTop: 16, fontSize: 13, color: "#ff9b9b" }}>
                  Missing: {incomplete}.{" "}
                  <button
                    onClick={() => router.push(`/subscriptions/setup/${incomplete}`)}
                    style={{
                      background: "none",
                      border: "none",
                      color: GOLD,
                      textDecoration: "underline",
                      cursor: "pointer",
                      padding: 0,
                      font: "inherit",
                    }}
                  >
                    Fix it
                  </button>
                </div>
              )}
            </div>
          ),
        };
      }}
    />
  );
}
