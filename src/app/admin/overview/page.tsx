"use client";

// Overview dashboard — "one thing at a time" redesign.
//
// Default view: a compact KPI strip of 6 tiles (Orders, Revenue,
// Customers, Retention Rate, Run Rate, Stores). A top-bar dropdown
// ("What do you want to see?") and clicking any tile both select a
// single metric. When a metric is selected ONLY that metric expands
// into a detail panel: a big headline stat and a formula/chart panel.
//
// Data comes from the single /api/admin/overview?from=&to= round-trip.
// Retention/Run Rate divide-by-zero-guarded (render "—" when no
// subscription base to compute against).
//
// Palette: Foundation Green (#024628) + Grain Cream (#FBF3D4) on the
// admin's dark base. Cream is used for the data marks (high contrast on
// dark); green for selection/accent.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AdminShell } from "@/components/admin/AdminShell";
import {
  DateRangeDropdown,
  resolvePreset,
  toYMD,
  type DateRangeValue,
} from "@/components/admin/DateRangeDropdown";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatINR } from "@/lib/admin-formatting";
import Select from "@/components/ui/Select";

type OverviewResponse = {
  range: { from: string; to: string };
  kpis: {
    revenue_today: number;
    revenue_week: number;
    revenue_month: number;
    revenue_range: number;
    orders_range: number;
    new_customers_range: number;
    active_subs: number;
    paused_subs: number;
    cancelled_subs: number;
    aov_range: number;
    // churn_rate / retention_rate are null when there was no active
    // subscription base at the start of the period (divide-by-zero
    // guard) — the UI renders "—" in that case.
    churn_rate: number | null;
    retention_rate: number | null;
    mrr: number;
    arr: number;
    stores_total: number;
    retail_stores: number;
    serviceable_areas: number;
  };
  daily_revenue: { date: string; revenue: number; orders: number }[];
  orders_by_status: { key: string; count: number }[];
  top_products: { name: string; subscriptions: number; revenue: number }[];
  sub_lifecycle: { key: string; count: number }[];
  customer_cohorts: { month: string; new_customers: number }[];
  monthly_sales: { month: string; revenue: number; orders: number }[];
};

// "Run Rate" = one tile that shows MRR for month-scale ranges and ARR
// for year-scale ranges. Rule: span ≤ 45 days → monthly (MRR/₹ per
// month), else annual (ARR/₹ per year). 45 days is a soft edge picked to
// cover the "this month" and "last month" presets even when the current
// day is late in a 31-day month (max span ≈ 31 days) with headroom, and
// falls short of the 92-day "3 months" preset so quarter/year ranges
// switch cleanly to ARR.
const RUN_RATE_MONTHLY_SPAN_DAYS = 45;

type RunRateScale = { unit: "month" | "year"; value: number; suffix: string };

function runRateFor(data: OverviewResponse): RunRateScale {
  const fromMs = Date.parse(`${data.range.from}T00:00:00Z`);
  const toMs = Date.parse(`${data.range.to}T23:59:59Z`);
  const spanDays =
    Number.isFinite(fromMs) && Number.isFinite(toMs)
      ? Math.max(0, (toMs - fromMs) / 86_400_000)
      : 0;
  if (spanDays <= RUN_RATE_MONTHLY_SPAN_DAYS) {
    return { unit: "month", value: data.kpis.mrr, suffix: "/month" };
  }
  return { unit: "year", value: data.kpis.arr, suffix: "/year" };
}

function formatRunRate(scale: RunRateScale): string {
  return `${formatINR(scale.value)} ${scale.suffix}`;
}

// Format a 0..1 ratio as a "42.3%" string, or "—" when null (denominator
// was 0). Kept module-scoped so both KPI tiles and headlines share it.
function formatPercent(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

// ---- palette ------------------------------------------------------------
const GREEN = "#024628";
const CREAM = "#fbf3d4";
const GRID = "rgba(251,243,212,0.12)";
const FADED = "rgba(251,243,212,0.5)";
const BORDER = "rgba(251,243,212,0.16)";

// ---- metric catalogue ---------------------------------------------------
type MetricKey =
  | "daily_orders"
  | "daily_revenue"
  | "new_customers"
  | "retention"
  | "run_rate"
  | "stores";

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "daily_orders", label: "Orders" },
  { key: "daily_revenue", label: "Revenue" },
  { key: "new_customers", label: "Customers" },
  { key: "retention", label: "Retention Rate" },
  { key: "run_rate", label: "Run Rate" },
  { key: "stores", label: "Stores" },
];

