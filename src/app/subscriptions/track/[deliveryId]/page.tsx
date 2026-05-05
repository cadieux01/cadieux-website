"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { GOLD, formatDate } from "@/lib/subscription-ui";

const TIME_SLOTS = [
  "6:00 – 8:00 AM",
  "8:00 – 10:00 AM",
  "10:00 AM – 12:00 PM",
  "12:00 – 2:00 PM",
  "2:00 – 4:00 PM",
  "4:00 – 6:00 PM",
  "6:00 – 8:00 PM",
] as const;

type Delivery = {
  id: string;
  subscription_id: string;
  week_number: number;
  scheduled_date: string;
  scheduled_time_slot: string;
  status: string;
};

type Subscription = {
  id: string;
  product_name: string;
  quantity_per_delivery: number;
};

type ChangeRequest = {
  id: string;
  delivery_id: string;
  requested_date: string | null;
  requested_time_slot: string | null;
  reason: string | null;
  status: string;
  admin_response: string | null;
  created_at: string;
};

const BG = "#0e0e0e";
const FADED = "#f5f0e8"; // Cadieux faded for not-reached steps
const MS_DAY = 86_400_000;
const REASON_MAX = 200;

const STEPS = [
  { key: "pending_confirmation", label: "Pending" },
  { key: "confirmed", label: "Confirmed" },
  { key: "out_for_delivery", label: "Out for Delivery" },
  { key: "delivered", label: "Delivered" },
] as const;

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

function readPhone(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("cadieux_phone") ?? "";
}

function parseDate(yyyyMmDd: string): Date | null {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export default function DeliveryDetailPage() {
  const params = useParams<{ deliveryId: string }>();
  const deliveryId = params?.deliveryId ?? "";

  const [phone, setPhone] = useState("");
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setPhone(readPhone());
  }, []);

  const fetchData = useCallback(async () => {
    if (!phone || !deliveryId) {
      setLoading(false);
      return;
    }
    const r = await fetch(
      `/api/subscriptions/delivery/${deliveryId}?phone=${encodeURIComponent(phone)}`,
      { cache: "no-store" }
    );
    if (r.status === 404) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const j = await r.json().catch(() => ({}));
    setDelivery(j.delivery ?? null);
    setSub(j.subscription ?? null);
    setChangeRequests(j.change_requests ?? []);
    setLoading(false);
  }, [phone, deliveryId]);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 10_000);
    return () => clearInterval(t);
  }, [fetchData]);

  const pendingCR = useMemo(
    () => changeRequests.find((c) => c.status === "pending") ?? null,
    [changeRequests]
  );
  const lastResolvedCR = useMemo(
    () =>
      changeRequests.find(
        (c) => c.status === "approved" || c.status === "rejected"
      ) ?? null,
    [changeRequests]
  );

  if (loading) {
    return (
      <Shell>
        <div style={{ color: "rgba(240,223,200,0.5)" }}>Loading…</div>
      </Shell>
    );
  }

  if (notFound || !delivery || !sub) {
    return (
      <Shell>
        <div style={{ color: "rgba(240,223,200,0.5)", marginBottom: 16 }}>
          We couldn&apos;t find that delivery.
        </div>
        <Link href="/subscriptions/track" style={{ color: GOLD, fontSize: 14 }}>
          ← Back to subscriptions
        </Link>
      </Shell>
    );
  }

  const step = statusStep(delivery.status);
  const isCancelled = delivery.status === "cancelled";

  // Form-disabled rules.
  const sched = parseDate(delivery.scheduled_date);
  const tooSoon = sched ? sched.getTime() - Date.now() < MS_DAY : true;
  const formLocked =
    delivery.week_number < 2 ||
    delivery.status === "delivered" ||
    delivery.status === "cancelled" ||
    delivery.status === "out_for_delivery" ||
    tooSoon ||
    !!pendingCR;

  const lockReason = (() => {
    if (delivery.week_number < 2) return "Week 1 deliveries cannot be changed.";
    if (delivery.status === "delivered") return "Already delivered.";
    if (delivery.status === "cancelled") return "Delivery is cancelled.";
    if (delivery.status === "out_for_delivery")
      return "This delivery is already out for delivery.";
    if (tooSoon) return "Changes must be requested at least 24 hours in advance.";
    if (pendingCR) return "A change request is already pending.";
    return "";
  })();

  return (
    <Shell>
      <Link
        href="/subscriptions/track"
        style={{ fontSize: 13, color: GOLD, display: "inline-block", marginBottom: 18 }}
      >
        ← Back
      </Link>

      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontWeight: 300,
          fontSize: "clamp(28px,5vw,42px)",
          margin: "0 0 6px",
          letterSpacing: "0.02em",
        }}
      >
        Week {delivery.week_number}
      </h1>
      <div style={{ color: "rgba(240,223,200,0.6)", fontSize: 14, marginBottom: 4 }}>
        {sub.product_name} × {sub.quantity_per_delivery}
      </div>
      <div style={{ color: "rgba(240,223,200,0.55)", fontSize: 13, marginBottom: 28 }}>
        Scheduled {formatDate(delivery.scheduled_date)} · {delivery.scheduled_time_slot}
      </div>

      {isCancelled ? (
        <div
          style={{
            padding: "20px 22px",
            border: "1px solid rgba(255,129,129,0.45)",
            background: "rgba(255,129,129,0.05)",
            borderRadius: 12,
            color: "#ff8181",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            fontSize: 12,
          }}
        >
          Delivery cancelled
        </div>
      ) : (
        <Timeline currentStep={step} />
      )}

      {!isCancelled && (
        <ChangeRequestPanel
          locked={formLocked}
          lockReason={lockReason}
          deliveryId={delivery.id}
          pendingCR={pendingCR}
          lastResolvedCR={lastResolvedCR}
          onSubmitted={fetchData}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
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
      <div style={{ maxWidth: 620, margin: "0 auto" }}>{children}</div>
    </main>
  );
}

