"use client";

// /mkt/money client — repeat rate at top (the number the business
// turns on), break-even jar, daily + weekly bars, UPI/cash, source.
//
// The screen renders in this order deliberately: the brief said
// repeat rate is the number the business turns on and must not be
// buried, so it lands above the fold on every viewport. The jar is
// next because the admin sets his weekly target from there; without
// it, the rest of the page is interesting but not actionable.

import { useCallback, useEffect, useState } from "react";

import { MKT } from "@/components/mkt/theme";
import { mktFetch, mktPatch } from "@/lib/mkt-fetch";

type RevenueBucket = { key: string; paise: number; orders: number };
type MoneyResponse = {
  days: RevenueBucket[];
  weeks: RevenueBucket[];
  repeat: {
    window_days: number;
    orders: number;
    distinct_customers: number;
    repeat_customers: number;
    repeat_rate_pct: number;
  };
  methodSplit: {
    cash: number;
    upi: number;
    split: number;
    other: number;
    unrecorded: number;
  };
  sourceSplit: { online: number; offline: number; manual: number };
  jar: {
    target_paise: number | null;
    current_week_paise: number;
    current_week_key: string;
    pct_of_target: number;
  };
  window: { from: string; days: number; rows_fetched: number };
};

const inr = (rupees: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);

export function MoneyClient() {
  const [data, setData] = useState<MoneyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const j = await mktFetch<MoneyResponse>("/api/mkt/money", {
        timeoutMs: 30_000,
      });
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div
        role="alert"
        style={{
          border: `1px solid ${MKT.error}`,
          background: MKT.errorBg,
          color: MKT.error,
          padding: "0.7rem 0.9rem",
          borderRadius: 8,
        }}
      >
        {error}
      </div>
    );
  }
  if (!data) {
    return <SkeletonGrid />;
  }

  return (
    <div style={{ display: "grid", gap: "1.6rem" }}>
      <RepeatRateHero repeat={data.repeat} />
      <BreakEvenJar jar={data.jar} onSaved={() => void load()} />

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "1rem",
        }}
      >
        <DailyBars days={data.days} />
        <WeeklyBars weeks={data.weeks} />
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1rem",
        }}
      >
        <MethodSplit split={data.methodSplit} />
        <SourceSplit split={data.sourceSplit} />
      </section>
    </div>
  );
}

// ── Repeat rate hero ───────────────────────────────────────────────