export default function OverviewPage() {
  return (
    <Suspense fallback={<AdminLoading />}>
      <OverviewPageInner />
    </Suspense>
  );
}

function AdminLoading() {
  return (
    <div
      style={{
        padding: "2rem",
        color: FADED,
        fontFamily: "var(--font-body)",
        fontSize: "0.85rem",
        letterSpacing: "0.05em",
      }}
    >
      Loading…
    </div>
  );
}

function OverviewPageInner() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MetricKey | null>(null);
  const [range, setRange] = useState<DateRangeValue>(() =>
    resolvePreset("this_month"),
  );

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set("from", toYMD(range.from));
      sp.set("to", toYMD(range.to));
      const qs = sp.toString();
      const path = qs
        ? `/api/admin/overview?${qs}`
        : "/api/admin/overview";
      let res: OverviewResponse;
      try {
        res = await adminFetch<OverviewResponse>(path);
      } catch (e) {
        // One retry on 401 to cover the token-save race right after login:
        // the bearer token can land in localStorage a tick after this first
        // fetch fires. Wait briefly, then try once more before surfacing an
        // error so the operator never sees a spurious "Unauthorized".
        if (e instanceof AdminFetchError && e.status === 401) {
          await new Promise((r) => setTimeout(r, 500));
          res = await adminFetch<OverviewResponse>(path);
        } else {
          throw e;
        }
      }
      setData(res);
    } catch (e) {
      if (e instanceof AdminFetchError) setError(e.message);
      else if (e instanceof Error) setError(e.message);
      else setError("Could not load overview.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeLabel =
    selected != null
      ? METRICS.find((m) => m.key === selected)?.label ?? "Segments"
      : null;

  return (
    <AdminShell
      title="Segments"
      subtitle={activeLabel ? activeLabel : "What do you want to see?"}
    >
      <TopSelector selected={selected} onSelect={setSelected} />

      <div style={{ marginBottom: "1.5rem" }}>
        <DateRangeDropdown onChange={setRange} />
      </div>

      {error ? (
        <div
          style={{
            border: "1px solid rgba(239,68,68,0.45)",
            padding: "0.8rem 1rem",
            color: "#fca5a5",
            margin: "1rem 0",
            fontFamily: "var(--font-body)",
            fontSize: "0.85rem",
          }}
        >
          {error}
        </div>
      ) : null}

      {loading || !data ? (
        <Skeletons selected={selected} />
      ) : selected == null ? (
        <KpiStrip data={data} onPick={setSelected} />
      ) : (
        <MetricDetail
          metricKey={selected}
          data={data}
          onBack={() => setSelected(null)}
        />
      )}
    </AdminShell>
  );
}

// ---- top selector -------------------------------------------------------
function TopSelector({
  selected,
  onSelect,
}: {
  selected: MetricKey | null;
  onSelect: (k: MetricKey | null) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        flexWrap: "wrap",
        marginBottom: "1.5rem",
      }}
    >
      <label
        htmlFor="metric-select"
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.6rem",
          letterSpacing: "0.25em",
          textTransform: "uppercase",
          color: FADED,
        }}
      >
        What do you want to see?
      </label>
      <div style={{ minWidth: "min(280px, 100%)" }}>
        <Select
          id="metric-select"
          ariaLabel="What do you want to see?"
          value={selected ?? ""}
          onChange={(v) => onSelect(v ? (v as MetricKey) : null)}
          style={{ background: GREEN, borderColor: GREEN }}
          options={[
            { value: "", label: "Segments — all tiles" },
            ...METRICS.map((m) => ({ value: m.key, label: m.label })),
          ]}
        />
      </div>
    </div>
  );
}

