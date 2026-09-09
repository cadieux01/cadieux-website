"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  SETUP_PRODUCTS,
  TIME_SLOTS,
  fetchSubscriptionPlans,
  formatSlot,
  parseIso,
  longDayLabel,
  emptySetupState,
  loadSetupState,
  saveSetupState,
  clearSetupState,
  revalidateSetupState,
  describeRevalidation,
  buildDeliveries,
  listWeekDayRows,
  totalUnitsPerDelivery,
  amountPerDelivery,
  type SetupState,
  type WizardProduct,
} from "@/lib/subscription-setup";
import { bookableSlots } from "@/lib/delivery-slots";
import { DateCalendar } from "@/components/subscription-setup/DateCalendar";
import Select from "@/components/ui/Select";
import { usePreorderMode } from "@/hooks/usePreorderMode";
import {
  MIN_SUBSCRIPTION_DAYS_PER_WEEK,
  distinctWeekdaysFromDates,
} from "@/lib/subscription-min-days";

const BG = "#C0C8CE";
const GOLD = "#024628";
const TEXT = "#024628";
const FADED = "rgba(2,70,40,0.6)";
const FAINT = "rgba(2,70,40,0.2)";

const TOTAL_STEPS = 4;

export default function SetupPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<SetupState>(emptySetupState());
  const [step, setStep] = useState(1);
  // Set when revalidation drops a stale date/slot; cleared once the
  // customer picks again or starts over.
  const [staleNotice, setStaleNotice] = useState("");
  // Pre-order mode blocks the wizard at its entry (step 1) — the server
  // also refuses subscription creation (belt-and-braces), but disabling
  // Next early keeps the customer from wasting time on a doomed flow.
  const { enabled: preorderMode } = usePreorderMode();
  // Live wizard catalogue. Starts as the hardcoded fallback so the picker
  // renders immediately; fetchSubscriptionPlans() then merges DB prices.
  const [plans, setPlans] = useState<WizardProduct[]>(SETUP_PRODUCTS);

  useEffect(() => {
    setState(loadSetupState());
    setHydrated(true);
    fetchSubscriptionPlans().then(setPlans);
  }, []);

  useEffect(() => {
    if (hydrated) saveSetupState(state);
  }, [state, hydrated]);

  // Drop stored DATES and SLOTS that no longer pass the same availability
  // rules the picker gates on. Previously this dropped stale slots only,
  // which left the selected date behind: the calendar renders a selected
  // date filled even when it is blocked, and blocked cells are `disabled`,
  // so the customer could neither use it nor click it off — and step 3
  // demands a slot for every selected date. That combination was a dead
  // end with no escape but clearing storage.
  //
  // Runs on mount and again whenever the dates or the step change, because
  // the 6-hour lead time can expire while the wizard simply sits open.
  useEffect(() => {
    if (!hydrated) return;
    const result = revalidateSetupState(state);
    if (!result.changed) return;
    setState(result.state);
    // `changed` without `removedAny` is bookkeeping (an orphaned slot key)
    // — clean it, but don't interrupt someone over it.
    if (!result.removedAny) return;
    setStaleNotice(describeRevalidation(result));
    // Never let a dropped date carry on silently — losing one of two days
    // puts the customer under the minimum without changing anything they
    // can see. Send them back to the picker instead of letting them walk
    // into a server-side `slot_too_soon` rejection at payment.
    setStep(2);
  }, [hydrated, state, step]);

  function update(patch: Partial<SetupState>) {
    setState((s) => ({ ...s, ...patch }));
  }

  function next() {
    if (step < TOTAL_STEPS) setStep(step + 1);
  }
  function back() {
    if (step > 1) setStep(step - 1);
  }

  const deliveries = useMemo(() => buildDeliveries(state), [state]);
  const perDelivery = useMemo(() => amountPerDelivery(state, plans), [state, plans]);
  const totalUnits = totalUnitsPerDelivery(state);
  const totalAmount = perDelivery * deliveries.length;
  // Only offer "Start again" once there is something to clear.
  const hasAnyState = totalUnits > 0 || state.selectedDates.length > 0;

  // Live total used by the calendar bill bar — uses selectedDates count
  // because the user hasn't picked slots yet at step 2.
  const liveTotal = perDelivery * state.selectedDates.length;

  const canNext = useMemo(() => {
    // Pre-order mode: entry-only gate. Disable Next on step 1 so the
    // wizard can't advance; server side still refuses on submit.
    if (preorderMode && step === 1) return false;
    switch (step) {
      // One loaf is enough. There is no quantity minimum — the only
      // subscription minimum is the two distinct weekdays checked in
      // step 2 below.
      case 1: return totalUnitsPerDelivery(state) > 0;
      case 2:
        // Subscription rule: ≥2 DISTINCT weekdays across the picked
        // dates. Multiple dates on the same weekday still count as one
        // day (server enforces the same). One day = single order, not
        // a subscription.
        return (
          state.selectedDates.length >= 1 &&
          distinctWeekdaysFromDates(state.selectedDates) >=
            MIN_SUBSCRIPTION_DAYS_PER_WEEK
        );
      case 3: {
        const rows = listWeekDayRows(state);
        return rows.length > 0 && rows.every((r) => Boolean(state.slotByDate[r.date_iso]));
      }
      case 4: return deliveries.length > 0;
      default: return false;
    }
  }, [step, state, deliveries.length, preorderMode]);

  function proceedToCheckout() {
    if (!canNext) return;
    // replace, not push — keeps history clean so browser-back from later
    // wizard steps lands on /subscription hub, not on a stale wizard state.
    router.replace("/subscriptions/setup/checkout");
  }

  /** Escape hatch for anyone stranded by state they can't see or undo:
   *  wipes breads, days, slots AND the stored address, then returns to
   *  step 1. `clearSetupState` covers the legacy keys too. */
  function startAgain() {
    const ok = window.confirm(
      "Clear your breads, delivery days, times and address, and start from the beginning?",
    );
    if (!ok) return;
    clearSetupState();
    setState(emptySetupState());
    setStaleNotice("");
    setStep(1);
  }

  function toggleDate(iso: string) {
    setStaleNotice("");
    setState((s) => {
      const has = s.selectedDates.includes(iso);
      const nextDates = has
        ? s.selectedDates.filter((d) => d !== iso)
        : [...s.selectedDates, iso].sort();
      const nextSlots = { ...s.slotByDate };
      if (has) delete nextSlots[iso];
      return { ...s, selectedDates: nextDates, slotByDate: nextSlots };
    });
  }

  if (!hydrated) {
    return <main style={pageStyle} />;
  }

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <header style={{ marginBottom: 28 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <Link href="/subscriptions/track" style={{ fontSize: 16, color: FADED, textDecoration: "none" }}>
              ← Back to subscriptions
            </Link>
            {hasAnyState ? (
              <button
                onClick={startAgain}
                style={{
                  flex: "0 0 auto",
                  padding: "8px 16px",
                  background: "transparent",
                  border: `1px solid ${FAINT}`,
                  borderRadius: 999,
                  color: TEXT,
                  fontFamily: "var(--font-body)",
                  fontSize: 14,
                  cursor: "pointer",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                Start again
              </button>
            ) : null}
          </div>
          <h1
            style={{
              marginTop: 16,
              fontFamily: "var(--font-heading)",
              fontWeight: 300,
              fontSize: "clamp(28px,5vw,42px)",
              letterSpacing: "0.01em",
            }}
          >
            Build your subscription
          </h1>
          <ProgressDots step={step} total={TOTAL_STEPS} />
        </header>

        {staleNotice ? (
          <div
            role="status"
            style={{
              background: "#FBF3D4",
              border: "1px solid rgba(2,70,40,0.25)",
              padding: "16px 20px",
              margin: "0 0 24px",
            }}
          >
            <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.35em", textTransform: "uppercase", color: "#024628" }}>
              Dates updated
            </p>
            <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 300, lineHeight: 1.55, color: "#024628" }}>
              {staleNotice}
            </p>
          </div>
        ) : null}

        {preorderMode ? (
          <div
            style={{
              background: "#FBF3D4",
              border: "1px solid rgba(2,70,40,0.25)",
              padding: "16px 20px",
              margin: "0 0 24px",
            }}
          >
            <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.35em", textTransform: "uppercase", color: "#024628" }}>
              Pre-order
            </p>
            <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 300, lineHeight: 1.55, color: "#024628" }}>
              Subscriptions open once daily deliveries begin. In the meantime, place a one-time reservation from the shop — we&apos;ll confirm your first delivery date by SMS + WhatsApp.
            </p>
          </div>
        ) : null}

        {step === 1 && (
          <Step1Product
            plans={plans}
            qtyBySlug={state.qtyBySlug}
            totalUnits={totalUnits}
            onAdjustQty={(slug, delta) =>
              setState((s) => {
                const cur = s.qtyBySlug[slug] ?? 0;
                const nextQty = Math.min(5, Math.max(0, cur + delta));
                const nextMap = { ...s.qtyBySlug };
                if (nextQty <= 0) delete nextMap[slug];
                else nextMap[slug] = nextQty;
                return { ...s, qtyBySlug: nextMap };
              })
            }
          />
        )}
        {step === 2 && (
          <Step2Dates
            selectedDates={state.selectedDates}
            onToggleDate={toggleDate}
            deliveriesCount={state.selectedDates.length}
            totalAmount={liveTotal}
          />
        )}
        {step === 3 && (
          <Step3Slots
            state={state}
            onChange={(slotByDate) => update({ slotByDate })}
          />
        )}
        {step === 4 && (
          <Step4Review
            plans={plans}
            qtyBySlug={state.qtyBySlug}
            perDelivery={perDelivery}
            deliveries={deliveries}
            totalAmount={totalAmount}
          />
        )}

        <NavRow
          step={step}
          canNext={canNext}
          onBack={back}
          onNext={step === TOTAL_STEPS ? proceedToCheckout : next}
          finalLabel="Proceed to checkout"
        />
      </div>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100dvh",
  background: BG,
  color: TEXT,
  padding: "60px 20px 140px",
  fontFamily: "var(--font-body)",
};

