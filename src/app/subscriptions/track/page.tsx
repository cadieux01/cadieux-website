"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  DAY_LABEL,
  DELIVERY_STATUS_COLOR,
  DELIVERY_STATUS_LABEL,
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
  next_delivery_date: string | null;
};

type Delivery = {
  id: string;
  week_number: number;
  scheduled_date: string;
  scheduled_time_slot: string;
  status: string;
};

const BG = "#024628";

function readPhone(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("cadieux_phone") ?? "";
}

// Mapping from delivery status to step index (1-4) on the 4-step timeline.
function statusStep(status: string): number {
  switch (status) {
    case "delivered":
      return 4;
    case "out_for_delivery":
      return 3;
    case "confirmed":
      return 2;
    case "pending_confirmation":
    default:
      return 1;
  }
}

const MS_DAY = 86_400_000;

/** Mirrors classifyEdit() on the detail page. Drives the per-card icon hint. */
type EditMode = "direct" | "request" | "terminal";
function classifyEdit(d: { status: string; scheduled_date: string }): EditMode {
  if (
    d.status === "out_for_delivery" ||
    d.status === "delivered" ||
    d.status === "cancelled"
  ) {
    return "terminal";
  }
  const [y, mo, dd] = d.scheduled_date.split("-").map(Number);
  const sched = y && mo && dd ? new Date(y, mo - 1, dd) : null;
  const tooSoon = sched ? sched.getTime() - Date.now() < MS_DAY : true;
  return tooSoon ? "request" : "direct";
}

export default function TrackPage() {
  const [phone, setPhone] = useState<string>("");
  const [subs, setSubs] = useState<Sub[]>([]);
  const [deliveriesBySub, setDeliveriesBySub] = useState<Record<string, Delivery[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPhone(readPhone());
  }, []);

  const fetchSubs = useCallback(async () => {
    if (!phone) {
      setLoading(false);
      return;
    }
    const r = await fetch(
      `/api/subscriptions?phone=${encodeURIComponent(phone)}`,
      { cache: "no-store" }
    );
    const j = await r.json().catch(() => ({}));
    const list: Sub[] = j.subscriptions ?? [];
    setSubs(list);
    setLoading(false);

    // Fetch deliveries for every active sub in parallel.
    const map: Record<string, Delivery[]> = {};
    await Promise.all(
      list.map(async (s) => {
        const dr = await fetch(
          `/api/subscriptions/${s.id}?phone=${encodeURIComponent(phone)}`,
          { cache: "no-store" }
        );
        const dj = await dr.json().catch(() => ({}));
        map[s.id] = dj.deliveries ?? [];
      })
    );
    setDeliveriesBySub(map);
  }, [phone]);

  useEffect(() => {
    fetchSubs();
    const t = setInterval(fetchSubs, 10_000);
    return () => clearInterval(t);
  }, [fetchSubs]);

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
      <Suspense fallback={null}>
        <PlacedToast />
      </Suspense>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 32,
          }}
        >
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 300,
              fontSize: "clamp(28px,5vw,42px)",
              margin: 0,
            }}
          >
            Your subscriptions
          </h1>
          <Link href="/subscriptions/past" style={{ fontSize: 13, color: GOLD }}>
            View past →
          </Link>
        </div>

        {loading && <div style={{ color: "rgba(240,223,200,0.5)" }}>Loading…</div>}

        {!loading && !phone && (
          <Empty
            title="Sign in with your phone first"
            body="We use your phone number to look up your active plans. Place an order or start a subscription to set up your phone."
          />
        )}

        {!loading && phone && subs.length === 0 && (
          <Empty
            title="No active plans yet"
            body="Start a subscription and never run out of bread."
            cta="Start a plan"
            href="/subscriptions/setup"
          />
        )}

        <div style={{ display: "grid", gap: 28 }}>
          {subs.map((s) => {
            const deliveries = deliveriesBySub[s.id] ?? [];
            return (
              <section
                key={s.id}
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(240,223,200,0.12)",
                  borderRadius: 14,
                  padding: 20,
                }}
              >
                <header
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontWeight: 300,
                        fontSize: 22,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {s.product_name} × {s.quantity_per_delivery}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 13,
                        color: "rgba(240,223,200,0.6)",
                      }}
                    >
                      {s.frequency === "bi-weekly" ? "Every 2 weeks" : "Weekly"} ·{" "}
                      {DAY_LABEL[s.day_of_week] ?? s.day_of_week} · {s.time_slot}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <Pill text={SUB_STATUS_LABEL[s.status] ?? s.status} color={GOLD} />
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 13,
                        color: "rgba(240,223,200,0.5)",
                      }}
                    >
                      {s.total_weeks} wk · ₹
                      {Number(s.total_amount).toLocaleString("en-IN")}
                    </div>
                  </div>
                </header>

                <div style={{ display: "grid", gap: 10 }}>
                  {deliveries.length === 0 && (
                    <div style={{ fontSize: 13, color: "rgba(240,223,200,0.5)" }}>
                      Loading deliveries…
                    </div>
                  )}
                  {deliveries.map((d) => (
                    <WeekCard key={d.id} delivery={d} />
                  ))}
                </div>

                <div
                  style={{
                    marginTop: 20,
                    display: "flex",
                    justifyContent: "flex-end",
                  }}
                >
                  <CancelButton subId={s.id} onCancelled={fetchSubs} />
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function WeekCard({ delivery }: { delivery: Delivery }) {
  const step = statusStep(delivery.status);
  const ringColor = DELIVERY_STATUS_COLOR[delivery.status] ?? "rgba(240,223,200,0.4)";
  const isCancelled = delivery.status === "cancelled";
  const label = DELIVERY_STATUS_LABEL[delivery.status] ?? delivery.status;
  const mode = classifyEdit(delivery);

  return (
    <Link
      href={`/subscriptions/track/${delivery.id}`}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(240,223,200,0.1)",
        borderRadius: 10,
        textDecoration: "none",
        color: "#FBF3D4",
        transition: "background 0.15s ease",
      }}
    >
      {mode !== "terminal" && (
        <span
          aria-hidden
          title={
            mode === "direct"
              ? "Edit anytime — tap to change date or time"
              : "Within 24 hours — admin must approve changes"
          }
          style={{
            position: "absolute",
            top: 8,
            right: 10,
            fontSize: 11,
            lineHeight: 1,
            color:
              mode === "direct"
                ? "rgba(201,169,110,0.85)"
                : "rgba(227,179,65,0.85)",
            letterSpacing: 0,
          }}
        >
          {mode === "direct" ? "✎" : "◷"}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 300,
            fontSize: 17,
            letterSpacing: "0.02em",
          }}
        >
          Week {delivery.week_number}
        </div>
        <div style={{ marginTop: 4, fontSize: 13, color: "rgba(240,223,200,0.6)" }}>
          {formatDate(delivery.scheduled_date)} · {delivery.scheduled_time_slot}
        </div>
        {!isCancelled && (
          <div style={{ marginTop: 8 }}>
            <ProgressBar step={step} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <Pill text={label} color={ringColor} />
      </div>
      <div
        aria-hidden
        style={{
          fontSize: 18,
          color: "rgba(240,223,200,0.4)",
          paddingLeft: 4,
        }}
      >
        ›
      </div>
    </Link>
  );
}

