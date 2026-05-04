"use client";

import { useRouter } from "next/navigation";
import SetupShell, { optionCardStyle } from "../SetupShell";
import { DAY_OPTIONS } from "@/lib/subscription-draft";

export default function DayStep() {
  const router = useRouter();
  return (
    <SetupShell
      step="day"
      title="Which day works?"
      subtitle="We'll deliver on this day every week (or every other week, depending on your frequency)."
      render={(draft, update) => ({
        canContinue: !!draft.day_of_week,
        onContinue: () => router.push("/subscriptions/setup/duration"),
        body: (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            {DAY_OPTIONS.map((d) => {
              const sel = draft.day_of_week === d.key;
              return (
                <button
                  key={d.key}
                  onClick={() => update({ day_of_week: d.key })}
                  style={optionCardStyle(sel)}
                >
                  <div style={{ fontSize: 16, fontWeight: 500 }}>{d.label}</div>
                </button>
              );
            })}
          </div>
        ),
      })}
    />
  );
}