// ---- KPI strip (default view) ------------------------------------------
function KpiStrip({
  data,
  onPick,
}: {
  data: OverviewResponse;
  onPick: (k: MetricKey) => void;
}) {
  const todayPoint = data.daily_revenue.find((p) => p.date === data.range.to);
  const runRate = runRateFor(data);
  const tiles: { key: MetricKey; label: string; value: string; sub?: string }[] =
    [
      {
        key: "daily_orders",
        label: "Orders",
        value: String(todayPoint?.orders ?? 0),
        sub: "today",
      },
      {
        key: "daily_revenue",
        label: "Revenue",
        value: formatINR(data.kpis.revenue_today),
        sub: "today",
      },
      {
        key: "new_customers",
        label: "Customers",
        value: String(data.kpis.new_customers_range),
        sub: "new in range",
      },
      {
        key: "retention",
        label: "Retention Rate",
        value: formatPercent(data.kpis.retention_rate),
        sub: "in range",
      },
      {
        key: "run_rate",
        label: "Run Rate",
        value: formatRunRate(runRate),
        sub: runRate.unit === "month" ? "MRR · monthly" : "ARR · annual",
      },
      {
        key: "stores",
        label: "Stores",
        value: String(data.kpis.stores_total),
        sub: `${data.kpis.retail_stores} retail · ${data.kpis.serviceable_areas} areas`,
      },
    ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: "0.75rem",
      }}
    >
      {tiles.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onPick(t.key)}
          style={{
            textAlign: "left",
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: "1rem 1.1rem",
            background: "rgba(251,243,212,0.03)",
            cursor: "pointer",
            transition: "border-color 0.15s, background 0.15s",
            WebkitTapHighlightColor: "transparent",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = CREAM;
            e.currentTarget.style.background = "rgba(2,70,40,0.22)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = BORDER;
            e.currentTarget.style.background = "rgba(251,243,212,0.03)";
          }}
        >
          <div
            style={{
              color: FADED,
              fontFamily: "var(--font-body)",
              fontSize: "0.58rem",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              marginBottom: "0.55rem",
            }}
          >
            {t.label}
          </div>
          <div
            style={{
              color: CREAM,
              fontFamily: "var(--font-heading)",
              fontSize: "1.7rem",
              lineHeight: 1,
              letterSpacing: "0.02em",
            }}
          >
            {t.value}
          </div>
          {t.sub ? (
            <div
              style={{
                color: "rgba(251,243,212,0.35)",
                fontSize: "0.66rem",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginTop: "0.45rem",
              }}
            >
              {t.sub}
            </div>
          ) : null}
        </button>
      ))}
    </div>
  );
}

// ---- detail view --------------------------------------------------------
function MetricDetail({
  metricKey,
  data,
  onBack,
}: {
  metricKey: MetricKey;
  data: OverviewResponse;
  onBack: () => void;
}) {
  const meta = METRICS.find((m) => m.key === metricKey)!;

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        style={{
          background: "transparent",
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          color: CREAM,
          fontFamily: "var(--font-body)",
          fontSize: "0.62rem",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          padding: "0.45rem 0.9rem",
          cursor: "pointer",
          marginBottom: "1.25rem",
        }}
      >
        ← All metrics
      </button>

      <Headline metricKey={metricKey} data={data} />

      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          background: "rgba(251,243,212,0.02)",
          padding: "1.25rem",
          marginTop: "1.25rem",
        }}
      >
        <h3
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.62rem",
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            color: FADED,
            margin: "0 0 1rem 0",
          }}
        >
          {meta.label}
        </h3>
        <MetricChart metricKey={metricKey} data={data} />
      </div>
    </div>
  );
}

