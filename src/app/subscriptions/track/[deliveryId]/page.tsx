"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import TurnstileWidget, { type TurnstileHandle } from "@/components/TurnstileWidget";
import { GOLD, formatDate } from "@/lib/subscription-ui";
import { formatSlot } from "@/lib/subscription-setup";
import {
  ADMIN_PHONE,
  bookableSlots,
  canSelfEdit,
  nextDeliveryDates,
} from "@/lib/delivery-slots";
import Select from "@/components/ui/Select";
import DatePicker from "@/components/ui/DatePicker";

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
const FADED = "#f5f0e8";
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

/** Three-way classification driving which UI affordance the user sees.
 *  - direct      → can self-edit (slot > 14 h away)
 *  - call_admin  → within 14 h cutoff; must call ADMIN_PHONE
 *  - terminal    → already shipped / delivered / cancelled */
type EditMode = "direct" | "call_admin" | "terminal";

function classifyEdit(delivery: Delivery): EditMode {
  if (
    delivery.status === "out_for_delivery" ||
    delivery.status === "delivered" ||
    delivery.status === "cancelled"
  ) {
    return "terminal";
  }
  // Slot-aware 14 h gate via the unified delivery-slots lib. Treats a
  // missing slot as "start of the day" so defensive UI still allows
  // self-edit when the stored row has no slot yet.
  return canSelfEdit(delivery.scheduled_date, delivery.scheduled_time_slot)
    ? "direct"
    : "call_admin";
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
  const [toast, setToast] = useState("");

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

  // Auto-clear toast.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

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
  const mode = classifyEdit(delivery);

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
        Scheduled {formatDate(delivery.scheduled_date)} · {formatSlot(delivery.scheduled_time_slot)}
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

      {!isCancelled && mode === "direct" && (
        <DirectEditPanel
          subscriptionId={delivery.subscription_id}
          deliveryId={delivery.id}
          currentDate={delivery.scheduled_date}
          currentSlot={delivery.scheduled_time_slot}
          onSaved={() => {
            setToast("Delivery updated");
            fetchData();
          }}
        />
      )}

      {!isCancelled && mode === "call_admin" && (
        <CallAdminPanel
          pendingCR={pendingCR}
          lastResolvedCR={lastResolvedCR}
        />
      )}

      {mode === "terminal" && !isCancelled && (
        <div
          style={{
            marginTop: 12,
            padding: "14px 18px",
            border: "1px solid rgba(240,223,200,0.12)",
            borderRadius: 12,
            background: "rgba(255,255,255,0.025)",
            fontSize: 13,
            color: "rgba(240,223,200,0.6)",
          }}
        >
          This delivery can no longer be changed.
        </div>
      )}

      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 28,
            transform: "translateX(-50%)",
            padding: "10px 18px",
            borderRadius: 999,
            background: "rgba(123,216,143,0.95)",
            color: "#0a0a0a",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.04em",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          {toast}
        </div>
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

/** Direct-edit panel — used when delivery is 24h+ away. Calls the new
 *  PATCH endpoint and writes through to the DB without admin involvement.
 *  Turnstile gate keeps it bot-resistant. */
function DirectEditPanel({
  subscriptionId,
  deliveryId,
  currentDate,
  currentSlot,
  onSaved,
}: {
  subscriptionId: string;
  deliveryId: string;
  currentDate: string;
  currentSlot: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);

  // Client bakes fresh: no delivery can start earlier than now + 12 h 10 m.
  // `nextDeliveryDates(1)` returns the first date IN IST that still has any
  // bookable slot — this correctly skips today once its last slot has passed
  // the lead-time cutoff. The server re-checks on save.
  const now = useMemo(() => new Date(), []);
  const minDate = useMemo(() => {
    const next = nextDeliveryDates(1, now)[0];
    if (next) return next;
    const t = new Date();
    const yyyy = t.getFullYear();
    const mm = String(t.getMonth() + 1).padStart(2, "0");
    const dd = String(t.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, [now]);

  // Slot list is date-aware: any slot that would fall inside the 12 h 10 m
  // lead-time window is marked `disabled` so the picker greys it out. When
  // the user hasn't picked a new date, base slots on the current scheduled
  // date so today's stale slots stay hidden.
  const slotOptions = useMemo(() => {
    const forDate = date || currentDate;
    return bookableSlots(forDate, now).map((s) => ({
      value: s.value,
      label: formatSlot(s.value),
      disabled: s.disabled,
    }));
  }, [date, currentDate, now]);

  function reset() {
    setDate("");
    setSlot("");
    setErr("");
    setTurnstileToken("");
    turnstileRef.current?.reset();
  }

  async function save() {
    setErr("");
    if (!date && !slot) {
      setErr("Pick a new date or a new time slot.");
      return;
    }
    if (date) {
      const d = parseDate(date);
      if (!d) {
        setErr("Invalid date.");
        return;
      }
    }
    if (!turnstileToken) {
      setErr("Please complete the human-verification check.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(
        `/api/subscriptions/${subscriptionId}/deliveries/${deliveryId}/edit`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            new_date: date || null,
            new_time_slot: slot || null,
            turnstile_token: turnstileToken,
          }),
        }
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error ?? "Failed to update.");
        // Token is single-use — refresh for the next attempt.
        setTurnstileToken("");
        turnstileRef.current?.reset();
        return;
      }
      setOpen(false);
      reset();
      onSaved();
    } catch {
      setErr("Network error. Please try again.");
      setTurnstileToken("");
      turnstileRef.current?.reset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (open) reset();
        }}
        style={{
          width: "100%",
          padding: "14px 18px",
          background: "rgba(201,169,110,0.08)",
          border: `1px solid ${GOLD}`,
          borderRadius: 12,
          color: GOLD,
          fontSize: 14,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: "inherit",
        }}
      >
        <span>Edit date or time</span>
        <span style={{ fontSize: 18 }}>{open ? "▴" : "▾"}</span>
      </button>

      <div style={{ marginTop: 8, fontSize: 12, color: "rgba(240,223,200,0.5)" }}>
        Changes apply instantly while you&apos;re more than 14 hours out.
      </div>

      {open && (
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
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              color: "rgba(240,223,200,0.65)",
              padding: "10px 12px",
              border: "1px solid rgba(201,169,110,0.25)",
              borderRadius: 8,
              background: "rgba(201,169,110,0.05)",
            }}
          >
            We bake fresh for you — please pick a delivery time at least
            12 hours from now so your loaf comes straight from the oven.
          </div>

          <Field label={`New date (current: ${formatDate(currentDate)})`}>
            <DatePicker
              value={date}
              min={minDate}
              onChange={setDate}
              ariaLabel="New delivery date"
              placeholder="— Same as before —"
            />
          </Field>
          <Field label={`New time slot (current: ${formatSlot(currentSlot)})`}>
            <Select
              value={slot}
              onChange={setSlot}
              ariaLabel="New delivery time slot"
              placeholder="— Same as before —"
              options={slotOptions}
            />
          </Field>

          <TurnstileWidget
            ref={turnstileRef}
            onVerify={(t) => setTurnstileToken(t)}
            onExpire={() => setTurnstileToken("")}
            theme="dark"
          />

          {err && <div style={{ color: "#ff9b9b", fontSize: 13 }}>{err}</div>}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                reset();
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
              onClick={save}
              disabled={busy || !turnstileToken}
              style={{
                padding: "10px 22px",
                background: !busy && turnstileToken ? GOLD : "rgba(240,223,200,0.12)",
                border: "none",
                borderRadius: 999,
                color: !busy && turnstileToken ? "#0a0a0a" : "rgba(240,223,200,0.5)",
                fontSize: 13,
                fontWeight: 600,
                cursor: busy || !turnstileToken ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Fallback panel — used when the delivery slot is ≤ 14 h away. The
 *  customer can no longer self-edit; they must call ADMIN_PHONE. Any
 *  existing pending or resolved change-requests are still surfaced for
 *  history. */
function CallAdminPanel({
  pendingCR,
  lastResolvedCR,
}: {
  pendingCR: ChangeRequest | null;
  lastResolvedCR: ChangeRequest | null;
}) {
  const telHref = `tel:${ADMIN_PHONE.replace(/[^+\d]/g, "")}`;
  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          padding: "20px 22px",
          border: `1px solid ${GOLD}`,
          background: "rgba(201,169,110,0.08)",
          borderRadius: 12,
          color: FADED,
          lineHeight: 1.55,
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: GOLD,
            marginBottom: 8,
          }}
        >
          Within 14 hours of delivery
        </div>
        <div style={{ fontSize: 14, marginBottom: 12 }}>
          To change a delivery within 14 hours, please call us at{" "}
          <a
            href={telHref}
            style={{ color: GOLD, textDecoration: "underline" }}
          >
            {ADMIN_PHONE}
          </a>
          .
        </div>
        <div style={{ fontSize: 12, color: "rgba(240,223,200,0.55)" }}>
          Need same-day changes? A quick call is faster — we&apos;ll update
          your delivery on the spot.
        </div>
      </div>
      {pendingCR ? (
        <div
          style={{
            marginTop: 12,
            padding: "12px 16px",
            background: "rgba(227,179,65,0.06)",
            border: "1px solid rgba(227,179,65,0.4)",
            borderRadius: 12,
            fontSize: 13,
            color: "rgba(240,223,200,0.85)",
          }}
        >
          A change request from{" "}
          {new Date(pendingCR.created_at).toLocaleString("en-IN")} is pending.
        </div>
      ) : lastResolvedCR ? (
        <div
          style={{
            marginTop: 12,
            padding: "12px 16px",
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(240,223,200,0.12)",
            borderRadius: 12,
            fontSize: 12,
            color: "rgba(240,223,200,0.55)",
          }}
        >
          Previous request was {lastResolvedCR.status}.
        </div>
      ) : null}
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

