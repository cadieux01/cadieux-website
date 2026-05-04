"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DAY_LABEL,
  GOLD,
  SUB_STATUS_LABEL,
  formatDate,
} from "@/lib/subscription-ui";

type Sub = {
  id: string;
  product_name: string;
  quantity_per_delivery: number;
  frequency: string;
  day_of_week: string;
  time_slot: string;
  total_weeks: number;
  total_amount: number;
  status: string;
  created_at: string;
};

const BG = "#0e0e0e";

export default function PastPage() {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");

  useEffect(() => {
    const p = typeof window !== "undefined" ? localStorage.getItem("cadieux_phone") : "";
    setPhone(p ?? "");
  }, []);

  useEffect(() => {
    if (!phone) {
      setLoading(false);
      return;
    }
    (async () => {
      const r = await fetch(
        `/api/subscriptions/past?phone=${encodeURIComponent(phone)}`
      );
      const j = await r.json().catch(() => ({}));
      setSubs(j.subscriptions ?? []);
      setLoading(false);
    })();
  }, [phone]);

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: BG,
        color: "#FBF3D4",
        padding: "60px 20px 100px",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 32 }}>
          <h1 style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: "clamp(28px,5vw,42px)", margin: 0 }}>
            Past subscriptions
          </h1>
          <Link href="/subscriptions/track" style={{ fontSize: 13, color: GOLD }}>
            Active plans →
          </Link>
        </div>

        {loading && <div style={{ color: "rgba(240,223,200,0.5)" }}>Loading…</div>}

        {!loading && subs.length === 0 && (
          <div
            style={{
              padding: "40px 24px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(240,223,200,0.1)",
              borderRadius: 14,
              textAlign: "center",
              color: "rgba(240,223,200,0.6)",
            }}
          >
            No past subscriptions yet.
          </div>
        )}

        <div style={{ display: "grid", gap: 14 }}>
          {subs.map((s) => (
            <div
              key={s.id}
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(240,223,200,0.1)",
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 500 }}>
                    {s.product_name} × {s.quantity_per_delivery}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 13, color: "rgba(240,223,200,0.6)" }}>
                    {s.frequency === "bi-weekly" ? "Every 2 weeks" : "Weekly"} ·{" "}
                    {DAY_LABEL[s.day_of_week] ?? s.day_of_week} · {s.time_slot}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "rgba(240,223,200,0.5)" }}>
                    Started {formatDate(s.created_at.slice(0, 10))} · {s.total_weeks} weeks
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "4px 10px",
                      borderRadius: 999,
                      fontSize: 11,
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      color: s.status === "completed" ? GOLD : "#ff8181",
                      border: `1px solid ${s.status === "completed" ? GOLD : "#ff8181"}`,
                    }}
                  >
                    {SUB_STATUS_LABEL[s.status] ?? s.status}
                  </span>
                  <div style={{ marginTop: 8, fontSize: 13, color: "rgba(240,223,200,0.5)" }}>
                    ₹{Number(s.total_amount).toLocaleString("en-IN")}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
