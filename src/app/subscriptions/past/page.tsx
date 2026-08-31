"use client";

// History view of every subscription the customer has ever placed:
// active, completed, and cancelled. Active rows link to /subscriptions/track
// for live timeline; completed/cancelled rows are read-only.

import { useEffect, useState } from "react";
import Link from "next/link";
import { GOLD, formatDate } from "@/lib/subscription-ui";

type Sub = {
  id: string;
  product_name: string;
  quantity_per_delivery: number;
  total_amount: number;
  status: string;
  created_at: string;
  deliveries_count: number;
};

const BG = "#C0C8CE";
const GREEN = "#024628";
const RED = "#991B1B";
const TEXT = "#024628";
const FADED = "rgba(2,70,40,0.6)";
const FAINT = "rgba(2,70,40,0.2)";

type Tone = { label: string; color: string };

function statusTone(status: string): Tone {
  const s = (status || "").toLowerCase();
  if (s === "completed") return { label: "Completed", color: GREEN };
  if (s === "cancelled") return { label: "Cancelled", color: RED };
  // Anything else (active / pending_confirmation / paused / etc.) reads as live.
  return { label: "Active", color: GOLD };
}

function isActive(status: string): boolean {
  const s = (status || "").toLowerCase();
  return s !== "completed" && s !== "cancelled";
}

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
        `/api/subscriptions/past?phone=${encodeURIComponent(phone)}`,
        { cache: "no-store" }
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
        color: TEXT,
        padding: "60px 20px 100px",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <h1 style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: "clamp(28px,5vw,42px)", margin: 0 }}>
            Subscription history
          </h1>
          <Link href="/subscription" style={{ fontSize: 16, color: GOLD, textDecoration: "none" }}>
            ← Hub
          </Link>
        </div>
        <p style={{ marginTop: 0, marginBottom: 32, fontSize: 16, color: FADED }}>
          Every plan you&apos;ve placed — active, completed, and cancelled.
        </p>

        {loading && <div style={{ color: "rgba(240,223,200,0.5)" }}>Loading…</div>}

        {!loading && subs.length === 0 && (
          <div
            style={{
              padding: "40px 24px",
              background: "rgba(2,70,40,0.03)",
              border: `1px solid ${FAINT}`,
              borderRadius: 14,
              textAlign: "center",
              color: FADED,
            }}
          >
            No subscriptions yet.
          </div>
        )}

        <div style={{ display: "grid", gap: 14 }}>
          {subs.map((s) => {
            const tone = statusTone(s.status);
            const active = isActive(s.status);
            const inner = (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "baseline",
                }}
              >
                <div>
                  <div style={{ fontSize: 16, fontWeight: 500, color: TEXT }}>
                    {s.product_name} × {s.quantity_per_delivery}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 16, color: FADED }}>
                    Placed {formatDate(s.created_at.slice(0, 10))} ·{" "}
                    {s.deliveries_count}{" "}
                    {s.deliveries_count === 1 ? "delivery" : "deliveries"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "4px 10px",
                      borderRadius: 999,
                      fontSize: 14,
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      color: tone.color,
                      border: `1px solid ${tone.color}`,
                    }}
                  >
                    {tone.label}
                  </span>
                  <div style={{ marginTop: 8, fontSize: 16, color: "rgba(240,223,200,0.5)" }}>
                    ₹{Number(s.total_amount).toLocaleString("en-IN")}
                  </div>
                </div>
              </div>
            );

            const cardStyle: React.CSSProperties = {
              background: "rgba(2,70,40,0.03)",
              border: `1px solid ${FAINT}`,
              borderRadius: 14,
              padding: 20,
              textDecoration: "none",
              color: TEXT,
              display: "block",
            };

            // Active subs are clickable → live tracker. Past subs are read-only.
            return active ? (
              <Link key={s.id} href="/subscriptions/track" style={cardStyle}>
                {inner}
              </Link>
            ) : (
              <div key={s.id} style={cardStyle}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
