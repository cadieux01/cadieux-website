"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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

  // Realtime: re-fetch on any change to this subscription's row or its deliveries.
  useEffect(() => {
    if (!id || !phone) return;
    const channel = supabase
      .channel(`sub-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscription_deliveries", filter: `subscription_id=eq.${id}` },
        () => fetchAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `id=eq.${id}` },
        () => fetchAll()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, phone, fetchAll]);

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

            {/* Courier-style tracker: each delivery shows a horizontal
                Confirmed → Out for Delivery → Delivered stepper. */}
            <p style={{ margin: "0 0 18px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.4em", textTransform: "uppercase", color: `rgba(${GOLD},0.7)` }}>
              Shipments · {deliveries.length}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {deliveries.map((d) => {
                const isActive =
                  d.status !== "delivered" && d.status !== "cancelled" &&
                  deliveries.findIndex((x) => x.status !== "delivered" && x.status !== "cancelled") ===
                    deliveries.indexOf(d);
                return (
                  <DeliveryTrackerCard key={d.id} delivery={d} active={isActive} />
                );
              })}

              {deliveries.length === 0 && (
                <p style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "rgba(240,223,200,0.45)" }}>
                  No shipments scheduled yet.
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

// Courier-style horizontal stepper for a single delivery. Three milestones —
// Confirmed → Out for Delivery → Delivered — coloured by completion state.
const TRACK_STEPS: { key: "confirmed" | "dispatched" | "delivered"; label: string }[] = [
  { key: "confirmed",  label: "Confirmed" },
  { key: "dispatched", label: "Out for Delivery" },
  { key: "delivered",  label: "Delivered" },
];

function deliveryStepIndex(status: string | null | undefined): number {
  // -1 = nothing reached yet (pending). 0..2 = current step index.
  const s = (status ?? "pending").toLowerCase();
  if (s === "delivered") return 2;
  if (s === "dispatched") return 1;
  if (s === "confirmed") return 0;
  return -1;
}

function DeliveryTrackerCard({ delivery, active }: { delivery: Delivery; active: boolean }) {
  const cancelled = (delivery.status ?? "").toLowerCase() === "cancelled";
  const reached = deliveryStepIndex(delivery.status);

  return (
    <div style={{
      background: active ? "#0d0a06" : "#0a0805",
      border: active
        ? `1px solid rgba(${GOLD},0.85)`
        : `1px solid rgba(${GOLD},0.22)`,
      boxShadow: active
        ? `0 0 0 1px rgba(${GOLD},0.25), 0 8px 28px -16px rgba(${GOLD},0.5)`
        : "none",
      borderRadius: 12,
      padding: "16px 18px 18px",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      {/* Top row: AWB-style ID + status pill */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300, letterSpacing: "0.35em", textTransform: "uppercase", color: `rgba(${GOLD},0.7)` }}>
            AWB · CDX-{delivery.id.slice(0, 6).toUpperCase()}
          </span>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 400, color: "#FBF3D4", letterSpacing: "0.01em" }}>
            Shipment #{delivery.sequence} · {formatDate(delivery.delivery_date)}
          </span>
        </div>
        <StatusPill status={delivery.status} small />
      </div>

      {/* Stepper */}
      {cancelled ? (
        <div style={{
          padding: "12px 14px",
          borderRadius: 8,
          background: "rgba(224,90,90,0.08)",
          border: "1px solid rgba(224,90,90,0.45)",
          fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
          color: "#e05a5a", letterSpacing: "0.04em",
        }}>
          This shipment was cancelled.
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", position: "relative", padding: "4px 6px 0" }}>
          {TRACK_STEPS.map((step, i) => {
            const done = i <= reached;
            const isCurrent = i === reached;
            const dotBg = done ? `rgb(${GOLD})` : "transparent";
            const dotBorder = done ? `rgb(${GOLD})` : "rgba(240,223,200,0.25)";
            const labelColor = done ? "#FBF3D4" : "rgba(240,223,200,0.4)";
            const isLast = i === TRACK_STEPS.length - 1;
            return (
              <div key={step.key} style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
                {/* Connector line to next step */}
                {!isLast && (
                  <div style={{
                    position: "absolute",
                    top: 9,
                    left: "50%",
                    width: "100%",
                    height: 2,
                    background: i < reached
                      ? `rgb(${GOLD})`
                      : "rgba(240,223,200,0.15)",
                    zIndex: 0,
                  }} />
                )}
                {/* Dot */}
                <div style={{
                  position: "relative", zIndex: 1,
                  width: 18, height: 18, borderRadius: "50%",
                  background: dotBg,
                  border: `2px solid ${dotBorder}`,
                  boxShadow: isCurrent ? `0 0 0 4px rgba(${GOLD},0.18)` : "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {done && i < reached && (
                    <span style={{ color: "#0a0805", fontSize: 10, fontWeight: 700, lineHeight: 1 }}>✓</span>
                  )}
                </div>
                <span style={{
                  marginTop: 8,
                  fontFamily: "var(--font-body)",
                  fontSize: 9, fontWeight: isCurrent ? 500 : 300,
                  letterSpacing: "0.18em", textTransform: "uppercase",
                  color: labelColor, textAlign: "center",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis", overflow: "hidden",
                  maxWidth: "100%",
                }}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer: slot + last update */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10,
        paddingTop: 10, borderTop: "1px dashed rgba(240,223,200,0.12)",
      }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300, color: "rgba(240,223,200,0.65)", letterSpacing: "0.04em" }}>
          {delivery.slot ? `Slot · ${delivery.slot}` : "Slot · TBD"}
        </span>
        {delivery.status_updated_at && (delivery.status ?? "") !== "pending" ? (
          <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(240,223,200,0.4)" }}>
            Updated · {formatRelative(delivery.status_updated_at)}
          </span>
        ) : (
          <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(240,223,200,0.3)" }}>
            Awaiting confirmation
          </span>
        )}
      </div>
    </div>
  );
}