function RepeatRateHero({
  repeat,
}: {
  repeat: MoneyResponse["repeat"];
}) {
  const pct = repeat.repeat_rate_pct;
  // colour: red when repeat rate is very low (the business is in
  // "almost no one orders twice" territory), green when high.
  const colour =
    pct < 10 ? MKT.error : pct < 20 ? "#B35A00" : MKT.green;
  return (
    <section
      style={{
        background: "#FFFFFF",
        border: `1px solid ${MKT.ash}`,
        borderRadius: 12,
        boxShadow: MKT.cardShadow,
        padding: "1.2rem 1.4rem",
        display: "grid",
        gap: "0.3rem",
      }}
    >
      <span
        style={{
          color: MKT.mute,
          fontSize: "0.85rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        Repeat rate · last {repeat.window_days} days
      </span>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.8rem", flexWrap: "wrap" }}>
        <strong
          style={{
            color: colour,
            fontSize: "clamp(2.2rem, 7vw, 3.2rem)",
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {pct.toFixed(1)}%
        </strong>
        <span style={{ color: MKT.ink, fontSize: "1rem" }}>
          {repeat.repeat_customers} of {repeat.distinct_customers} customers ordered twice or more
        </span>
      </div>
      <p style={{ margin: 0, color: MKT.mute, fontSize: "0.9rem" }}>
        {repeat.orders} order{repeat.orders === 1 ? "" : "s"} over this window. Most
        customers order about once a week — nudging the second order up is the
        number the business turns on.
      </p>
    </section>
  );
}

// ── Break-even jar ─────────────────────────────────────────────────

function BreakEvenJar({
  jar,
  onSaved,
}: {
  jar: MoneyResponse["jar"];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftRupees, setDraftRupees] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const targetRupees = jar.target_paise != null ? jar.target_paise / 100 : null;
  const currentRupees = jar.current_week_paise / 100;

  const save = async () => {
    const rupees = Number(draftRupees);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setErr("Enter a positive rupee amount");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await mktPatch("/api/mkt/money/target", {
        target_paise: Math.round(rupees * 100),
      });
      setEditing(false);
      setDraftRupees("");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      style={{
        background: "#FFFFFF",
        border: `1px solid ${MKT.ash}`,
        borderRadius: 12,
        boxShadow: MKT.cardShadow,
        padding: "1rem 1.2rem",
        display: "grid",
        gap: "0.6rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "0.6rem",
          flexWrap: "wrap",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: "1.1rem",
            color: MKT.green,
            fontWeight: 700,
          }}
        >
          Break-even jar · this week
        </h2>
        <span style={{ color: MKT.mute, fontSize: "0.85rem" }}>
          week of {jar.current_week_key}
        </span>
      </div>

      {targetRupees === null && !editing ? (
        <div
          role="status"
          style={{
            border: `1px dashed ${MKT.ash}`,
            background: MKT.hover,
            padding: "1rem 1.1rem",
            borderRadius: 10,
            display: "grid",
            gap: "0.5rem",
          }}
        >
          <strong style={{ color: MKT.green, fontSize: "1rem" }}>
            Set your weekly target
          </strong>
          <p style={{ margin: 0, color: MKT.ink, fontSize: "0.92rem" }}>
            Nothing is stored yet. Type the rupee figure that covers a week of
            fixed costs and the jar starts tracking against it immediately.
          </p>
          <button
            type="button"
            onClick={() => {
              setDraftRupees("");
              setEditing(true);
            }}
            style={btnPrimary}
          >
            Set target
          </button>
        </div>
      ) : editing ? (
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <label style={{ color: MKT.mute, fontSize: "0.9rem" }}>
            Weekly target (₹)
          </label>
          <input
            type="number"
            min={1}
            value={draftRupees}
            onChange={(e) => setDraftRupees(e.target.value)}
            disabled={busy}
            placeholder={targetRupees ? String(targetRupees) : "50000"}
            style={{ maxWidth: 160 }}
          />
          <button
            type="button"
            onClick={save}
            disabled={busy || !draftRupees}
            style={btnPrimary}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setErr(null);
            }}
            disabled={busy}
            style={btnQuiet}
          >
            Cancel
          </button>
          {err ? (
            <span style={{ color: MKT.error, fontSize: "0.85rem" }}>{err}</span>
          ) : null}
        </div>
      ) : (
        <>
          <JarBar pct={jar.pct_of_target} />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "0.6rem",
              flexWrap: "wrap",
              color: MKT.ink,
              fontSize: "0.92rem",
            }}
          >
            <span>
              <strong>{inr(currentRupees)}</strong> this week
            </span>
            <span style={{ color: MKT.mute }}>
              target <strong style={{ color: MKT.ink }}>{inr(targetRupees ?? 0)}</strong> ·{" "}
              {jar.pct_of_target}% filled
            </span>
            <button
              type="button"
              onClick={() => {
                setDraftRupees(String(targetRupees ?? ""));
                setEditing(true);
              }}
              style={btnQuiet}
            >
              Edit target
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function JarBar({ pct }: { pct: number }) {
  return (
    <div
      aria-label={`Break-even jar ${pct}% filled`}
      style={{
        width: "100%",
        height: 24,
        background: MKT.hover,
        border: `1px solid ${MKT.ash}`,
        borderRadius: 12,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background:
            pct >= 100
              ? MKT.green
              : `linear-gradient(90deg, ${MKT.green} 0%, #0F7A47 100%)`,
          transition: "width 240ms ease",
        }}
      />
      {pct < 15 ? null : (
        <span
          style={{
            position: "absolute",
            left: 10,
            top: 0,
            height: "100%",
            display: "flex",
            alignItems: "center",
            color: MKT.cream,
            fontSize: "0.82rem",
            fontWeight: 700,
          }}
        >
          {pct}%
        </span>
      )}
    </div>
  );
}

// ── Daily / Weekly bar strips ──────────────────────────────────────

function DailyBars({ days }: { days: RevenueBucket[] }) {
  const max = Math.max(1, ...days.map((d) => d.paise));
  return (
    <Panel title={`Sales · last ${days.length} days`}>
      <BarStrip buckets={days} max={max} />
    </Panel>
  );
}

function WeeklyBars({ weeks }: { weeks: RevenueBucket[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.paise));
  return (
    <Panel title={`Sales · last ${weeks.length} weeks`}>
      <BarStrip buckets={weeks} max={max} />
    </Panel>
  );
}

function BarStrip({
  buckets,
  max,
}: {
  buckets: RevenueBucket[];
  max: number;
}) {
  const gap = 4;
  const H = 110;
  return (
    <div
      role="img"
      aria-label={`${buckets.length}-bucket revenue strip`}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
        gap,
        alignItems: "end",
        height: H,
        marginTop: "0.4rem",
      }}
    >
      {buckets.map((b) => {
        const h = Math.max(2, (b.paise / max) * H);
        return (
          <div
            key={b.key}
            title={`${b.key} — ${inr(b.paise / 100)} from ${b.orders} order${b.orders === 1 ? "" : "s"}`}
            style={{
              height: h,
              borderRadius: 3,
              background: b.paise === 0 ? MKT.ash : MKT.green,
              minWidth: 2,
            }}
          />
        );
      })}
    </div>
  );
}

// ── UPI vs cash — the split row is its OWN slice ───────────────────

function MethodSplit({
  split,
}: {
  split: MoneyResponse["methodSplit"];
}) {
  const total = split.cash + split.upi + split.split + split.other;
  // Hide "unrecorded" from the ratio chart (it's noise from online
  // orders) — show it as a side note so the admin can see that most
  // orders haven't recorded a settlement method yet.
  return (
    <Panel title="COD settlement · cash vs UPI">
      {total === 0 ? (
        <p style={{ margin: 0, color: MKT.mute, fontSize: "0.92rem" }}>
          No COD rows settled in this window yet. The field
          <code
            style={{
              background: MKT.hover,
              padding: "0 0.3rem",
              margin: "0 0.2rem",
              borderRadius: 3,
            }}
          >
            orders.cod_settled_method
          </code>
          is written when delivery records the handover.
        </p>
      ) : (
        <>
          <RatioBar
            slices={[
              { label: "Cash", n: split.cash, colour: MKT.green },
              { label: "UPI", n: split.upi, colour: MKT.blue },
              { label: "Cash + UPI", n: split.split, colour: "#8A5A00" },
              { label: "Other", n: split.other, colour: MKT.mute },
            ]}
            total={total}
          />
          <p style={{ margin: "0.3rem 0 0", color: MKT.mute, fontSize: "0.82rem" }}>
            Cash + UPI rows are split settlements — they are counted as their
            own slice, NOT folded into either atomic bucket.
          </p>
        </>
      )}
      <p style={{ margin: "0.4rem 0 0", color: MKT.mute, fontSize: "0.82rem" }}>
        {split.unrecorded} order{split.unrecorded === 1 ? "" : "s"} in the
        window have no settlement method recorded (online orders + COD rows
        not yet handed over).
      </p>
    </Panel>
  );
}

// ── Source split — online / offline / manual ──────────────────────

function SourceSplit({
  split,
}: {
  split: MoneyResponse["sourceSplit"];
}) {
  const total = split.online + split.offline + split.manual;
  return (
    <Panel title="Source · where the order came from">
      {total === 0 ? (
        <p style={{ margin: 0, color: MKT.mute, fontSize: "0.92rem" }}>
          No orders in the window.
        </p>
      ) : (
        <RatioBar
          slices={[
            { label: "Online", n: split.online, colour: MKT.green },
            { label: "Offline (counter)", n: split.offline, colour: MKT.blue },
            { label: "Manual / unknown", n: split.manual, colour: MKT.mute },
          ]}
          total={total}
        />
      )}
      <p style={{ margin: "0.3rem 0 0", color: MKT.mute, fontSize: "0.82rem" }}>
        Online = <code>web + app</code>. Offline = counter. Manual bundles
        the historical pre-source-tracking rows (null source), which should
        be 0 in a recent window.
      </p>
    </Panel>
  );
}

function RatioBar({
  slices,
  total,
}: {
  slices: Array<{ label: string; n: number; colour: string }>;
  total: number;
}) {
  return (
    <>
      <div
        style={{
          display: "flex",
          width: "100%",
          height: 22,
          borderRadius: 999,
          overflow: "hidden",
          border: `1px solid ${MKT.ash}`,
        }}
      >
        {slices.map((s) =>
          s.n === 0 ? null : (
            <div
              key={s.label}
              title={`${s.label}: ${s.n} (${((s.n / total) * 100).toFixed(1)}%)`}
              style={{
                width: `${(s.n / total) * 100}%`,
                background: s.colour,
              }}
            />
          ),
        )}
      </div>
      <ul style={{ margin: "0.5rem 0 0", padding: 0, listStyle: "none", display: "grid", gap: "0.2rem" }}>
        {slices.map((s) => (
          <li
            key={s.label}
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              fontSize: "0.88rem",
              color: MKT.ink,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 12,
                height: 12,
                background: s.colour,
                borderRadius: 3,
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1 }}>{s.label}</span>
            <span style={{ color: MKT.mute, fontVariantNumeric: "tabular-nums" }}>
              {s.n} · {total === 0 ? "0%" : `${((s.n / total) * 100).toFixed(1)}%`}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── Shared tiny UI ────────────────────────────────────────────────

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "#FFFFFF",
        border: `1px solid ${MKT.ash}`,
        borderRadius: 10,
        boxShadow: MKT.cardShadow,
        padding: "0.9rem 1rem",
      }}
    >
      <h3
        style={{
          margin: "0 0 0.3rem",
          fontSize: "0.92rem",
          fontWeight: 700,
          color: MKT.green,
          letterSpacing: "0.03em",
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function SkeletonGrid() {
  return (
    <div style={{ display: "grid", gap: "1.2rem" }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            background: "#FFFFFF",
            border: `1px solid ${MKT.ash}`,
            borderRadius: 10,
            padding: "0.9rem 1rem",
            boxShadow: MKT.cardShadow,
            display: "grid",
            gap: "0.4rem",
          }}
        >
          <Shimmer w="40%" h={14} />
          <Shimmer w="80%" h={30} />
          <Shimmer w="60%" h={10} />
        </div>
      ))}
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes mktMoneyShim { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }`,
        }}
      />
    </div>
  );
}

function Shimmer({ w, h }: { w: string; h: number }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 4,
        background:
          "linear-gradient(90deg, rgba(192,200,206,0.25) 0%, rgba(192,200,206,0.55) 50%, rgba(192,200,206,0.25) 100%)",
        backgroundSize: "800px 100%",
        animation: "mktMoneyShim 1.2s linear infinite",
      }}
    />
  );
}

const btnPrimary: React.CSSProperties = {
  background: MKT.green,
  color: MKT.cream,
  border: "none",
  padding: "0.6rem 0.9rem",
  minHeight: 44,
  borderRadius: 6,
  fontSize: "0.92rem",
  fontWeight: 600,
  cursor: "pointer",
};
const btnQuiet: React.CSSProperties = {
  background: "transparent",
  color: MKT.blue,
  border: `1px solid ${MKT.ash}`,
  padding: "0.6rem 0.75rem",
  minHeight: 44,
  borderRadius: 6,
  fontSize: "0.9rem",
  cursor: "pointer",
};
