"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const GOLD = "#c9a96e";
const BG = "#0e0e0e";

type Sub = { id: string; status: string };

export default function SubscriptionHub() {
  const [activeCount, setActiveCount] = useState<number | null>(null);

  useEffect(() => {
    const phone =
      typeof window !== "undefined" ? localStorage.getItem("cadieux_phone") : "";
    if (!phone) {
      setActiveCount(0);
      return;
    }
    fetch(`/api/subscriptions?phone=${encodeURIComponent(phone)}`)
      .then((r) => r.json())
      .then((j: { subscriptions?: Sub[] }) => {
        setActiveCount((j.subscriptions ?? []).length);
      })
      .catch(() => setActiveCount(0));
  }, []);

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: BG,
        color: "#FBF3D4",
        padding: "80px 20px 120px",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 300,
            fontSize: "clamp(32px,6vw,52px)",
            margin: "0 0 12px",
          }}
        >
          Subscriptions
        </h1>
        <p
          style={{
            margin: "0 0 40px",
            color: "rgba(240,223,200,0.6)",
            fontSize: 16,
            lineHeight: 1.6,
          }}
        >
          Set bread on autopilot. Pick a frequency, a day, a time — we'll do the rest.
        </p>

        <div style={{ display: "grid", gap: 16 }}>
          <HubCard
            href="/subscriptions/setup/product"
            title="Start a new plan"
            body="Pick your loaf, choose how often, and we'll show up like clockwork."
            cta="Begin →"
            primary
          />
          <HubCard
            href="/subscriptions/track"
            title="Track active deliveries"
            body={
              activeCount === null
                ? "Live status of every upcoming delivery."
                : activeCount > 0
                  ? `${activeCount} active plan${activeCount === 1 ? "" : "s"}.`
                  : "No active plans yet."
            }
            cta="Open →"
          />
          <HubCard
            href="/subscriptions/past"
            title="Past subscriptions"
            body="Completed and cancelled plans."
            cta="View →"
          />
        </div>
      </div>
    </main>
  );
}

function HubCard({
  href,
  title,
  body,
  cta,
  primary,
}: {
  href: string;
  title: string;
  body: string;
  cta: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: "24px 24px",
        background: primary ? "rgba(201,169,110,0.10)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${primary ? GOLD : "rgba(240,223,200,0.12)"}`,
        borderRadius: 16,
        color: "#FBF3D4",
        textDecoration: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 500 }}>{title}</div>
          <div style={{ marginTop: 6, fontSize: 14, color: "rgba(240,223,200,0.6)" }}>
            {body}
          </div>
        </div>
        <div style={{ fontSize: 13, color: GOLD, whiteSpace: "nowrap" }}>{cta}</div>
      </div>
    </Link>
  );
}