function ProgressBar({ step }: { step: number }) {
  // 4 dots — gold for done/current, faded for not-yet.
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            width: 28,
            height: 4,
            borderRadius: 2,
            background: i <= step ? GOLD : "rgba(240,223,200,0.12)",
          }}
        />
      ))}
    </div>
  );
}

function Empty({
  title,
  body,
  cta,
  href,
}: {
  title: string;
  body: string;
  cta?: string;
  href?: string;
}) {
  return (
    <div
      style={{
        padding: "40px 24px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(240,223,200,0.1)",
        borderRadius: 14,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 17, marginBottom: 8 }}>{title}</div>
      <div style={{ color: "rgba(240,223,200,0.6)", marginBottom: cta ? 20 : 0 }}>
        {body}
      </div>
      {cta && href && (
        <Link
          href={href}
          style={{
            display: "inline-block",
            padding: "12px 22px",
            background: GOLD,
            borderRadius: 999,
            color: "#0a0a0a",
            fontWeight: 600,
            fontSize: 14,
            textDecoration: "none",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          {cta}
        </Link>
      )}
    </div>
  );
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 11,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        color,
        border: `1px solid ${color}`,
      }}
    >
      {text}
    </span>
  );
}

function PlacedToast() {
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (searchParams.get("placed") !== "1") return;
    setVisible(true);
    // Strip ?placed=1 so a refresh doesn't replay the toast.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("placed");
      window.history.replaceState({}, "", url.pathname + (url.search || ""));
    }
    const t = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(t);
  }, [searchParams]);

  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 100,
        maxWidth: "calc(100vw - 32px)",
        padding: "12px 20px",
        borderRadius: 999,
        background: "rgba(201,169,110,0.12)",
        border: `1px solid ${GOLD}`,
        color: "#FBF3D4",
        fontSize: 13,
        fontFamily: "var(--font-body)",
        letterSpacing: "0.02em",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        backdropFilter: "blur(8px)",
      }}
    >
      Subscription placed successfully — your weekly plan is below.
    </div>
  );
}

function CancelButton({ subId, onCancelled }: { subId: string; onCancelled: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function doCancel() {
    setBusy(true);
    try {
      await fetch(`/api/subscriptions/${subId}/cancel`, { method: "POST" });
      onCancelled();
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  if (!confirmOpen) {
    return (
      <button
        onClick={() => setConfirmOpen(true)}
        style={{
          background: "transparent",
          border: "1px solid rgba(255,129,129,0.4)",
          borderRadius: 999,
          color: "#ff8181",
          padding: "8px 16px",
          fontSize: 12,
          cursor: "pointer",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        Cancel plan
      </button>
    );
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 13, color: "rgba(240,223,200,0.7)" }}>Are you sure?</span>
      <button
        onClick={() => setConfirmOpen(false)}
        style={{
          background: "transparent",
          border: "1px solid rgba(240,223,200,0.25)",
          borderRadius: 999,
          color: "#FBF3D4",
          padding: "6px 14px",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Keep
      </button>
      <button
        onClick={doCancel}
        disabled={busy}
        style={{
          background: "#ff8181",
          border: "none",
          borderRadius: 999,
          color: "#0a0a0a",
          padding: "6px 14px",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {busy ? "…" : "Cancel"}
      </button>
    </div>
  );
}
