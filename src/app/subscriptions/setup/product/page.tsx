"use client";

import { useRouter } from "next/navigation";
import SetupShell, { GOLD, optionCardStyle } from "../SetupShell";
import { PRODUCTS } from "@/lib/data";
import { QUANTITY_OPTIONS } from "@/lib/subscription-draft";

export default function ProductStep() {
  const router = useRouter();
  return (
    <SetupShell
      step="product"
      title="Pick your bread"
      subtitle="Choose the loaf and how many you want each delivery."
      canBack={false}
      render={(draft, update) => {
        const canContinue = !!draft.product_slug && draft.quantity_per_delivery >= 1;
        return {
          canContinue,
          onContinue: () => router.push("/subscriptions/setup/frequency"),
          body: (
            <>
              <div style={{ display: "grid", gap: 14 }}>
                {PRODUCTS.map((p) => {
                  const sel = draft.product_slug === p.slug;
                  return (
                    <button
                      key={p.slug}
                      onClick={() => update({ product_slug: p.slug })}
                      style={optionCardStyle(sel)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <div style={{ fontSize: 17, fontWeight: 500 }}>{p.name}</div>
                        <div style={{ fontSize: 14, color: GOLD }}>₹{p.price}</div>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 13, color: "rgba(240,223,200,0.6)" }}>
                        {p.subtitle}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div style={{ marginTop: 28 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(240,223,200,0.5)", marginBottom: 12 }}>
                  Loaves per delivery
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  {QUANTITY_OPTIONS.map((q) => {
                    const sel = draft.quantity_per_delivery === q;
                    return (
                      <button
                        key={q}
                        onClick={() => update({ quantity_per_delivery: q })}
                        style={{
                          width: 56, height: 56, borderRadius: 14,
                          background: sel ? GOLD : "rgba(255,255,255,0.04)",
                          color: sel ? "#0a0a0a" : "#FBF3D4",
                          border: `1px solid ${sel ? GOLD : "rgba(240,223,200,0.15)"}`,
                          cursor: "pointer", fontSize: 18, fontWeight: 600,
                        }}
                      >
                        {q}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ),
        };
      }}
    />
  );
}
