"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PRODUCTS } from "@/lib/data";
import { useCart } from "@/context/CartContext";

type HubSub = {
  id: string;
  bread_name: string | null;
  weeks: number | null;
  days: string[] | null;
  total: number | null;
  status: string | null;
  next_delivery_date: string | null;
};

function formatHubDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const GOLD = "201,169,110";

type Step = "intro" | "weeks" | "days" | "time-mode" | "time" | "customize" | "summary";

type DeliveryRow = {
  sequence: number;
  week_number: number;
  day_key: string;
  date: Date;          // concrete calendar date
  slot: string | null; // per-delivery slot (defaults from slotMode)
  skipped: boolean;
};

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function formatDeliveryDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

type SlotMode = "same" | "custom";

const WEEK_OPTIONS = [
  { weeks: 1, label: "1 Week", sub: "Single trial run" },
  { weeks: 2, label: "2 Weeks", sub: "Short commitment" },
  { weeks: 4, label: "4 Weeks", sub: "One full month" },
  { weeks: 8, label: "8 Weeks", sub: "Two months" },
  { weeks: 12, label: "12 Weeks", sub: "A full quarter" },
];

const DAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

// 2-hour delivery windows from 6 AM to 8 PM
const SLOTS = [
  "6:00 – 8:00 AM",
  "8:00 – 10:00 AM",
  "10:00 AM – 12:00 PM",
  "12:00 – 2:00 PM",
  "2:00 – 4:00 PM",
  "4:00 – 6:00 PM",
  "6:00 – 8:00 PM",
];

export default function SubscriptionPage() {
  return (
    <Suspense fallback={null}>
      <SubscriptionInner />
    </Suspense>
  );
}

function SubscriptionInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = searchParams.get("slug");
  const product = useMemo(() => PRODUCTS.find((p) => p.slug === slug) || null, [slug]);
  const productIndex = useMemo(
    () => PRODUCTS.findIndex((p) => p.slug === slug),
    [slug]
  );
  const { addToCart, openCheckout } = useCart();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Swap the bread variant in-place. The URL slug drives `product`, so total
  // updates automatically once the route re-renders.
  function pickBread(nextSlug: string) {
    setPickerOpen(false);
    router.replace(`/subscription?slug=${nextSlug}`);
  }

  // If a product was passed in via query, jump straight into the wizard.
  const [step, setStep] = useState<Step>(product ? "weeks" : "intro");
  const [hubSubs, setHubSubs] = useState<HubSub[] | null>(null);
  const [hubLoading, setHubLoading] = useState(false);
  const [startPickerOpen, setStartPickerOpen] = useState(false);
  // Hub view: "menu" shows the three top-level options, "track" reveals
  // active subscriptions, "past" shows completed/cancelled ones.
  const [hubMode, setHubMode] = useState<"menu" | "track" | "past">("menu");

  // Hub: load this customer's subscriptions when we're on the intro step
  // without a slug. We identify the user by their saved phone (set after a
  // verified order; same convention as /orders).
  useEffect(() => {
    if (product || step !== "intro") return;
    if (typeof window === "undefined") return;
    const phone = localStorage.getItem("cadieux_phone");
    if (!phone) {
      setHubSubs([]);
      return;
    }
    setHubLoading(true);
    fetch(`/api/subscriptions?phone=${encodeURIComponent(phone)}`)
      .then((r) => r.json())
      .then((d) => setHubSubs(d.subscriptions ?? []))
      .catch(() => setHubSubs([]))
      .finally(() => setHubLoading(false));
  }, [product, step]);
  const [weeks, setWeeks] = useState<number | null>(null);
  // Per-week day selections. Different weeks can have different days.
  const [daysByWeek, setDaysByWeek] = useState<Record<number, string[]>>({});
  // 1-based pointer into the per-week picker.
  const [currentWeek, setCurrentWeek] = useState<number>(1);
  // Week-1 only: which calendar half is being picked. The week-1 page is
  // split into two sub-pages — "current" shows days in the current calendar
  // week, "next" shows days that slip to the following calendar week.
  // Weeks 2+ ignore this flag.
  // Same-window-for-all-days mode
  const [slot, setSlot] = useState<string | null>(null);
  // Per-day-window mode: { mon: "6:00 – 8:00 AM", wed: "8:00 – 10:00 AM", ... }
  const [slotsByDay, setSlotsByDay] = useState<Record<string, string>>({});
  const [slotMode, setSlotMode] = useState<SlotMode | null>(null);
  const [timeDayIndex, setTimeDayIndex] = useState(0);

  function toggleDayForWeek(week: number, key: string) {
    setDaysByWeek((prev) => {
      const list = prev[week] ?? [];
      const next = list.includes(key) ? list.filter((d) => d !== key) : [...list, key];
      return { ...prev, [week]: next };
    });
  }

  // Flat union of all selected day keys across every week (used by legacy
  // time-mode / per-day-slot / summary paths that don't care about per-week
  // breakdown).
  const allDayKeys = useMemo(() => {
    const set = new Set<string>();
    Object.values(daysByWeek).forEach((arr) => arr.forEach((k) => set.add(k)));
    // Preserve canonical Mon..Sun order so legacy UIs read consistently.
    return DAYS.map((d) => d.key).filter((k) => set.has(k));
  }, [daysByWeek]);

  const totalDayCount = useMemo(
    () => Object.values(daysByWeek).reduce((a, b) => a + b.length, 0),
    [daysByWeek]
  );

  // First-delivery date + which calendar week (current/next) each weekday
  // resolves to under the same week-1 rule applied at checkout
  // (see src/lib/subscription-dates.ts): a chosen day delivers this calendar
  // week iff its weekday index is strictly after the order weekday; otherwise
  // it slips to next week. Days delivering before next Monday are bucketed
  // into "current week" so users see what's still reachable this week.
  const dayMeta = useMemo<Record<string, {
    thisWeekDate: string | null;
    nextWeekDate: string;
    firstDate: Date; // concrete Date for this day under week-1 rule
    nextWeekDateRaw: Date; // concrete Date for this day in next calendar week
  }>>(() => {
    const today = new Date();
    const orderIdx = (today.getDay() + 6) % 7; // Mon=0..Sun=6
    const anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const daysUntilNextMonday = 7 - orderIdx; // 1..7
    const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    const out: Record<string, { thisWeekDate: string | null; nextWeekDate: string; firstDate: Date; nextWeekDateRaw: Date }> = {};
    DAYS.forEach(({ key }, dayIdx) => {
      // First-delivery delta under the existing week-1 rule.
      let delta = (dayIdx - orderIdx + 7) % 7;
      if (delta === 0) delta = 7;

      const firstDate = new Date(anchor);
      firstDate.setDate(anchor.getDate() + delta);

      // Next-week date = next Monday + dayIdx, regardless of where the
      // first-delivery falls. Always shown in the next-week list.
      const nextWeekDateRaw = new Date(anchor);
      nextWeekDateRaw.setDate(anchor.getDate() + daysUntilNextMonday + dayIdx);

      out[key] = {
        thisWeekDate: delta < daysUntilNextMonday ? fmt(firstDate) : null,
        nextWeekDate: fmt(nextWeekDateRaw),
        firstDate,
        nextWeekDateRaw,
      };
    });
    return out;
  }, []);

  const thisWeekDays = useMemo(() => DAYS.filter((d) => dayMeta[d.key]?.thisWeekDate), [dayMeta]);

  // Concrete delivery date for a given (day, subscription-week). Week 1 uses
  // the existing week-1 rule date; subsequent weeks step by 7 days.
  function dateForWeek(key: string, week: number): Date {
    const meta = dayMeta[key];
    // Edge case: ordering on Sunday (or any day where nothing more is
    // deliverable in the current calendar week) — Week 1 lives in the next
    // calendar week, and weeks step from there.
    if (thisWeekDays.length === 0) {
      const d = new Date(meta.nextWeekDateRaw);
      d.setDate(meta.nextWeekDateRaw.getDate() + (week - 1) * 7);
      return d;
    }
    // Normal case: Week 1 uses the week-1 rule date (only meaningful for
    // days available this calendar week). Weeks 2+ are anchored on the day's
    // date in the following calendar week and stepped by 7 from there, so
    // Week 2 always lands in the next calendar week.
    if (week <= 1) return new Date(meta.firstDate);
    const d = new Date(meta.nextWeekDateRaw);
    d.setDate(meta.nextWeekDateRaw.getDate() + (week - 2) * 7);
    return d;
  }

  // Per-delivery overrides keyed by `${week}-${day_key}`. When the user opens
  // the customize step we autogenerate rows from days/weeks; this object lets
  // them override slot or skip individual deliveries without losing edits when
  // they navigate back and forth.
  const [deliveryOverrides, setDeliveryOverrides] = useState<
    Record<string, { slot?: string | null; skipped?: boolean }>
  >({});

  // Concrete delivery calendar derived from the per-week selections. Each
  // subscription week may have a different set of days; weeks 2..N step 7 days
  // from each day's week-1 rule date. We iterate every week with picks so the
  // user can swipe forward up to MAX_NAV_WEEKS and have those picks count.
  const deliveryRows: DeliveryRow[] = useMemo(() => {
    if (!weeks || totalDayCount === 0) return [];
    const rows: Omit<DeliveryRow, "sequence">[] = [];
    const weeksWithPicks = Object.keys(daysByWeek)
      .map(Number)
      .filter((w) => (daysByWeek[w] ?? []).length > 0)
      .sort((a, b) => a - b);
    for (const w of weeksWithPicks) {
      const list = daysByWeek[w] ?? [];
      for (const dayKey of list) {
        const date = dateForWeek(dayKey, w);
        const defaultSlot = slotMode === "same" ? slot : slotsByDay[dayKey] ?? null;
        const override = deliveryOverrides[`${w}-${dayKey}`] ?? {};
        rows.push({
          week_number: w,
          day_key: dayKey,
          date,
          slot: override.slot !== undefined ? override.slot : defaultSlot,
          skipped: override.skipped ?? false,
        });
      }
    }
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());
    return rows.map((r, i) => ({ ...r, sequence: i + 1 }));
    // dayMeta is captured by dateForWeek; including it keeps things stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks, daysByWeek, totalDayCount, slotMode, slot, slotsByDay, deliveryOverrides, dayMeta]);

  function setDeliveryOverride(week: number, dayKey: string, patch: { slot?: string | null; skipped?: boolean }) {
    const k = `${week}-${dayKey}`;
    setDeliveryOverrides((prev) => ({ ...prev, [k]: { ...(prev[k] ?? {}), ...patch } }));
  }

  function reset() {
    setStep(product ? "weeks" : "intro");
    setWeeks(null);
    setDaysByWeek({});
    setCurrentWeek(1);
    setSlot(null);
    setSlotsByDay({});
    setSlotMode(null);
    setTimeDayIndex(0);
    setDeliveryOverrides({});
  }

  function addSubscriptionToCart() {
    if (!product || !weeks || productIndex < 0) return;
    const dayLabelList = allDayKeys
      .map((k) => DAYS.find((d) => d.key === k)?.label || "")
      .filter(Boolean);
    const cartDeliveries = deliveryRows
      .filter((r) => !r.skipped)
      .map((r, i) => ({
        sequence: i + 1,
        week_number: r.week_number,
        day_key: r.day_key,
        delivery_date: isoDate(r.date),
        slot: r.slot,
        skipped: false,
      }));
    addToCart({
      productIndex,
      name: `${product.name} — Subscription`,
      // Treat the whole subscription as a single line item priced at total.
      price: total,
      qty: 1,
      orderType: "sub",
      weeks,
      days: dayLabelList,
      slotMode: slotMode || undefined,
      slot: slotMode === "same" ? slot : null,
      slotsByDay: slotMode === "custom" ? slotsByDay : null,
      deliveries: cartDeliveries,
    });
    router.push("/cart");
  }

  // After picking per-week days, jump straight to address+payment via the
  // global CheckoutModal. We assign a default slot so the cart line item is
  // complete; per-delivery slot tweaks are handled later from admin / the
  // timeline view.
  function continueFromDays() {
    if (!product || !weeks || productIndex < 0) return;

    const defaultSlot = SLOTS[0];
    const dayLabelList = allDayKeys
      .map((k) => DAYS.find((d) => d.key === k)?.label || "")
      .filter(Boolean);

    // Flatten daysByWeek into concrete delivery rows. We honour every week
    // that has picks (up to MAX_NAV_WEEKS = 12), so swiping past the
    // initially-selected duration still produces real deliveries.
    const rows: Array<{ week_number: number; day_key: string; date: Date }> = [];
    const weeksWithPicks = Object.keys(daysByWeek)
      .map(Number)
      .filter((w) => (daysByWeek[w] ?? []).length > 0)
      .sort((a, b) => a - b);
    for (const w of weeksWithPicks) {
      const list = daysByWeek[w] ?? [];
      for (const dayKey of list) {
        rows.push({ week_number: w, day_key: dayKey, date: dateForWeek(dayKey, w) });
      }
    }
    if (rows.length === 0) return;
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());
    const cartDeliveries = rows.map((r, i) => ({
      sequence: i + 1,
      week_number: r.week_number,
      day_key: r.day_key,
      delivery_date: isoDate(r.date),
      slot: defaultSlot,
      skipped: false,
    }));

    const totalCalc = product.price * cartDeliveries.length;
    const effectiveWeeks = weeksWithPicks.length > 0
      ? Math.max(weeks, weeksWithPicks[weeksWithPicks.length - 1])
      : weeks;

    setSlotMode("same");
    setSlot(defaultSlot);

    addToCart({
      productIndex,
      name: `${product.name} — Subscription`,
      price: totalCalc,
      qty: 1,
      orderType: "sub",
      weeks: effectiveWeeks,
      days: dayLabelList,
      slotMode: "same",
      slot: defaultSlot,
      slotsByDay: null,
      deliveries: cartDeliveries,
    });

    openCheckout();
  }

  // Time-step "Back" needs to know whether we came from time-mode or days.
  function backFromTime() {
    if (slotMode === "custom" && timeDayIndex > 0) {
      setTimeDayIndex(timeDayIndex - 1);
      return;
    }
    if (allDayKeys.length > 1) {
      setStep("time-mode");
    } else {
      setStep("days");
    }
  }

  // "time-mode" and "time" share progress-dot index 3 — the user thinks of
  // "picking time" as one phase regardless of mode.
  const stepIndex = { intro: 0, weeks: 1, days: 2, "time-mode": 3, time: 3, customize: 4, summary: 5 }[step];

  const dayLabels = allDayKeys
    .map((k) => DAYS.find((d) => d.key === k)?.label || "")
    .filter(Boolean);

  // Running total: variant price × number of active (non-skipped) deliveries.
  const activeDeliveryCount = deliveryRows.length > 0
    ? deliveryRows.filter((r) => !r.skipped).length
    : totalDayCount;
  const total = product ? product.price * activeDeliveryCount : 0;
  const currentWeekDayCount = (daysByWeek[currentWeek] ?? []).length;
  const perWeek = product ? product.price * currentWeekDayCount : 0;

  return (
    <div style={{ minHeight: "100dvh", background: "rgb(6,4,2)", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      <Link href="/" style={{
        position: "fixed", top: 24, left: 20, zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#4369B2", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(24px,6vw,80px) 120px", maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 12px", fontFamily: "var(--font-heading)", fontSize: "clamp(48px,11vw,88px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>
          Subscription
        </h1>
        <p style={{ margin: "0 0 28px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.5)" }}>
          {product ? product.tag : "Recurring deliveries"}
        </p>

        {/* Variant header — shown when a product was passed via query */}
        {product && step !== "intro" && (
          <div style={{ marginBottom: 22 }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              padding: "14px 16px",
              background: "#0a0805",
              border: `0.5px solid rgba(${GOLD},${pickerOpen ? 0.6 : 0.35})`,
              borderRadius: 12,
              gap: 12,
              transition: "border-color 200ms ease",
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 400, color: "#FBF3D4", letterSpacing: "0.01em" }}>
                  {product.title}
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.25em", textTransform: "uppercase", color: `rgba(${GOLD},0.7)`, marginTop: 4 }}>
                  ₹{product.price} per loaf
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                aria-expanded={pickerOpen}
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  padding: 4,
                  fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300,
                  letterSpacing: "0.3em", textTransform: "uppercase",
                  color: pickerOpen ? `rgba(${GOLD},0.95)` : "rgba(240,223,200,0.5)",
                  flexShrink: 0,
                  transition: "color 200ms ease",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {pickerOpen ? "Close ×" : "Change →"}
              </button>
            </div>

            {/* Inline bread picker — opens under the header */}
            {pickerOpen && (
              <div style={{
                marginTop: 10,
                display: "flex", flexDirection: "column", gap: 8,
              }}>
                {PRODUCTS.map((p) => (
                  <OptionRow
                    key={p.slug}
                    selected={product.slug === p.slug}
                    onClick={() => pickBread(p.slug)}
                    title={p.title}
                    sub={`₹${p.price} per loaf · ${p.tag}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Progress dots */}
        {step !== "intro" && (
          <div style={{ display: "flex", gap: 8, marginBottom: 28, alignItems: "center" }}>
            {["weeks", "days", "time", "summary"].map((s, i) => {
              const active = stepIndex - 1 >= i;
              return (
                <div key={s} style={{
                  flex: 1, height: 2,
                  background: active ? `rgba(${GOLD},0.85)` : "rgba(240,223,200,0.12)",
                  transition: "background 280ms ease",
                  borderRadius: 2,
                }} />
              );
            })}
          </div>
        )}

        {/* INTRO / HUB — shown when no product slug is in the URL */}
        {step === "intro" && (
          <>
            {/* Default menu: two top-level options */}
            {hubMode === "menu" && !startPickerOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <button
                  type="button"
                  onClick={() => setStartPickerOpen(true)}
                  className="cdx-sub-cta"
                  style={{
                    width: "100%", textAlign: "left",
                    background: `rgba(${GOLD},0.08)`,
                    border: `1px dashed rgba(${GOLD},0.55)`,
                    borderRadius: 12,
                    padding: "20px 20px",
                    display: "flex", flexDirection: "column", gap: 6,
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                    transition: "background 200ms ease, border-color 200ms ease",
                  }}
                >
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: 19, fontWeight: 400, color: "#FBF3D4", letterSpacing: "0.01em" }}>
                    Start a new plan
                  </span>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300, color: "rgba(240,223,200,0.55)", letterSpacing: "0.04em" }}>
                    Pick a bread, duration, days, and time slots.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setHubMode("track")}
                  className="cdx-sub-cta"
                  style={{
                    width: "100%", textAlign: "left",
                    background: "#0a0805",
                    border: `1px solid rgba(${GOLD},0.45)`,
                    borderRadius: 12,
                    padding: "20px 20px",
                    display: "flex", flexDirection: "column", gap: 6,
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                    transition: "background 200ms ease, border-color 200ms ease",
                  }}
                >
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: 19, fontWeight: 400, color: "#FBF3D4", letterSpacing: "0.01em" }}>
                    Track your subscription
                  </span>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300, color: "rgba(240,223,200,0.55)", letterSpacing: "0.04em" }}>
                    See your active plans and live delivery status.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setHubMode("past")}
                  className="cdx-sub-cta"
                  style={{
                    width: "100%", textAlign: "left",
                    background: "#0a0805",
                    border: "1px solid rgba(240,223,200,0.18)",
                    borderRadius: 12,
                    padding: "20px 20px",
                    display: "flex", flexDirection: "column", gap: 6,
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                    transition: "background 200ms ease, border-color 200ms ease",
                  }}
                >
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: 19, fontWeight: 400, color: "#FBF3D4", letterSpacing: "0.01em" }}>
                    Past subscriptions
                  </span>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300, color: "rgba(240,223,200,0.55)", letterSpacing: "0.04em" }}>
                    Review your completed and cancelled plans.
                  </span>
                </button>
              </div>
            )}

            {/* Track / Past views: show subscriptions list filtered by mode */}
            {(hubMode === "track" || hubMode === "past") && !startPickerOpen && (() => {
              const isPastView = hubMode === "past";
              const isPastStatus = (st: string | null) => {
                const s = (st ?? "pending").toLowerCase();
                return s === "delivered" || s === "cancelled";
              };
              const filtered = (hubSubs ?? []).filter((s) =>
                isPastView ? isPastStatus(s.status) : !isPastStatus(s.status)
              );
              const heading = isPastView ? "Past subscriptions" : "Your subscriptions";
              const emptyMsg = isPastView
                ? "No past plans yet."
                : "No active plans yet.";
              return (
                <>
                  <button
                    type="button"
                    onClick={() => setHubMode("menu")}
                    style={{
                      background: "transparent", border: "none", cursor: "pointer",
                      padding: "0 0 14px",
                      fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300,
                      letterSpacing: "0.3em", textTransform: "uppercase",
                      color: "rgba(240,223,200,0.55)",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    ← Back
                  </button>

                  <p style={{ margin: "0 0 14px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.4em", textTransform: "uppercase", color: `rgba(${GOLD},0.7)` }}>
                    {heading}
                  </p>

                  {hubLoading && (
                    <p style={{ margin: "0 0 24px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(240,223,200,0.35)" }}>
                      Loading…
                    </p>
                  )}

                  {!hubLoading && filtered.length === 0 && (
                    <p style={{ margin: "0 0 24px", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 300, color: "rgba(240,223,200,0.5)" }}>
                      {emptyMsg}
                    </p>
                  )}

                  {!hubLoading && filtered.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {filtered.map((s) => (
                        <Link
                          key={s.id}
                          href={`/subscription/${s.id}`}
                          style={{
                            textDecoration: "none",
                            background: "#0a0805",
                            border: `1px solid rgba(${GOLD},${isPastView ? 0.2 : 0.35})`,
                            borderRadius: 12,
                            padding: "16px 18px",
                            display: "flex", flexDirection: "column", gap: 8,
                            opacity: isPastView ? 0.85 : 1,
                            WebkitTapHighlightColor: "transparent",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                            <span style={{ fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 400, color: "#FBF3D4", letterSpacing: "0.01em" }}>
                              {s.bread_name ?? "Subscription"}
                            </span>
                            <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300, letterSpacing: "0.3em", textTransform: "uppercase", color: `rgba(${GOLD},0.7)` }}>
                              {(s.status ?? "pending").toUpperCase()}
                            </span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                            <span style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300, color: "rgba(240,223,200,0.6)", letterSpacing: "0.04em" }}>
                              {s.weeks} {s.weeks === 1 ? "wk" : "wks"} · {(s.days ?? []).length} {(s.days ?? []).length === 1 ? "day" : "days"}/wk
                            </span>
                            <span style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 300, color: "#f5f0e8" }}>
                              ₹{s.total ?? 0}
                            </span>
                          </div>
                          {!isPastView && (
                            <div style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(240,223,200,0.4)" }}>
                              Next delivery · {formatHubDate(s.next_delivery_date)}
                            </div>
                          )}
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}

            {/* Bread picker (shared) — opened from "Start a new plan" */}
            {startPickerOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(240,223,200,0.4)" }}>
                  Choose a bread
                </p>
                {PRODUCTS.map((p) => (
                  <OptionRow
                    key={p.slug}
                    selected={false}
                    onClick={() => {
                      router.replace(`/subscription?slug=${p.slug}`);
                      setStartPickerOpen(false);
                      setStep("weeks");
                    }}
                    title={p.title}
                    sub={`₹${p.price} per loaf · ${p.tag}`}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setStartPickerOpen(false)}
                  style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    padding: "8px 0",
                    fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300,
                    letterSpacing: "0.3em", textTransform: "uppercase",
                    color: "rgba(240,223,200,0.45)",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}

        {/* STEP 1 — WEEKS */}
        {step === "weeks" && (
          <Section
            title="How many weeks?"
            sub="Pick a subscription length"
            onBack={() => setStep(product ? "intro" : "intro")}
          >
            {WEEK_OPTIONS.map(({ weeks: w, label, sub }) => (
              <OptionRow
                key={w}
                selected={weeks === w}
                onClick={() => {
                  setWeeks(w);
                  setCurrentWeek(1);
                  // Trim out-of-range week selections if user shortens.
                  setDaysByWeek((prev) => {
                    const next: Record<number, string[]> = {};
                    for (let i = 1; i <= w; i++) if (prev[i]) next[i] = prev[i];
                    return next;
                  });
                  setStep("days");
                }}
                title={label}
                sub={sub}
              />
            ))}
          </Section>
        )}

        {/* STEP 2 — DAYS (one page per subscription week) */}
        {step === "days" && weeks && (() => {
          const selectedThisWeek = daysByWeek[currentWeek] ?? [];
          const isFirstWeek = currentWeek === 1;
          const noDaysThisCal = thisWeekDays.length === 0;
          // Week 1 lists only days deliverable this calendar week (unless
          // there are none — then it falls back to the full 7-day list,
          // which dateForWeek dates into next calendar week).
          const dayList = isFirstWeek && !noDaysThisCal ? thisWeekDays : DAYS;
          const fmtForWeek = (key: string) =>
            formatDeliveryDate(dateForWeek(key, currentWeek));
          const titleForWeek = (w: number) => {
            if (w === 1) return "Available this week";
            if (w === 2) return "Next week";
            return `${ordinal(w)} week`;
          };
          const subForWeek = (w: number) => {
            if (w === 1) return noDaysThisCal
              ? "Your first deliveries land next week"
              : "Pick days available this week";
            if (w === 2) return "Pick days for next week";
            return `Pick days for the ${ordinal(w)} week`;
          };
          return (
            <Section
              title={titleForWeek(currentWeek)}
              sub={subForWeek(currentWeek)}
              onBack={() => {
                if (currentWeek > 1) {
                  setCurrentWeek(currentWeek - 1);
                } else {
                  setStep("weeks");
                }
              }}
            >
              {dayList.map(({ key, label }) => {
                const active = selectedThisWeek.includes(key);
                return (
                  <OptionRow
                    key={`w${currentWeek}-${key}`}
                    selected={active}
                    onClick={() => toggleDayForWeek(currentWeek, key)}
                    title={`${label} · ${fmtForWeek(key)}`}
                    sub={active ? `Selected · ${titleForWeek(currentWeek).toLowerCase()}` : titleForWeek(currentWeek)}
                    multi
                  />
                );
              })}

              {/* Running total */}
              {product && (
                <div style={{
                  marginTop: 10,
                  padding: "16px 18px",
                  background: `rgba(${GOLD},0.08)`,
                  border: `1px solid rgba(${GOLD},0.45)`,
                  borderRadius: 12,
                  display: "flex", flexDirection: "column", gap: 6,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.3em", textTransform: "uppercase", color: `rgba(${GOLD},0.75)` }}>
                      Week {currentWeek}
                    </span>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "#f5f0e8" }}>
                      ₹{perWeek}
                      <span style={{ color: "rgba(240,223,200,0.45)", fontSize: 10, marginLeft: 6, letterSpacing: "0.1em" }}>
                        {currentWeekDayCount > 0 ? `(${currentWeekDayCount} × ₹${product.price})` : ""}
                      </span>
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: 10, borderTop: "1px dashed rgba(240,223,200,0.12)" }}>
                    <span style={{ fontFamily: "var(--font-heading)", fontSize: 14, fontWeight: 400, letterSpacing: "0.05em", color: "#FBF3D4", textTransform: "uppercase" }}>
                      Total ({totalDayCount} {totalDayCount === 1 ? "delivery" : "deliveries"})
                    </span>
                    <span style={{ fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 500, color: "#FBF3D4", letterSpacing: "0.01em" }}>
                      ₹{total}
                    </span>
                  </div>
                </div>
              )}

              {/* Primary action: always advances week-by-week (up to 12) so
                  the user can swipe through future weeks regardless of the
                  duration they originally picked. A separate Continue button
                  below finalises the plan. */}
              {(() => {
                const MAX_NAV_WEEKS = 12;
                const atMaxWeek = currentWeek >= MAX_NAV_WEEKS;
                const handleForward = () => {
                  if (!atMaxWeek) setCurrentWeek(currentWeek + 1);
                };
                const disabled = atMaxWeek;
                return (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={handleForward}
                    className="cdx-sub-next"
                    style={{
                      marginTop: 16,
                      width: "100%",
                      background: disabled ? "transparent" : `rgba(${GOLD},0.12)`,
                      border: `1px solid rgba(${GOLD},${disabled ? 0.25 : 0.65})`,
                      borderRadius: 10,
                      padding: "14px 18px",
                      fontFamily: "var(--font-body)",
                      fontSize: 11, fontWeight: 400,
                      letterSpacing: "0.3em", textTransform: "uppercase",
                      color: disabled ? "rgba(240,223,200,0.3)" : `rgba(${GOLD},0.95)`,
                      cursor: disabled ? "not-allowed" : "pointer",
                      transition: "background 200ms ease, border-color 200ms ease, color 200ms ease",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {atMaxWeek
                      ? "Last week"
                      : currentWeek === 1
                      ? "Go to next week →"
                      : `Go to ${ordinal(currentWeek + 1)} week →`}
                  </button>
                );
              })()}

              {/* Continue: finalise the plan with whatever has been picked
                  across all weeks. Available from any week. */}
              {totalDayCount > 0 && (
                <button
                  type="button"
                  onClick={continueFromDays}
                  style={{
                    marginTop: 10,
                    width: "100%",
                    background: `rgba(${GOLD},0.22)`,
                    border: `1px solid rgba(${GOLD},0.85)`,
                    borderRadius: 10,
                    padding: "14px 18px",
                    fontFamily: "var(--font-body)",
                    fontSize: 11, fontWeight: 500,
                    letterSpacing: "0.3em", textTransform: "uppercase",
                    color: "#FBF3D4",
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  Continue · {totalDayCount} {totalDayCount === 1 ? "delivery" : "deliveries"} →
                </button>
              )}

              {/* Secondary: step back to the previous week */}
              {currentWeek > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setCurrentWeek(currentWeek - 1);
                  }}
                  style={{
                    marginTop: 8,
                    width: "100%",
                    background: "transparent",
                    border: "1px solid rgba(240,223,200,0.15)",
                    borderRadius: 10,
                    padding: "10px 18px",
                    fontFamily: "var(--font-body)",
                    fontSize: 10, fontWeight: 300,
                    letterSpacing: "0.3em", textTransform: "uppercase",
                    color: "rgba(240,223,200,0.55)",
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  ← Previous week
                </button>
              )}
            </Section>
          );
        })()}

        {/* STEP 3a — TIME MODE (only when 2+ days are picked) */}
        {step === "time-mode" && (
          <Section
            title="Same time, or per day?"
            sub={`You picked ${allDayKeys.length} delivery days`}
            onBack={() => setStep("days")}
          >
            <OptionRow
              selected={slotMode === "same"}
              onClick={() => {
                setSlotMode("same");
                setSlotsByDay({});
                setTimeDayIndex(0);
                setStep("time");
              }}
              title="Same window for all days"
              sub="One 2-hour slot applies to every delivery"
            />
            <OptionRow
              selected={slotMode === "custom"}
              onClick={() => {
                setSlotMode("custom");
                setSlot(null);
                setTimeDayIndex(0);
                setStep("time");
              }}
              title="Customize per day"
              sub="Pick a different 2-hour slot for each day"
            />
          </Section>
        )}

        {/* STEP 3b — TIME (single picker, or per-day depending on slotMode) */}
        {step === "time" && slotMode === "same" && (
          <Section
            title="Pick a delivery window"
            sub="Each slot is a 2-hour period"
            onBack={backFromTime}
          >
            {SLOTS.map((s) => (
              <OptionRow
                key={s}
                selected={slot === s}
                onClick={() => setSlot(s)}
                title={s}
                sub="2-hour window"
              />
            ))}
            <button
              type="button"
              disabled={!slot}
              onClick={() => setStep("customize")}
              className="cdx-sub-next"
              style={{
                marginTop: 16,
                width: "100%",
                background: !slot ? "transparent" : `rgba(${GOLD},0.12)`,
                border: `1px solid rgba(${GOLD},${!slot ? 0.25 : 0.65})`,
                borderRadius: 10,
                padding: "14px 18px",
                fontFamily: "var(--font-body)",
                fontSize: 11, fontWeight: 400,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: !slot ? "rgba(240,223,200,0.3)" : `rgba(${GOLD},0.95)`,
                cursor: !slot ? "not-allowed" : "pointer",
                transition: "background 200ms ease, border-color 200ms ease, color 200ms ease",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Continue →
            </button>
          </Section>
        )}

        {step === "time" && slotMode === "custom" && (() => {
          const dayKey = allDayKeys[timeDayIndex];
          const dayLabel = DAYS.find((d) => d.key === dayKey)?.label || "";
          const isLast = timeDayIndex === allDayKeys.length - 1;
          const currentSlot = slotsByDay[dayKey] || null;
          return (
            <Section
              title={`Timings for ${dayLabel}`}
              sub={`Day ${timeDayIndex + 1} of ${allDayKeys.length}`}
              onBack={backFromTime}
            >
              {SLOTS.map((s) => (
                <OptionRow
                  key={s}
                  selected={currentSlot === s}
                  onClick={() => setSlotsByDay({ ...slotsByDay, [dayKey]: s })}
                  title={s}
                  sub="2-hour window"
                />
              ))}
              <button
                type="button"
                disabled={!currentSlot}
                onClick={() => {
                  if (isLast) setStep("customize");
                  else setTimeDayIndex(timeDayIndex + 1);
                }}
                className="cdx-sub-next"
                style={{
                  marginTop: 16,
                  width: "100%",
                  background: !currentSlot ? "transparent" : `rgba(${GOLD},0.12)`,
                  border: `1px solid rgba(${GOLD},${!currentSlot ? 0.25 : 0.65})`,
                  borderRadius: 10,
                  padding: "14px 18px",
                  fontFamily: "var(--font-body)",
                  fontSize: 11, fontWeight: 400,
                  letterSpacing: "0.3em", textTransform: "uppercase",
                  color: !currentSlot ? "rgba(240,223,200,0.3)" : `rgba(${GOLD},0.95)`,
                  cursor: !currentSlot ? "not-allowed" : "pointer",
                  transition: "background 200ms ease, border-color 200ms ease, color 200ms ease",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {isLast ? "Review →" : `Next: ${DAYS.find((d) => d.key === allDayKeys[timeDayIndex + 1])?.label || ""} →`}
              </button>
            </Section>
          );
        })()}

        {/* STEP 4 — CUSTOMIZE EACH DELIVERY */}
        {step === "customize" && (
          <Section
            title="Customize each delivery"
            sub={`${activeDeliveryCount} of ${deliveryRows.length} deliveries active`}
            onBack={() => setStep("time")}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {deliveryRows.map((r) => {
                const k = `${r.week_number}-${r.day_key}`;
                const dayLabel = DAYS.find((d) => d.key === r.day_key)?.label || "";
                return (
                  <div
                    key={k}
                    style={{
                      border: `1px solid rgba(${GOLD},${r.skipped ? 0.18 : 0.4})`,
                      borderRadius: 12,
                      padding: "14px 16px",
                      background: r.skipped ? "transparent" : "#0a0805",
                      opacity: r.skipped ? 0.55 : 1,
                      display: "flex", flexDirection: "column", gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <span style={{ fontFamily: "var(--font-heading)", fontSize: 16, fontWeight: 400, color: "#f5f0e8", letterSpacing: "0.01em" }}>
                          #{r.sequence} · {formatDeliveryDate(r.date)}
                        </span>
                        <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.22em", textTransform: "uppercase", color: `rgba(${GOLD},0.7)` }}>
                          Week {r.week_number} · {dayLabel}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDeliveryOverride(r.week_number, r.day_key, { skipped: !r.skipped })}
                        style={{
                          flexShrink: 0,
                          background: r.skipped ? `rgba(${GOLD},0.18)` : "transparent",
                          border: `1px solid rgba(${GOLD},${r.skipped ? 0.65 : 0.35})`,
                          borderRadius: 8,
                          padding: "6px 12px",
                          fontFamily: "var(--font-body)",
                          fontSize: 10, fontWeight: 400,
                          letterSpacing: "0.2em", textTransform: "uppercase",
                          color: r.skipped ? `rgba(${GOLD},0.95)` : "rgba(240,223,200,0.65)",
                          cursor: "pointer",
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        {r.skipped ? "Restore" : "Skip"}
                      </button>
                    </div>

                    {!r.skipped && (
                      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(240,223,200,0.5)" }}>
                          Slot
                        </span>
                        <select
                          value={r.slot ?? ""}
                          onChange={(e) => setDeliveryOverride(r.week_number, r.day_key, { slot: e.target.value || null })}
                          style={{
                            background: "#0a0805",
                            border: `1px solid rgba(${GOLD},0.35)`,
                            borderRadius: 8,
                            padding: "8px 10px",
                            fontFamily: "var(--font-body)",
                            fontSize: 13,
                            color: "#f5f0e8",
                            cursor: "pointer",
                          }}
                        >
                          <option value="">— Pick a slot —</option>
                          {SLOTS.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>

            {product && (
              <div style={{
                marginTop: 16,
                padding: "14px 18px",
                background: `rgba(${GOLD},0.08)`,
                border: `1px solid rgba(${GOLD},0.45)`,
                borderRadius: 12,
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
              }}>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 14, fontWeight: 400, letterSpacing: "0.05em", color: "#FBF3D4", textTransform: "uppercase" }}>
                  Total ({activeDeliveryCount} {activeDeliveryCount === 1 ? "delivery" : "deliveries"})
                </span>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 500, color: "#FBF3D4", letterSpacing: "0.01em" }}>
                  ₹{total}
                </span>
              </div>
            )}

            <button
              type="button"
              disabled={activeDeliveryCount === 0}
              onClick={() => setStep("summary")}
              className="cdx-sub-next"
              style={{
                marginTop: 16,
                width: "100%",
                background: activeDeliveryCount === 0 ? "transparent" : `rgba(${GOLD},0.12)`,
                border: `1px solid rgba(${GOLD},${activeDeliveryCount === 0 ? 0.25 : 0.65})`,
                borderRadius: 10,
                padding: "14px 18px",
                fontFamily: "var(--font-body)",
                fontSize: 11, fontWeight: 400,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: activeDeliveryCount === 0 ? "rgba(240,223,200,0.3)" : `rgba(${GOLD},0.95)`,
                cursor: activeDeliveryCount === 0 ? "not-allowed" : "pointer",
                transition: "background 200ms ease, border-color 200ms ease, color 200ms ease",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Review →
            </button>
          </Section>
        )}

        {/* STEP 5 — SUMMARY */}
        {step === "summary" && (
          <Section
            title="Review"
            sub="Confirm your subscription"
            onBack={() => setStep("customize")}
          >
            {product && <SummaryRow label="Bread" value={`${product.title} · ₹${product.price}`} />}
            <SummaryRow label="Duration" value={`${weeks} ${weeks === 1 ? "week" : "weeks"}`} />
            <SummaryRow label="Days" value={dayLabels.join(", ")} />
            {slotMode === "custom" ? (
              <div style={{
                display: "flex", flexDirection: "column",
                padding: "14px 0",
                borderBottom: "1px solid rgba(240,223,200,0.08)",
                gap: 10,
              }}>
                <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.3em", textTransform: "uppercase", color: `rgba(${GOLD},0.7)` }}>
                  Timings
                </span>
                {allDayKeys.map((k) => {
                  const label = DAYS.find((d) => d.key === k)?.label || "";
                  return (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 300, color: "rgba(240,223,200,0.65)", letterSpacing: "0.04em" }}>
                        {label}
                      </span>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "#f5f0e8", letterSpacing: "0.02em" }}>
                        {slotsByDay[k] || "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <SummaryRow label="Timings" value={slot || ""} />
            )}
            {product && (
              <div style={{
                marginTop: 8,
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                padding: "16px 0",
              }}>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 16, fontWeight: 400, letterSpacing: "0.05em", color: "#FBF3D4", textTransform: "uppercase" }}>
                  Total
                </span>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 32, fontWeight: 500, color: "#FBF3D4", letterSpacing: "0.01em" }}>
                  ₹{total}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={addSubscriptionToCart}
              style={{
                marginTop: 16,
                width: "100%",
                background: `rgba(${GOLD},0.18)`,
                border: `1px solid rgba(${GOLD},0.75)`,
                borderRadius: 10,
                padding: "16px 18px",
                fontFamily: "var(--font-body)",
                fontSize: 11, fontWeight: 400,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: "#FBF3D4",
                cursor: "pointer",
                transition: "background 200ms ease, border-color 200ms ease",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Add to Cart →
            </button>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: 10,
                width: "100%",
                background: "transparent",
                border: "1px solid rgba(240,223,200,0.15)",
                borderRadius: 10,
                padding: "12px 18px",
                fontFamily: "var(--font-body)",
                fontSize: 10, fontWeight: 300,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: "rgba(240,223,200,0.5)",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Start over
            </button>
          </Section>
        )}
      </div>

      <style>{`
        .cdx-sub-cta:hover { background: rgba(${GOLD},0.18) !important; border-color: rgba(${GOLD},0.9) !important; color: #FBF3D4 !important; }
        .cdx-sub-row:hover { background: rgba(${GOLD},0.06) !important; border-color: rgba(${GOLD},0.7) !important; }
        .cdx-sub-next:hover:not(:disabled) { background: rgba(${GOLD},0.2) !important; border-color: rgba(${GOLD},0.9) !important; color: #FBF3D4 !important; }
        .cdx-sub-back:hover { color: rgba(${GOLD},0.95) !important; }
      `}</style>
    </div>
  );
}

/* ── Step shell with title + back link ── */
function Section({ title, sub, onBack, children }: { title: string; sub: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="cdx-sub-back"
        style={{
          background: "transparent", border: "none", cursor: "pointer",
          padding: 0, marginBottom: 18,
          fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300,
          letterSpacing: "0.3em", textTransform: "uppercase",
          color: "rgba(240,223,200,0.45)",
          display: "inline-flex", alignItems: "center", gap: 8,
          transition: "color 200ms ease",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span aria-hidden="true">←</span> Back
      </button>

      <h2 style={{ margin: "0 0 6px", fontFamily: "var(--font-heading)", fontSize: 28, fontWeight: 400, color: "#FBF3D4", letterSpacing: "0.01em" }}>
        {title}
      </h2>
      <p style={{ margin: "0 0 22px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(240,223,200,0.4)" }}>
        {sub}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

/* ── A single tappable row card ── */
function OptionRow({ title, sub, selected, onClick, multi = false }: {
  title: string; sub: string; selected: boolean; onClick: () => void; multi?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cdx-sub-row"
      style={{
        width: "100%",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        background: selected ? `rgba(${GOLD},0.1)` : "#0a0805",
        border: `1px solid rgba(${GOLD},${selected ? 0.85 : 0.4})`,
        borderRadius: 12,
        padding: "16px 20px",
        cursor: "pointer",
        textAlign: "left",
        color: "#f5f0e8",
        transition: "background 200ms ease, border-color 200ms ease",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 400, color: "#f5f0e8", letterSpacing: "0.01em" }}>
          {title}
        </span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, color: "#8a7a5a", letterSpacing: "0.18em", textTransform: "uppercase" }}>
          {sub}
        </span>
      </span>
      <span aria-hidden="true" style={{
        flexShrink: 0,
        width: 20, height: 20,
        borderRadius: multi ? 4 : "50%",
        border: `1px solid rgba(${GOLD},${selected ? 0.95 : 0.4})`,
        background: selected ? `rgba(${GOLD},0.95)` : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background 200ms ease, border-color 200ms ease",
      }}>
        {selected && (
          <span style={{ color: "#0a0805", fontSize: 12, lineHeight: 1, fontWeight: 600 }}>✓</span>
        )}
      </span>
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      padding: "14px 0",
      borderBottom: "1px solid rgba(240,223,200,0.08)",
      gap: 16,
    }}>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.3em", textTransform: "uppercase", color: `rgba(${GOLD},0.7)` }}>
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 300, color: "#f5f0e8", textAlign: "right", letterSpacing: "0.02em" }}>
        {value}
      </span>
    </div>
  );
}
