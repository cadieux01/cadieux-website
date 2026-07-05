"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  SETUP_PRODUCTS,
  TIME_SLOTS,
  MIN_UNITS_PER_DELIVERY,
  fetchSubscriptionPlans,
  formatSlot,
  parseIso,
  longDayLabel,
  emptySetupState,
  loadSetupState,
  saveSetupState,
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

  // Drop any per-date slot that has slipped past the 12h10m booking lead
  // (e.g. user sat on the page, or returned later). Keeps the wizard from
  // shipping a server-rejectable slot to checkout.
  useEffect(() => {
    if (!hydrated) return;
    const now = new Date();
    const next: Record<string, string> = {};
    let changed = false;
    for (const [iso, slot] of Object.entries(state.slotByDate)) {
      const ok = bookableSlots(iso, now).some(
        (s) => s.value === slot && !s.disabled,
      );
      if (ok) next[iso] = slot;
      else changed = true;
    }
    if (changed) setState((s) => ({ ...s, slotByDate: next }));
    // We only need this to run when the set of selected dates changes or
    // step lands on the slot screen; running on every state churn is fine
    // because the inner loop short-circuits when nothing is stale.
  }, [hydrated, state.selectedDates, step]);

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

  // Live total used by the calendar bill bar — uses selectedDates count
  // because the user hasn't picked slots yet at step 2.
  const liveTotal = perDelivery * state.selectedDates.length;

  const canNext = useMemo(() => {
    switch (step) {
      case 1: return totalUnitsPerDelivery(state) >= MIN_UNITS_PER_DELIVERY;
      case 2: return state.selectedDates.length >= 1;
      case 3: {
        const rows = listWeekDayRows(state);
        return rows.length > 0 && rows.every((r) => Boolean(state.slotByDate[r.date_iso]));
      }
      case 4: return deliveries.length > 0;
      default: return false;
    }
  }, [step, state, deliveries.length]);

  function proceedToCheckout() {
    if (!canNext) return;
    // replace, not push — keeps history clean so browser-back from later
    // wizard steps lands on /subscription hub, not on a stale wizard state.
    router.replace("/subscriptions/setup/checkout");
  }

  function toggleDate(iso: string) {
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
          <Link href="/subscriptions/track" style={{ fontSize: 13, color: FADED, textDecoration: "none" }}>
            ← Back to subscriptions
          </Link>
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
  const nextTooltip = step === 2 && !canNext ? "Pick at least one delivery date" : "";
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
            fontSize: 13,
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
            fontSize: 13,
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
  const short = MIN_UNITS_PER_DELIVERY - totalUnits;
  return (
    <section>
      <StepTitle>Choose your breads</StepTitle>
      <p style={{ color: FADED, fontSize: 13, marginTop: -6, marginBottom: 18 }}>
        Mix any combination — a subscription needs at least{" "}
        {MIN_UNITS_PER_DELIVERY} loaves per delivery in total.
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
                    <span style={{ fontSize: 13, color: FADED, textDecoration: "line-through" }}>
                      ₹{fmtMoney(mrp!)}
                    </span>
                  )}
                  <span style={{ fontSize: 15, color: GOLD }}>₹{fmtMoney(p.price)}</span>
                </div>
              </div>
              <div style={{ marginTop: 4, fontSize: 13, color: FADED }}>{p.blurb}</div>
              {savings > 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#1D1D1F", fontWeight: 500 }}>
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
                <div style={{ fontSize: 13, color: FADED, marginLeft: 4 }}>per delivery</div>
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          fontSize: 13,
          color: short > 0 ? "#991B1B" : "#1D1D1F", fontWeight: 500,
          letterSpacing: "0.02em",
        }}
        role="status"
      >
        {short > 0
          ? `Add ${short} more ${short === 1 ? "loaf" : "loaves"} to reach the ${MIN_UNITS_PER_DELIVERY}-loaf minimum.`
          : `${totalUnits} loaves per delivery.`}
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
  return (
    <section>
      <StepTitle>Choose your delivery dates</StepTitle>
      <p style={{ color: FADED, fontSize: 13, marginTop: -6, marginBottom: 6 }}>
        Pick any dates that work for you. We&apos;ll deliver fresh on each.
      </p>
      <p style={{ color: FADED, fontSize: 13, marginTop: 0, marginBottom: 18 }}>
        We bake fresh for you — please pick a delivery time at least 12 hours
        from now so your loaf comes straight from the oven.
      </p>
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
      <p style={{ color: FADED, fontSize: 13, marginTop: -6, marginBottom: 6 }}>
        30-minute delivery windows from 7:30 AM to 9:00 PM.
      </p>
      <p style={{ color: FADED, fontSize: 13, marginTop: 0, marginBottom: 18 }}>
        We bake fresh for you — please pick a delivery time at least 12 hours
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
        <div style={{ fontSize: 13, color: FADED, flex: "0 0 auto" }}>Set same time for all:</div>
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
            fontSize: 12,
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
                    fontSize: 12,
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
              <div style={{ fontSize: 14, color: GOLD }}>
                ₹{fmtMoney(l.product.price * l.qty)}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: `1px solid ${FAINT}`, paddingTop: 10 }}>
          <div style={{ fontSize: 13, color: FADED }}>
            ₹{fmtMoney(perDelivery)} / delivery × {deliveries.length}
          </div>
          <div style={{ fontSize: 15, color: GOLD }}>₹{totalAmount.toLocaleString("en-IN")} total</div>
        </div>
        {totalSavings > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#1D1D1F", fontWeight: 500 }}>
            You save ₹{fmtMoney(totalSavings)} versus one-time prices.
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, color: FADED, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
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
            <div style={{ fontSize: 12, color: GOLD }}>{formatSlot(d.slot)}</div>
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