function Headline({
  metricKey,
  data,
}: {
  metricKey: MetricKey;
  data: OverviewResponse;
}) {
  const { value, caption } = headlineFor(metricKey, data);
  return (
    <div>
      <div
        style={{
          color: CREAM,
          fontFamily: "var(--font-heading)",
          fontSize: "clamp(2.6rem, 9vw, 4.2rem)",
          lineHeight: 1,
          letterSpacing: "0.01em",
        }}
      >
        {value}
      </div>
      {caption ? (
        <div
          style={{
            color: FADED,
            fontFamily: "var(--font-body)",
            fontSize: "0.72rem",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            marginTop: "0.6rem",
          }}
        >
          {caption}
        </div>
      ) : null}
    </div>
  );
}

function headlineFor(
  metricKey: MetricKey,
  data: OverviewResponse,
): { value: string; caption: string } {
  switch (metricKey) {
    case "daily_orders":
      return {
        value: String(data.kpis.orders_range),
        caption: `orders · ${data.range.from} → ${data.range.to}`,
      };
    case "daily_revenue":
      return {
        value: formatINR(data.kpis.revenue_range),
        caption: `revenue · ${data.range.from} → ${data.range.to}`,
      };
    case "new_customers":
      return {
        value: String(data.kpis.new_customers_range),
        caption: `new customers · ${data.range.from} → ${data.range.to}`,
      };
    case "retention":
      return {
        value: formatPercent(data.kpis.retention_rate),
        caption: `retention · ${data.range.from} → ${data.range.to}`,
      };
    case "run_rate": {
      const scale = runRateFor(data);
      return {
        value: formatRunRate(scale),
        caption:
          scale.unit === "month"
            ? "monthly recurring revenue · active subs"
            : "annual recurring revenue · MRR × 12",
      };
    }
    case "stores":
      return {
        value: String(data.kpis.stores_total),
        caption: `${data.kpis.retail_stores} retail stores · ${data.kpis.serviceable_areas} serviceable areas`,
      };
  }
}

function MetricChart({
  metricKey,
  data,
}: {
  metricKey: MetricKey;
  data: OverviewResponse;
}) {
  // Daily metrics render the full selected range (the date dropdown
  // controls the window; the API buckets one point per day in it).
  const dailyPoints = data.daily_revenue;

  switch (metricKey) {
    case "daily_orders":
      if (dailyPoints.every((p) => p.orders === 0)) {
        return <EmptyChart label="No orders in this period." />;
      }
      return (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={dailyPoints} margin={chartMargin}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={axisTick}
              stroke={GRID}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis tick={axisTick} stroke={GRID} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: CREAM }} />
            <Bar dataKey="orders" name="Orders" fill={CREAM} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );

    case "daily_revenue":
      if (dailyPoints.every((p) => p.revenue === 0)) {
        return <EmptyChart label="No revenue in this period." />;
      }
      return (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={dailyPoints} margin={chartMargin}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={axisTick}
              stroke={GRID}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis
              tick={axisTick}
              stroke={GRID}
              tickFormatter={(v: number) =>
                v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
              }
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: CREAM }}
              formatter={(value) => {
                const n = typeof value === "number" ? value : Number(value);
                return formatINR(n);
              }}
            />
            <Line
              type="monotone"
              dataKey="revenue"
              name="Revenue"
              stroke={CREAM}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      );

    case "new_customers": {
      const last6 = data.customer_cohorts.slice(-6);
      if (last6.every((p) => p.new_customers === 0)) {
        return <EmptyChart label="No customer signups in this window." />;
      }
      return (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={last6} margin={chartMargin}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              tick={axisTick}
              stroke={GRID}
              tickFormatter={(v: string) => v.slice(2)}
            />
            <YAxis tick={axisTick} stroke={GRID} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: CREAM }} />
            <Bar
              dataKey="new_customers"
              name="New customers"
              fill={CREAM}
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    case "retention": {
      const active = data.kpis.active_subs;
      const cancelled = data.kpis.cancelled_subs;
      return (
        <FormulaPanel
          rows={[
            ["Active subscriptions (now)", String(active)],
            ["Cancelled subscriptions (all-time)", String(cancelled)],
            ["Retention rate (in range)", formatPercent(data.kpis.retention_rate)],
            ["Churn rate (in range, intermediate)", formatPercent(data.kpis.churn_rate)],
          ]}
          note="Retention = 1 − churn. Churn = cancellations in the selected period ÷ subscriptions active at the start of the period. Renders “—” when there was no active base at period start (divide-by-zero guard)."
        />
      );
    }

    case "run_rate": {
      const scale = runRateFor(data);
      return (
        <FormulaPanel
          rows={[
            ["Active subscriptions", String(data.kpis.active_subs)],
            ["MRR", formatINR(data.kpis.mrr)],
            ["ARR", formatINR(data.kpis.arr)],
            [
              "Shown for this range",
              scale.unit === "month" ? "MRR (monthly)" : "ARR (annual)",
            ],
          ]}
          note={`MRR = Σ (bread_price × quantity_per_delivery × days_per_week × 4.33) across active subs. ARR = MRR × 12. Which one is shown depends on the selected span: ≤ ${RUN_RATE_MONTHLY_SPAN_DAYS} days → MRR (/month), otherwise ARR (/year).`}
        />
      );
    }

    case "stores":
      return (
        <FormulaPanel
          rows={[
            ["Retail stockists (pickup_locations)", String(data.kpis.retail_stores)],
            ["Serviceable delivery areas (service_areas)", String(data.kpis.serviceable_areas)],
            ["Combined footprint", String(data.kpis.stores_total)],
          ]}
          note="Combined footprint = active retail stockists in Vizag plus active serviceable delivery areas. Archived / inactive rows in either table are excluded."
        />
      );
  }
}

