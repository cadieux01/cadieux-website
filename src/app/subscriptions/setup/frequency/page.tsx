"use client";

import { useRouter } from "next/navigation";
import SetupShell, { optionCardStyle } from "../SetupShell";
import { FREQUENCIES } from "@/lib/subscription-draft";

export default function FrequencyStep() {
  const router = useRouter();
  return (
    <SetupShell
      step="frequency"
      title="How often?"
      subtitle="Pick how regularly we should drop off your bread."
      render={(draft, update) => ({
        canContinue: !!draft.frequency,
        onContinue: () => router.push("/subscriptions/setup/day"),
        body: (
          <div style={{ display: "grid", gap: 12 }}>
            {FREQUENCIES.map((f) => {
              const sel = draft.frequency === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => update({ frequency: f.key })}
                  style={optionCardStyle(sel)}
                >
                  <div style={{ fontSize: 17, fontWeight: 500 }}>{f.label}</div>
                  <div style={{ marginTop: 4, fontSize: 13, color: "rgba(240,223,200,0.6)" }}>
                    {f.helper}
                  </div>
                </button>
              );
            })}
          </div>
        ),
      })}
    />
  );
}
