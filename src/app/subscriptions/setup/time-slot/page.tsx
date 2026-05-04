"use client";

import { useRouter } from "next/navigation";
import SetupShell, { optionCardStyle } from "../SetupShell";
import { TIME_SLOTS } from "@/lib/subscription-draft";

export default function TimeSlotStep() {
  const router = useRouter();
  return (
    <SetupShell
      step="time-slot"
      title="Pick a delivery window"
      subtitle="We'll arrive within this slot on your chosen day."
      render={(draft, update) => ({
        canContinue: !!draft.time_slot,
        onContinue: () => router.push("/subscriptions/setup/address"),
        body: (
          <div style={{ display: "grid", gap: 10 }}>
            {TIME_SLOTS.map((t) => {
              const sel = draft.time_slot === t;
              return (
                <button
                  key={t}
                  onClick={() => update({ time_slot: t })}
                  style={optionCardStyle(sel)}
                >
                  <div style={{ fontSize: 16, fontWeight: 500 }}>{t}</div>
                </button>
              );
            })}
          </div>
        ),
      })}
    />
  );
}