// Compact key/value panel used to break down the formula-derived metrics
// (Run Rate, Retention, Stores) into their inputs and result. Kept
// simple on purpose — the headline number above is the answer; this
// just shows how it was computed and cites the divide-by-zero guard in
// the note.
function FormulaPanel({
  rows,
  note,
}: {
  rows: [string, string][];
  note: string;
}) {
  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--font-body)",
            fontSize: "0.85rem",
            color: CREAM,
          }}
        >
          <tbody>
            {rows.map(([k, v], i) => (
              <tr key={i}>
                <th
                  scope="row"
                  style={{
                    textAlign: "left",
                    padding: "0.6rem 0.75rem",
                    borderBottom: `1px solid ${BORDER}`,
                    color: FADED,
                    fontSize: "0.62rem",
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    fontWeight: 400,
                    whiteSpace: "nowrap",
                    width: "60%",
                  }}
                >
                  {k}
                </th>
                <td
                  style={{
                    padding: "0.6rem 0.75rem",
                    borderBottom: `1px solid ${BORDER}`,
                    textAlign: "right",
                    fontFamily: "var(--font-heading)",
                    fontSize: "1rem",
                    whiteSpace: "nowrap",
                  }}
                >
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p
        style={{
          marginTop: "0.85rem",
          color: "rgba(251,243,212,0.5)",
          fontFamily: "var(--font-body)",
          fontSize: "0.72rem",
          letterSpacing: "0.04em",
          lineHeight: 1.5,
        }}
      >
        {note}
      </p>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div
      style={{
        height: 220,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: FADED,
        fontFamily: "var(--font-body)",
        fontSize: "0.8rem",
        border: `1px dashed ${BORDER}`,
        borderRadius: 8,
      }}
    >
      {label}
    </div>
  );
}

function Skeletons({ selected }: { selected: MetricKey | null }) {
  if (selected != null) {
    return (
      <>
        <div style={skel(72)} />
        <div style={{ ...skel(300), marginTop: "1.25rem" }} />
      </>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: "0.75rem",
      }}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={skel(110)} />
      ))}
    </div>
  );
}

const skel = (h: number): React.CSSProperties => ({
  height: h,
  background: "rgba(251,243,212,0.04)",
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
});

const chartMargin = { top: 10, right: 16, left: 0, bottom: 0 };
const axisTick = { fill: CREAM, fontSize: 10 } as const;

const tooltipStyle: React.CSSProperties = {
  background: GREEN,
  border: `1px solid ${CREAM}`,
  borderRadius: 6,
  fontFamily: "var(--font-body)",
  fontSize: "0.78rem",
  color: CREAM,
};
