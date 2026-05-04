"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const GOLD = "201,169,110";

const DAY_LABELS: Record<string, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};

type Subscription = {
  id: string;
  bread_name: string | null;
  bread_price: number | null;
  weeks: number | null;
  days: string[] | null;
  slot_mode: string | null;
  slot: string | null;
  slots_by_day: Record<string, string> | null;
  total: number | null;
  customer_name: string | null;
  customer_address: string | null;
  status: string | null;
  created_at: string;
};

type Delivery = {
  id: string;
  subscription_id: string;
  sequence: number;
  week_number: number;
  day_key: string;
  slot: string | null;
  delivery_date: string;
  status: string;
  status_updated_at: string | null;
};

const STATUS_COLORS: Record<string, { dot: string; pill: string; bg: string }> = {
  pending:    { dot: "rgba(240,223,200,0.35)", pill: "rgba(240,223,200,0.55)", bg: "rgba(240,223,200,0.08)" },
  confirmed:  { dot: "#c9a96e",                pill: "#c9a96e",                bg: "rgba(201,169,110,0.12)" },
  dispatched: { dot: "#4a90e2",                pill: "#4a90e2",                bg: "rgba(74,144,226,0.12)" },
  delivered:  { dot: "#4ade80",                pill: "#4ade80",                bg: "rgba(74,222,128,0.12)" },
  cancelled:  { dot: "#e05a5a",                pill: "#e05a5a",                bg: "rgba(224,90,90,0.12)" },
};

