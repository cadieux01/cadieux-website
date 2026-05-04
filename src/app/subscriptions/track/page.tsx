"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  DAY_LABEL,
  DELIVERY_STATUS_COLOR,
  DELIVERY_STATUS_LABEL,
  GOLD,
  SUB_STATUS_LABEL,
  formatDate,
  isCompleted,
  isInProgress,
} from "@/lib/subscription-ui";
// Time slots used in the change-request modal. Must match the legacy
// subscription wizard's SLOTS list (src/app/subscription/page.tsx).
const TIME_SLOTS = [
  "6:00 – 8:00 AM",
  "8:00 – 10:00 AM",
  "10:00 AM – 12:00 PM",
  "12:00 – 2:00 PM",
  "2:00 – 4:00 PM",
  "4:00 – 6:00 PM",
  "6:00 – 8:00 PM",
] as const;

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
  status_updated_at: string | null;
  admin_notes: string | null;
};

type ChangeRequest = {
  id: string;
  delivery_id: string;
  requested_date: string | null;
  requested_time_slot: string | null;
  reason: string | null;
  status: string;
  admin_response: string | null;
};

const BG = "#0e0e0e";

function readPhone(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("cadieux_phone") ?? "";
}

export default function TrackPage() {
  const [phone, setPhone] = useState<string>("");
  const [subs, setSubs] = useState<Sub[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [crForDelivery, setCrForDelivery] = useState<string | null>(null);

  useEffect(() => {
    setPhone(readPhone());
  }, []);

  const fetchSubs = useCallback(async () => {
    if (!phone) {
      setLoading(false);
      return;
    }
    const r = await fetch(`/api/subscriptions?phone=${encodeURIComponent(phone)}`);
    const j = await r.json().catch(() => ({}));
    setSubs(j.subscriptions ?? []);
    setLoading(false);
  }, [phone]);

  const fetchDeliveries = useCallback(async (id: string) => {
    if (!phone) return;
    const r = await fetch(
      `/api/subscriptions/${id}?phone=${encodeURIComponent(phone)}`
    );
    const j = await r.json().catch(() => ({}));
    setDeliveries(j.deliveries ?? []);
    setChangeRequests(j.change_requests ?? []);
  }, [phone]);

  useEffect(() => {
    fetchSubs();
    const t = setInterval(fetchSubs, 10_000);
    return () => clearInterval(t);
  }, [fetchSubs]);

  useEffect(() => {
    if (!openId) return;
    fetchDeliveries(openId);
    const t = setInterval(() => fetchDeliveries(openId), 10_000);
    return () => clearInterval(t);
  }, [openId, fetchDeliveries]);

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
            href="/subscriptions/setup/product"
          />
        )}

        <div style={{ display: "grid", gap: 16 }}>
          {subs.map((s) => {
            const open = openId === s.id;
            return (
              <div
                key={s.id}
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(240,223,200,0.12)",
                  borderRadius: 14,
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={() => setOpenId(open ? null : s.id)}
                  style={{
                    width: "100%",
                    background: "none",
                    border: "none",
                    padding: 20,
                    textAlign: "left",
                    color: "#FBF3D4",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 17, fontWeight: 500 }}>
                        {s.product_name} × {s.quantity_per_delivery}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 13, color: "rgba(240,223,200,0.6)" }}>
                        {s.frequency === "bi-weekly" ? "Every 2 weeks" : "Weekly"} ·{" "}
                        {DAY_LABEL[s.day_of_week] ?? s.day_of_week} · {s.time_slot}
                      </div>
                      {s.next_delivery_date && (
                        <div style={{ marginTop: 6, fontSize: 13, color: GOLD }}>
                          Next: {formatDate(s.next_delivery_date)}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <Pill text={SUB_STATUS_LABEL[s.status] ?? s.status} color={GOLD} />
                      <div style={{ marginTop: 8, fontSize: 13, color: "rgba(240,223,200,0.5)" }}>
                        {s.total_weeks} wk · ₹{Number(s.total_amount).toLocaleString("en-IN")}
                      </div>
                    </div>
                  </div>
                </button>

                {open && (
                  <div style={{ borderTop: "1px solid rgba(240,223,200,0.08)", padding: "16px 20px 24px" }}>
                    <Timeline
                      deliveries={deliveries}
                      changeRequests={changeRequests}
                      onRequestChange={(id) => setCrForDelivery(id)}
                    />
                    <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
                      <CancelButton subId={s.id} onCancelled={fetchSubs} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {crForDelivery && (
        <ChangeRequestModal
          deliveryId={crForDelivery}
          existing={changeRequests.find((c) => c.delivery_id === crForDelivery && c.status === "pending") ?? null}
          onClose={() => setCrForDelivery(null)}
          onSubmitted={() => {
            setCrForDelivery(null);
            if (openId) fetchDeliveries(openId);
          }}
        />
      )}
    </main>
  );
}

function Empty({ title, body, cta, href }: { title: string; body: string; cta?: string; href?: string }) {
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
      <div style={{ color: "rgba(240,223,200,0.6)", marginBottom: cta ? 20 : 0 }}>{body}</div>
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

const MS_DAY = 86_400_000;

function canRequestChange(d: Delivery): boolean {
  if (d.week_number < 2) return false;
  if (d.status === "out_for_delivery" || d.status === "delivered" || d.status === "cancelled") {
    return false;
  }
  const [y, m, dd] = d.scheduled_date.split("-").map(Number);
  if (!y || !m || !dd) return false;
  const sched = new Date(y, m - 1, dd).getTime();
  return sched - Date.now() >= MS_DAY;
}

function Timeline({
  deliveries,
  changeRequests,
  onRequestChange,
}: {
  deliveries: Delivery[];
  changeRequests: ChangeRequest[];
  onRequestChange: (deliveryId: string) => void;
}) {
  const pendingByDelivery = new Map<string, ChangeRequest>();
  for (const cr of changeRequests) {
    if (cr.status === "pending") pendingByDelivery.set(cr.delivery_id, cr);
  }

  return (
    <div style={{ position: "relative", paddingLeft: 28 }}>
      {/* vertical rail */}
      <div
        style={{
          position: "absolute",
          left: 9,
          top: 8,
          bottom: 8,
          width: 1,
          background: "rgba(240,223,200,0.15)",
        }}
      />
      {deliveries.map((d) => {
        const filled = isCompleted(d.status) || isInProgress(d.status);
        const ringColor = DELIVERY_STATUS_COLOR[d.status] ?? "rgba(240,223,200,0.4)";
        const dim = !filled && d.status === "pending_confirmation";
        const pending = pendingByDelivery.get(d.id);
        return (
          <div key={d.id} style={{ position: "relative", paddingBottom: 22, opacity: dim ? 0.65 : 1 }}>
            <div
              style={{
                position: "absolute",
                left: -23,
                top: 4,
                width: 14,
                height: 14,
                borderRadius: "50%",
                border: `2px solid ${ringColor}`,
                background: filled ? ringColor : "transparent",
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 500 }}>
                  Week {d.week_number} · {formatDate(d.scheduled_date)}
                </div>
                <div style={{ fontSize: 13, color: "rgba(240,223,200,0.6)" }}>
                  {d.scheduled_time_slot}
                </div>
              </div>
              <Pill text={DELIVERY_STATUS_LABEL[d.status] ?? d.status} color={ringColor} />
            </div>
            {pending && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#e3b341" }}>
                Change request pending
                {pending.requested_date ? ` → ${formatDate(pending.requested_date)}` : ""}
                {pending.requested_time_slot ? ` · ${pending.requested_time_slot}` : ""}
              </div>
            )}
            {canRequestChange(d) && !pending && (
              <button
                onClick={() => onRequestChange(d.id)}
                style={{
                  marginTop: 8,
                  background: "transparent",
                  border: `1px solid ${GOLD}`,
                  borderRadius: 999,
                  color: GOLD,
                  padding: "6px 14px",
                  fontSize: 12,
                  cursor: "pointer",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                Request change
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChangeRequestModal({
  deliveryId,
  existing,
  onClose,
  onSubmitted,
}: {
  deliveryId: string;
  existing: ChangeRequest | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [date, setDate] = useState(existing?.requested_date ?? "");
  const [slot, setSlot] = useState(existing?.requested_time_slot ?? "");
  const [reason, setReason] = useState(existing?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!date && !slot) {
      setErr("Pick a new date or a new time slot.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/subscriptions/change-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          delivery_id: deliveryId,
          requested_date: date || null,
          requested_time_slot: slot || null,
          reason: reason || null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Failed");
      onSubmitted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#161616",
          border: "1px solid rgba(240,223,200,0.15)",
          borderRadius: 14,
          padding: 24,
          maxWidth: 420,
          width: "100%",
          color: "#FBF3D4",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 16 }}>
          Request a change
        </div>
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(240,223,200,0.5)", marginBottom: 6 }}>
              New date (optional)
            </div>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(240,223,200,0.18)",
                borderRadius: 10,
                color: "#FBF3D4",
                fontSize: 14,
                colorScheme: "dark",
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(240,223,200,0.5)", marginBottom: 6 }}>
              New time slot (optional)
            </div>
            <select
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(240,223,200,0.18)",
                borderRadius: 10,
                color: "#FBF3D4",
                fontSize: 14,
              }}
            >
              <option value="">— Same as before —</option>
              {TIME_SLOTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(240,223,200,0.5)", marginBottom: 6 }}>
              Reason (optional)
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(240,223,200,0.18)",
                borderRadius: 10,
                color: "#FBF3D4",
                fontSize: 14,
                fontFamily: "inherit",
                resize: "vertical",
              }}
            />
          </div>
        </div>
        {err && <div style={{ marginTop: 10, color: "#ff9b9b", fontSize: 13 }}>{err}</div>}
        <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 18px",
              background: "transparent",
              border: "1px solid rgba(240,223,200,0.25)",
              borderRadius: 999,
              color: "#FBF3D4",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            style={{
              padding: "10px 18px",
              background: GOLD,
              border: "none",
              borderRadius: 999,
              color: "#0a0a0a",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Sending…" : "Submit request"}
          </button>
        </div>
      </div>
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