function Timeline({ currentStep }: { currentStep: number }) {
  return (
    <div
      style={{
        position: "relative",
        paddingLeft: 36,
        marginBottom: 32,
      }}
    >
      {/* vertical rail */}
      <div
        style={{
          position: "absolute",
          left: 13,
          top: 12,
          bottom: 12,
          width: 2,
          background: "rgba(240,223,200,0.12)",
        }}
      />
      {STEPS.map((s, i) => {
        const idx = i + 1;
        const reached = idx <= currentStep;
        const dotColor = reached ? GOLD : FADED;
        const labelColor = reached ? "#FBF3D4" : "rgba(245,240,232,0.45)";
        return (
          <div
            key={s.key}
            style={{
              position: "relative",
              paddingBottom: i < STEPS.length - 1 ? 28 : 0,
              minHeight: 32,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: -29,
                top: 4,
                width: 18,
                height: 18,
                borderRadius: "50%",
                border: `2px solid ${dotColor}`,
                background: reached ? GOLD : "transparent",
                boxShadow: reached ? `0 0 0 4px rgba(201,169,110,0.12)` : "none",
              }}
            />
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 15,
                color: labelColor,
                letterSpacing: "0.03em",
              }}
            >
              {s.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChangeRequestPanel({
  locked,
  lockReason,
  deliveryId,
  pendingCR,
  lastResolvedCR,
  onSubmitted,
}: {
  locked: boolean;
  lockReason: string;
  deliveryId: string;
  pendingCR: ChangeRequest | null;
  lastResolvedCR: ChangeRequest | null;
  onSubmitted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Min date for the datepicker = tomorrow (24h+ rule).
  const minDate = useMemo(() => {
    const t = new Date(Date.now() + MS_DAY);
    const yyyy = t.getFullYear();
    const mm = String(t.getMonth() + 1).padStart(2, "0");
    const dd = String(t.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  async function submit() {
    setErr("");
    if (!date && !slot) {
      setErr("Pick a new date or a new time slot.");
      return;
    }
    if (date) {
      const d = parseDate(date);
      if (!d || d.getTime() - Date.now() < MS_DAY - 1000) {
        setErr("New date must be at least 24 hours away.");
        return;
      }
    }
    if (reason.length > REASON_MAX) {
      setErr(`Reason must be ${REASON_MAX} characters or fewer.`);
      return;
    }
    setBusy(true);
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
      setDate("");
      setSlot("");
      setReason("");
      setOpen(false);
      onSubmitted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  // Pending pill state
  if (pendingCR) {
    return (
      <div
        style={{
          marginTop: 12,
          padding: "16px 18px",
          background: "rgba(227,179,65,0.06)",
          border: "1px solid rgba(227,179,65,0.4)",
          borderRadius: 12,
        }}
      >
        <div
          style={{
            display: "inline-block",
            padding: "4px 10px",
            borderRadius: 999,
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#e3b341",
            border: "1px solid #e3b341",
            marginBottom: 10,
          }}
        >
          Change request pending
        </div>
        <div style={{ fontSize: 13, color: "rgba(240,223,200,0.75)" }}>
          {pendingCR.requested_date && (
            <div>New date: {formatDate(pendingCR.requested_date)}</div>
          )}
          {pendingCR.requested_time_slot && (
            <div>New time slot: {pendingCR.requested_time_slot}</div>
          )}
          {pendingCR.reason && (
            <div style={{ marginTop: 6, fontStyle: "italic", color: "rgba(240,223,200,0.6)" }}>
              &ldquo;{pendingCR.reason}&rdquo;
            </div>
          )}
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: "rgba(240,223,200,0.5)" }}>
          We&apos;ll review and update this delivery shortly.
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      {lastResolvedCR && (
        <div
          style={{
            marginBottom: 16,
            padding: "12px 16px",
            borderRadius: 10,
            border: `1px solid ${
              lastResolvedCR.status === "approved" ? "rgba(123,216,143,0.4)" : "rgba(255,129,129,0.4)"
            }`,
            background:
              lastResolvedCR.status === "approved"
                ? "rgba(123,216,143,0.06)"
                : "rgba(255,129,129,0.05)",
            fontSize: 13,
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: lastResolvedCR.status === "approved" ? "#7bd88f" : "#ff8181",
              marginBottom: 6,
            }}
          >
            Previous request {lastResolvedCR.status}
          </div>
          {lastResolvedCR.admin_response && (
            <div style={{ color: "rgba(240,223,200,0.75)" }}>
              {lastResolvedCR.admin_response}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => !locked && setOpen((o) => !o)}
        disabled={locked}
        style={{
          width: "100%",
          padding: "14px 18px",
          background: locked ? "rgba(255,255,255,0.02)" : "rgba(201,169,110,0.08)",
          border: `1px solid ${locked ? "rgba(240,223,200,0.12)" : GOLD}`,
          borderRadius: 12,
          color: locked ? "rgba(240,223,200,0.4)" : GOLD,
          fontSize: 14,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          cursor: locked ? "not-allowed" : "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: "inherit",
        }}
      >
        <span>Request a change</span>
        <span style={{ fontSize: 18 }}>{open && !locked ? "▴" : "▾"}</span>
      </button>

      {locked && lockReason && (
        <div style={{ marginTop: 8, fontSize: 12, color: "rgba(240,223,200,0.5)" }}>
          {lockReason}
        </div>
      )}

      {!locked && open && (
        <div
          style={{
            marginTop: 12,
            padding: 18,
            border: "1px solid rgba(240,223,200,0.12)",
            borderRadius: 12,
            background: "rgba(255,255,255,0.025)",
            display: "grid",
            gap: 14,
          }}
        >
          <Field label="New date">
            <input
              type="date"
              value={date}
              min={minDate}
              onChange={(e) => setDate(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="New time slot">
            <select
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              style={inputStyle}
            >
              <option value="">— Same as before —</option>
              {TIME_SLOTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Reason (optional, ${reason.length}/${REASON_MAX})`}>
            <textarea
              value={reason}
              onChange={(e) =>
                setReason(e.target.value.slice(0, REASON_MAX))
              }
              rows={3}
              maxLength={REASON_MAX}
              style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
            />
          </Field>

          {err && <div style={{ color: "#ff9b9b", fontSize: 13 }}>{err}</div>}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setErr("");
              }}
              style={{
                padding: "10px 18px",
                background: "transparent",
                border: "1px solid rgba(240,223,200,0.25)",
                borderRadius: 999,
                color: "#FBF3D4",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              style={{
                padding: "10px 22px",
                background: GOLD,
                border: "none",
                borderRadius: 999,
                color: "#0a0a0a",
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {busy ? "Sending…" : "Submit request"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "rgba(240,223,200,0.5)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(240,223,200,0.18)",
  borderRadius: 10,
  color: "#FBF3D4",
  fontSize: 14,
  colorScheme: "dark",
};