function statusKey(s: string | null | undefined): keyof typeof STATUS_COLORS {
  const k = (s ?? "pending").toLowerCase();
  return (k in STATUS_COLORS ? k : "pending") as keyof typeof STATUS_COLORS;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  return dt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function SubscriptionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();

  const [phone, setPhone] = useState<string | null>(null);
  const [phoneChecked, setPhoneChecked] = useState(false);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("cadieux_phone");
    setPhone(stored);
    setPhoneChecked(true);
  }, []);

  const fetchAll = useCallback(async () => {
    if (!phone || !id) return;
    const res = await fetch(`/api/subscriptions/${id}?phone=${encodeURIComponent(phone)}`);
    if (res.status === 404) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const data = await res.json();
    setSub(data.subscription ?? null);
    setDeliveries(data.deliveries ?? []);
    setLoading(false);
  }, [id, phone]);

  useEffect(() => {
    if (!phoneChecked) return;
    if (!phone) { setLoading(false); return; }
    fetchAll();
  }, [phone, phoneChecked, fetchAll]);

  // 10s polling — RLS now denies anon SELECT, so client-side realtime can't
  // be used. The /subscriptions/track page uses the same poll cadence.
  useEffect(() => {
    if (!id || !phone) return;
    const t = setInterval(fetchAll, 10_000);
    return () => clearInterval(t);
  }, [id, phone, fetchAll]);

  const lastDeliveredIndex = deliveries.reduce(
    (acc, d, i) => (d.status === "delivered" ? i : acc),
    -1
  );

  return (
    <div style={{ minHeight: "100dvh", background: "rgb(6,4,2)", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      <Link href="/subscription" style={{
        position: "fixed", top: 24, left: 20, zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#4369B2", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>←</span> Subscriptions
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(24px,6vw,80px) 120px", maxWidth: 720, margin: "0 auto" }}>
        {!phoneChecked || loading ? (
          <p style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(240,223,200,0.4)" }}>
            Loading…
          </p>
        ) : !phone ? (
          <div>
            <h1 style={{ margin: "0 0 12px", fontFamily: "var(--font-heading)", fontSize: 36, fontWeight: 300, color: "#FBF3D4" }}>
              Sign in needed
            </h1>
            <p style={{ margin: "0 0 24px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200, color: "rgba(240,223,200,0.55)", lineHeight: 1.7 }}>
              Place an order or verify your number to view your subscription tracker.
            </p>
            <button
              type="button"
              onClick={() => router.push("/shop")}
              style={{
                background: `rgba(${GOLD},0.12)`,
                border: `1px solid rgba(${GOLD},0.6)`,
                borderRadius: 10,
                padding: "14px 28px",
                fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 400,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: `rgba(${GOLD},0.95)`, cursor: "pointer",
              }}
            >
              Go to Shop
            </button>
          </div>
        ) : notFound || !sub ? (
          <div>
            <h1 style={{ margin: "0 0 12px", fontFamily: "var(--font-heading)", fontSize: 36, fontWeight: 300, color: "#FBF3D4" }}>
              Not found
            </h1>
            <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200, color: "rgba(240,223,200,0.55)", lineHeight: 1.7 }}>
              We couldn&apos;t find this subscription on your account.
            </p>
          </div>
        ) : (
          <>
            {/* Header */}
            <h1 style={{ margin: "0 0 8px", fontFamily: "var(--font-heading)", fontSize: "clamp(40px,9vw,68px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>
              {sub.bread_name ?? "Subscription"}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22, flexWrap: "wrap" }}>
              <StatusPill status={sub.status} />
              <span style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(240,223,200,0.45)" }}>
                Total · ₹{sub.total ?? 0}
              </span>
            </div>

            {/* Plan summary card */}
            <div style={{
              background: "#0a0805",
              border: `1px solid rgba(${GOLD},0.3)`,
              borderRadius: 12,
              padding: "18px 20px",
              marginBottom: 32,
              display: "flex", flexDirection: "column", gap: 10,
            }}>
              <SummaryLine
                label="Plan"
                value={`${sub.weeks ?? 0} ${sub.weeks === 1 ? "week" : "weeks"} · ${(sub.days ?? []).length} ${(sub.days ?? []).length === 1 ? "day" : "days"}/wk`}
              />
              <SummaryLine
                label="Days"
                value={(sub.days ?? []).map((k) => DAY_LABELS[k] ?? k).join(", ") || "—"}
              />
              {sub.slot_mode === "same" ? (
                <SummaryLine label="Window" value={sub.slot ?? "—"} />
              ) : sub.slots_by_day ? (
                <SummaryLine
                  label="Windows"
                  value={Object.entries(sub.slots_by_day).map(([k, v]) => `${DAY_LABELS[k] ?? k} ${v}`).join(" · ")}
                />
              ) : null}
              {sub.customer_address && (
                <SummaryLine label="Delivery" value={sub.customer_address} multiline />
              )}
            </div>

            {/* Timeline */}
            <p style={{ margin: "0 0 18px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.4em", textTransform: "uppercase", color: `rgba(${GOLD},0.7)` }}>
              Deliveries · {deliveries.length}
            </p>

            <div style={{ position: "relative", paddingLeft: 36 }}>
              {/* Vertical rail */}
              <div style={{
                position: "absolute", left: 13, top: 8, bottom: 8,
                width: 1,
                background: "transparent",
                pointerEvents: "none",
              }} />

              {deliveries.map((d, i) => {
                const sk = statusKey(d.status);
                const colors = STATUS_COLORS[sk];
                const isPast = i <= lastDeliveredIndex;
                const isLast = i === deliveries.length - 1;
                return (
                  <div key={d.id} style={{ position: "relative", paddingBottom: isLast ? 0 : 22 }}>
                    {/* Connector to next node */}
                    {!isLast && (
                      <div style={{
                        position: "absolute",
                        left: -23,
                        top: 22,
                        bottom: -2,
                        width: 1,
                        borderLeft: isPast
                          ? `1px solid rgba(${GOLD},0.55)`
                          : "1px dashed rgba(240,223,200,0.18)",
                      }} />
                    )}

                    {/* Dot */}
                    <div style={{
                      position: "absolute",
                      left: -29,
                      top: 4,
                      width: 14, height: 14, borderRadius: "50%",
                      background: colors.dot,
                      boxShadow: `0 0 0 3px rgba(6,4,2,1), 0 0 0 4px ${colors.dot}55`,
                    }} />

                    {/* Body */}
                    <div style={{
                      background: "#0a0805",
                      border: `1px solid rgba(${GOLD},0.25)`,
                      borderRadius: 10,
                      padding: "14px 16px",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
                        <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.35em", textTransform: "uppercase", color: `rgba(${GOLD},0.75)` }}>
                          Delivery #{d.sequence} · Week {d.week_number}
                        </span>
                        <StatusPill status={d.status} small />
                      </div>
                      <div style={{ fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 400, color: "#FBF3D4", letterSpacing: "0.01em", marginBottom: 4 }}>
                        {formatDate(d.delivery_date)}
                      </div>
                      {d.slot && (
                        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 300, color: "rgba(240,223,200,0.55)", letterSpacing: "0.04em" }}>
                          {d.slot}
                        </div>
                      )}
                      {d.status_updated_at && d.status !== "pending" && (
                        <div style={{ marginTop: 6, fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(240,223,200,0.35)" }}>
                          Updated · {formatRelative(d.status_updated_at)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {deliveries.length === 0 && (
                <p style={{ marginLeft: -36, fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "rgba(240,223,200,0.45)" }}>
                  No deliveries scheduled yet.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status, small = false }: { status: string | null | undefined; small?: boolean }) {
  const sk = statusKey(status);
  const colors = STATUS_COLORS[sk];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: small ? "3px 9px" : "4px 12px",
      borderRadius: 999,
      background: colors.bg,
      border: `1px solid ${colors.pill}55`,
      fontFamily: "var(--font-body)",
      fontSize: small ? 9 : 10,
      fontWeight: 300,
      letterSpacing: "0.3em",
      textTransform: "uppercase",
      color: colors.pill,
    }}>
      {sk}
    </span>
  );
}

function SummaryLine({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: multiline ? "column" : "row",
      justifyContent: "space-between",
      alignItems: multiline ? "flex-start" : "baseline",
      gap: multiline ? 4 : 12,
    }}>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300, letterSpacing: "0.35em", textTransform: "uppercase", color: `rgba(${GOLD},0.7)` }}>
        {label}
      </span>
      <span style={{
        fontFamily: "var(--font-body)",
        fontSize: 13,
        fontWeight: 300,
        color: "#f5f0e8",
        letterSpacing: "0.02em",
        textAlign: multiline ? "left" : "right",
        lineHeight: 1.5,
      }}>
        {value}
      </span>
    </div>
  );
}