// ── Progress + nav ───────────────────────────────────────────────────────

function ProgressDots({ step, total }: { step: number; total: number }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 22, alignItems: "center" }}>
      {Array.from({ length: total }).map((_, i) => {
        const idx = i + 1;
        const isActive = idx === step;
        const isComplete = idx < step;
        // Active = solid gold dot; complete = gold ring; future = faint outline.
        const bg = isActive ? GOLD : "transparent";
        const border = isActive || isComplete ? GOLD : "rgba(240,223,200,0.25)";
        return (
          <div
            key={i}
            aria-current={isActive ? "step" : undefined}
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: bg,
              border: `1.5px solid ${border}`,
              opacity: !isActive && !isComplete ? 0.5 : 1,
              transition: "background 0.2s ease, border-color 0.2s ease, opacity 0.2s ease",
            }}
          />
        );
      })}
    </div>
  );
}

function NavRow({
  step,
  canNext,
  onBack,
  onNext,
  finalLabel,
}: {
  step: number;
  canNext: boolean;
  onBack: () => void;
  onNext: () => void;
  finalLabel: string;
}) {
  const nextTooltip =
    step === 2 && !canNext
      ? `A subscription needs ${MIN_SUBSCRIPTION_DAYS_PER_WEEK}+ delivery days per week. For a single day, place a one-time order instead.`
      : "";
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        background: "#C0C8CE",
        borderTop: `1px solid #024628`,
        padding: "16px 20px",
        zIndex: 50,
      }}
    >
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <button
          onClick={onBack}
          disabled={step === 1}
          style={{
            padding: "12px 22px",
            background: "transparent",
            border: `1px solid ${FAINT}`,
            borderRadius: 999,
            color: step === 1 ? FAINT : TEXT,
            fontSize: 14,
            cursor: step === 1 ? "not-allowed" : "pointer",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!canNext}
          title={nextTooltip}
          style={{
            padding: "12px 28px",
            background: canNext ? GOLD : FAINT,
            border: "none",
            borderRadius: 999,
            color: canNext ? "#FBF3D4" : FADED,
            fontSize: 14,
            fontWeight: 600,
            cursor: canNext ? "pointer" : "not-allowed",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          {step === TOTAL_STEPS ? finalLabel : "Next"}
        </button>
      </div>
    </div>
  );
}

// ── Step 1: Product + qty ────────────────────────────────────────────────

function Step1Product({
  plans,
  qtyBySlug,
  totalUnits,
  onAdjustQty,
}: {
  plans: WizardProduct[];
  qtyBySlug: Record<string, number>;
  totalUnits: number;
  onAdjustQty: (slug: string, delta: number) => void;
}) {
  return (
    <section>
      <StepTitle>Choose your breads</StepTitle>
      <p style={{ color: FADED, fontSize: 16, marginTop: -6, marginBottom: 18 }}>
        Mix any combination — one loaf per delivery is enough.
      </p>
      <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>
        {plans.map((p) => {
          const qty = qtyBySlug[p.slug] ?? 0;
          const selected = qty > 0;
          const mrp = typeof p.mrp_inr === "number" ? p.mrp_inr : null;
          const showStrike = mrp !== null && mrp > p.price;
          const savings =
            typeof p.subscription_savings_inr === "number"
              ? p.subscription_savings_inr
              : mrp !== null
              ? mrp - p.price
              : 0;
          const pct =
            typeof p.subscription_discount_pct === "number"
              ? p.subscription_discount_pct
              : mrp && mrp > 0
              ? Math.round((savings / mrp) * 100)
              : 0;
          return (
            <div
              key={p.slug}
              style={{
                padding: 18,
                borderRadius: 14,
                border: `1px solid ${selected ? GOLD : FAINT}`,
                background: selected ? "rgba(2,70,40,0.08)" : "transparent",
                color: TEXT,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 22, letterSpacing: "0.02em" }}>
                  {p.title}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  {showStrike && (
                    <span style={{ fontSize: 16, color: FADED, textDecoration: "line-through" }}>
                      ₹{fmtMoney(mrp!)}
                    </span>
                  )}
                  <span style={{ fontSize: 16, color: GOLD }}>₹{fmtMoney(p.price)}</span>
                </div>
              </div>
              <div style={{ marginTop: 4, fontSize: 16, color: FADED }}>{p.blurb}</div>
              {savings > 0 && (
                <div style={{ marginTop: 6, fontSize: 16, color: "#1D1D1F", fontWeight: 500 }}>
                  You save ₹{fmtMoney(savings)}{pct > 0 ? ` (${pct}%)` : ""} per loaf
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
                <button
                  onClick={() => onAdjustQty(p.slug, -1)}
                  disabled={qty <= 0}
                  aria-label={`Decrease ${p.title}`}
                  style={qtyBtnStyle(qty <= 0)}
                >
                  −
                </button>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 28, minWidth: 34, textAlign: "center" }}>
                  {qty}
                </div>
                <button
                  onClick={() => onAdjustQty(p.slug, 1)}
                  disabled={qty >= 5}
                  aria-label={`Increase ${p.title}`}
                  style={qtyBtnStyle(qty >= 5)}
                >
                  +
                </button>
                <div style={{ fontSize: 16, color: FADED, marginLeft: 4 }}>per delivery</div>
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          fontSize: 16,
          color: totalUnits === 0 ? "#991B1B" : "#1D1D1F", fontWeight: 500,
          letterSpacing: "0.02em",
        }}
        role="status"
      >
        {totalUnits === 0
          ? "Pick at least one loaf."
          : `${totalUnits} ${totalUnits === 1 ? "loaf" : "loaves"} per delivery.`}
      </div>
    </section>
  );
}

/** Money formatter that drops the decimals for whole numbers but keeps
 *  two places for fractional prices (e.g. ₹107.10). */
function fmtMoney(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString("en-IN")
    : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qtyBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 44,
    height: 44,
    borderRadius: 999,
    background: "transparent",
    border: `1px solid ${disabled ? FAINT : GOLD}`,
    color: disabled ? FAINT : GOLD,
    fontSize: 22,
    cursor: disabled ? "not-allowed" : "pointer",
    lineHeight: 1,
  };
}

// ── Step 2: Date calendar ────────────────────────────────────────────────

function Step2Dates({
  selectedDates,
  onToggleDate,
  deliveriesCount,
  totalAmount,
}: {
  selectedDates: string[];
  onToggleDate: (iso: string) => void;
  deliveriesCount: number;
  totalAmount: number;
}) {
  // Live count of DISTINCT weekdays so we can render a helper line under
  // the copy explaining why "Next" stays disabled with only one weekday
  // selected. Matches the server-side rule enforced on all 3 endpoints.
  const distinctWeekdays = distinctWeekdaysFromDates(selectedDates);
  const needsMoreWeekdays =
    selectedDates.length > 0 &&
    distinctWeekdays < MIN_SUBSCRIPTION_DAYS_PER_WEEK;
  return (
    <section>
      <StepTitle>Choose your delivery dates</StepTitle>
      <p style={{ color: FADED, fontSize: 16, marginTop: -6, marginBottom: 6 }}>
        Pick any dates that work for you. We&apos;ll deliver fresh on each.
      </p>
      <p style={{ color: FADED, fontSize: 16, marginTop: 0, marginBottom: 6 }}>
        We bake fresh for you — please pick a delivery time at least 6 hours
        from now so your loaf comes straight from the oven.
      </p>
      <p style={{ color: FADED, fontSize: 14, marginTop: 0, marginBottom: 18 }}>
        A subscription needs {MIN_SUBSCRIPTION_DAYS_PER_WEEK}+ delivery days
        per week (that&apos;s how the 10% subscription price applies). For a
        single day, place a one-time order instead.
      </p>
      {needsMoreWeekdays ? (
        <p
          role="status"
          style={{
            color: TEXT,
            fontSize: 14,
            marginTop: 0,
            marginBottom: 18,
            padding: "10px 14px",
            border: `1px solid ${FAINT}`,
            borderRadius: 12,
            background: "rgba(2,70,40,0.05)",
          }}
        >
          Add at least one more weekday — right now you&apos;ve picked{" "}
          {distinctWeekdays} of {MIN_SUBSCRIPTION_DAYS_PER_WEEK} required.
        </p>
      ) : null}
      <DateCalendar
        selectedDates={selectedDates}
        onToggleDate={onToggleDate}
        deliveriesCount={deliveriesCount}
        totalAmount={totalAmount}
      />
    </section>
  );
}

// ── Step 3: Time slot per date ──────────────────────────────────────────

function Step3Slots({
  state,
  onChange,
}: {
  state: SetupState;
  onChange: (next: Record<string, string>) => void;
}) {
  const rows = useMemo(() => listWeekDayRows(state), [state]);
  const [bulkSlot, setBulkSlot] = useState<string>("");

  // Single `now` per render so every row uses the same too-soon boundary;
  // bookableSlots is pure so this is cheap to recompute.
  const now = new Date();

  function setSlot(dateIso: string, slot: string) {
    onChange({ ...state.slotByDate, [dateIso]: slot });
  }

  function applyToAll() {
    if (!bulkSlot) return;
    const next: Record<string, string> = { ...state.slotByDate };
    rows.forEach((r) => {
      // Skip dates where the bulk slot would be too soon — keep their
      // existing value (if any) so the user can pick something valid.
      const ok = bookableSlots(r.date_iso, now).some(
        (s) => s.value === bulkSlot && !s.disabled,
      );
      if (ok) next[r.date_iso] = bulkSlot;
    });
    onChange(next);
  }

  return (
    <section>
      <StepTitle>Pick a time slot for each delivery</StepTitle>
      <p style={{ color: FADED, fontSize: 16, marginTop: -6, marginBottom: 6 }}>
        Three delivery windows: Morning (6 – 10 AM), Midday (10 AM – 2 PM), Evening (4 – 9 PM).
      </p>
      <p style={{ color: FADED, fontSize: 16, marginTop: 0, marginBottom: 18 }}>
        We bake fresh for you — please pick a delivery time at least 6 hours
        from now so your loaf comes straight from the oven.
      </p>

      <div
        style={{
          padding: 14,
          borderRadius: 12,
          background: "transparent",
          border: `1px solid ${FAINT}`,
          marginBottom: 18,
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 16, color: FADED, flex: "0 0 auto" }}>Set same time for all:</div>
        <div style={{ minWidth: 180, flex: "0 0 auto" }}>
          <Select
            value={bulkSlot}
            onChange={setBulkSlot}
            ariaLabel="Set same slot for all deliveries"
            placeholder="— pick a slot —"
            options={TIME_SLOTS.map((s) => ({ value: s, label: formatSlot(s) }))}
          />
        </div>
        <button
          onClick={applyToAll}
          disabled={!bulkSlot}
          style={{
            padding: "8px 16px",
            borderRadius: 999,
            border: "none",
            background: bulkSlot ? GOLD : FAINT,
            color: bulkSlot ? "#FBF3D4" : FADED,
            fontSize: 14,
            fontWeight: 600,
            cursor: bulkSlot ? "pointer" : "not-allowed",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          Apply
        </button>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((r) => {
          const slot = state.slotByDate[r.date_iso] ?? "";
          const daySlots = bookableSlots(r.date_iso, now);
          const allDisabled = daySlots.length === 0 || daySlots.every((s) => s.disabled);
          return (
            <div
              key={r.date_iso}
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                background: "transparent",
                border: `1px solid ${FAINT}`,
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 16 }}>
                  {longDayLabel(r.date)}
                </div>
              </div>
              {allDisabled ? (
                <div
                  style={{
                    minWidth: 170,
                    fontSize: 16,
                    color: "#991B1B",
                    letterSpacing: "0.02em",
                    lineHeight: 1.4,
                  }}
                  role="status"
                >
                  No slots available for this date — please choose another day.
                </div>
              ) : (
                <div style={{ minWidth: 170 }}>
                  <Select
                    value={slot}
                    onChange={(v) => setSlot(r.date_iso, v)}
                    ariaLabel={`Delivery slot for ${longDayLabel(r.date)}`}
                    placeholder="— pick a slot —"
                    options={daySlots.map((s) => ({
                      value: s.value,
                      label: `${formatSlot(s.value)}${s.disabled ? " — too soon" : ""}`,
                      disabled: s.disabled,
                    }))}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}


// ── Step 4: Review ───────────────────────────────────────────────────────

function Step4Review({
  plans,
  qtyBySlug,
  perDelivery,
  deliveries,
  totalAmount,
}: {
  plans: WizardProduct[];
  qtyBySlug: Record<string, number>;
  perDelivery: number;
  deliveries: ReturnType<typeof buildDeliveries>;
  totalAmount: number;
}) {
  const lines = plans
    .filter((p) => (qtyBySlug[p.slug] ?? 0) > 0)
    .map((p) => ({ product: p, qty: qtyBySlug[p.slug] }));
  if (lines.length === 0) return null;
  const totalSavings = lines.reduce((sum, l) => {
    const mrp = typeof l.product.mrp_inr === "number" ? l.product.mrp_inr : l.product.price;
    return sum + (mrp - l.product.price) * l.qty * deliveries.length;
  }, 0);
  return (
    <section>
      <StepTitle>Review & confirm</StepTitle>
      <div
        style={{
          padding: 18,
          borderRadius: 14,
          background: "rgba(2,70,40,0.06)",
          border: `1px solid ${GOLD}`,
          marginBottom: 20,
        }}
      >
        <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
          {lines.map((l) => (
            <div
              key={l.product.slug}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}
            >
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 20 }}>
                {l.product.title} × {l.qty}
              </div>
              <div style={{ fontSize: 16, color: GOLD }}>
                ₹{fmtMoney(l.product.price * l.qty)}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: `1px solid ${FAINT}`, paddingTop: 10 }}>
          <div style={{ fontSize: 16, color: FADED }}>
            ₹{fmtMoney(perDelivery)} / delivery × {deliveries.length}
          </div>
          <div style={{ fontSize: 16, color: GOLD }}>₹{totalAmount.toLocaleString("en-IN")} total</div>
        </div>
        {totalSavings > 0 && (
          <div style={{ marginTop: 8, fontSize: 16, color: "#1D1D1F", fontWeight: 500 }}>
            You save ₹{fmtMoney(totalSavings)} versus one-time prices.
          </div>
        )}
      </div>

      <div style={{ fontSize: 14, color: FADED, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
        Schedule
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {deliveries.map((d) => (
          <div
            key={d.delivery_date + d.day_key}
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              background: "transparent",
              border: `1px solid ${FAINT}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 16 }}>
                {longDayLabel(parseIso(d.delivery_date))}
              </div>
            </div>
            <div style={{ fontSize: 16, color: GOLD }}>{formatSlot(d.slot)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StepTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "var(--font-heading)",
        fontWeight: 300,
        fontSize: 24,
        margin: "0 0 14px",
        letterSpacing: "0.01em",
      }}
    >
      {children}
    </h2>
  );
}
