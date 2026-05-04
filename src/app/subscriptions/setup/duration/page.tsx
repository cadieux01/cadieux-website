"use client";

import { useRouter } from "next/navigation";
import SetupShell, { GOLD, optionCardStyle } from "../SetupShell";
import { DURATION_OPTIONS, draftTotal } from "@/lib/subscription-draft";

export default function DurationStep() {
  const router = useRouter();
  return (
    <SetupShell
      step="duration"
      title="How long?"
      subtitle="Total weeks for your plan. You can cancel anytime — billing matches the run length you choose."
      render={(draft, update) => ({
        canContinue: !!draft.total_weeks,
        onContinue: () => router.push("/subscriptions/setup/time-slot"),
        body: (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            {DURATION_OPTIONS.map((w) => {
              const sel = draft.total_weeks === w;
              const projected = (() => {
                const probe = { ...draft, total_weeks: w };
                return draftTotal(probe);
              })();
              return (
                <button
                  key={w}
                  onClick={() => update({ total_weeks: w })}
                  style={optionCardStyle(sel)}
                >
                  <div style={{ fontSize: 16, fontWeight: 500 }}>{w} weeks</div>
                  <div style={{ marginTop: 4, fontSize: 13, color: GOLD }}>
                    ₹{projected.toLocaleString("en-IN")}
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
