"use client";

// Overview dashboard — "one thing at a time" redesign.
//
// Default view: a compact KPI strip of 7 tiles (label + current number).
// A top-bar dropdown ("What do you want to see?") and clicking any tile
// both select a single metric. When a metric is selected ONLY that metric
// expands into a detail panel: a big headline stat, a simple chart or
// table (daily = last 7 days, monthly = last 6 months), and — for the
// range-driven metrics — a date range picker.
//
// Data comes from the single /api/admin/overview?from=&to= round-trip.
// Metrics without data yet (retention, new serviceable locations, new
// stores in Vizag) render a "Coming soon — no data yet" placeholder with
// the correct table structure ready to wire up later.
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
  };
  daily_revenue: { date: string; revenue: number; orders: number }[];
  orders_by_status: { key: string; count: number }[];
  top_products: { name: string; subscriptions: number; revenue: number }[];
  sub_lifecycle: { key: string; count: number }[];
  customer_cohorts: { month: string; new_customers: number }[];
  monthly_sales: { month: string; revenue: number; orders: number }[];
};

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
  | "customer_retention"
  | "retention"
  | "churn"
  | "arr"
  | "mrr"
  | "monthly_sales"
  | "new_locations"
  | "new_stores";

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "daily_orders", label: "Orders" },
  { key: "daily_revenue", label: "Revenue" },
  { key: "new_customers", label: "Customers" },
  { key: "customer_retention", label: "Customer Retention Rate" },
  { key: "retention", label: "Retention Rate" },
  { key: "churn", label: "Churn Rate" },
  { key: "arr", label: "ARR" },
  { key: "mrr", label: "MRR" },
  { key: "monthly_sales", label: "Monthly Sales & Turnover" },
  { key: "new_locations", label: "New Serviceable Locations" },
  { key: "new_stores", label: "New Stores in Vizag" },
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
        key: "customer_retention",
        label: "Customer Retention Rate",
        value: formatPercent(data.kpis.retention_rate),
        sub: "in range",
      },
      {
        key: "retention",
        label: "Retention Rate",
        value: formatPercent(data.kpis.retention_rate),
        sub: "in range",
      },
      {
        key: "churn",
        label: "Churn Rate",
        value: formatPercent(data.kpis.churn_rate),
        sub: "in range",
      },
      {
        key: "arr",
        label: "ARR",
        value: formatINR(data.kpis.arr),
        sub: "active subs · MRR × 12",
      },
      {
        key: "mrr",
        label: "MRR",
        value: formatINR(data.kpis.mrr),
        sub: "active subs",
      },
      {
        key: "monthly_sales",
        label: "Monthly Sales",
        value: formatINR(data.kpis.revenue_month),
        sub: "this month",
      },
      {
        key: "new_locations",
        label: "New Serviceable Areas",
        value: "—",
        sub: "coming soon",
      },
      {
        key: "new_stores",
        label: "New Stores in Vizag",
        value: "—",
        sub: "coming soon",
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
    case "customer_retention":
      return {
        value: formatPercent(data.kpis.retention_rate),
        caption: `customer retention · ${data.range.from} → ${data.range.to}`,
      };
    case "retention":
      return {
        value: formatPercent(data.kpis.retention_rate),
        caption: `retention · ${data.range.from} → ${data.range.to}`,
      };
    case "churn":
      return {
        value: formatPercent(data.kpis.churn_rate),
        caption: `churn · ${data.range.from} → ${data.range.to}`,
      };
    case "arr":
      return {
        value: formatINR(data.kpis.arr),
        caption: "annual recurring revenue · MRR × 12",
      };
    case "mrr":
      return {
        value: formatINR(data.kpis.mrr),
        caption: "monthly recurring revenue · active subs",
      };
    case "monthly_sales":
      return {
        value: formatINR(data.kpis.revenue_month),
        caption: "turnover this month · last 6 months below",
      };
    case "new_locations":
      return { value: "—", caption: "no data yet" };
    case "new_stores":
      return { value: "—", caption: "no data yet" };
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

    case "monthly_sales": {
      if (data.monthly_sales.every((p) => p.revenue === 0 && p.orders === 0)) {
        return <EmptyChart label="No sales in the last 6 months." />;
      }
      return (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.monthly_sales} margin={chartMargin}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                tick={axisTick}
                stroke={GRID}
                tickFormatter={(v: string) => v.slice(2)}
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
                formatter={(value, name) => {
                  const n = typeof value === "number" ? value : Number(value);
                  return String(name).toLowerCase() === "turnover"
                    ? formatINR(n)
                    : String(n);
                }}
              />
              <Bar
                dataKey="revenue"
                name="Turnover"
                fill={CREAM}
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
          <DataTable
            headers={["Month", "Turnover", "Orders"]}
            rows={data.monthly_sales.map((m) => [
              m.month,
              formatINR(m.revenue),
              String(m.orders),
            ])}
          />
        </>
      );
    }

    case "customer_retention":
    case "retention": {
      const active = data.kpis.active_subs;
      const cancelled = data.kpis.cancelled_subs;
      return (
        <FormulaPanel
          rows={[
            ["Active subscriptions (now)", String(active)],
            ["Cancelled subscriptions (all-time)", String(cancelled)],
            ["Retention rate (in range)", formatPercent(data.kpis.retention_rate)],
            ["Churn rate (in range)", formatPercent(data.kpis.churn_rate)],
          ]}
          note="Retention = 1 − churn. Churn = cancellations in the selected period ÷ subscriptions active at the start of the period. Renders “—” when there was no active base at period start (divide-by-zero guard)."
        />
      );
    }

    case "churn": {
      const active = data.kpis.active_subs;
      const cancelled = data.kpis.cancelled_subs;
      return (
        <FormulaPanel
          rows={[
            ["Active subscriptions (now)", String(active)],
            ["Cancelled subscriptions (all-time)", String(cancelled)],
            ["Churn rate (in range)", formatPercent(data.kpis.churn_rate)],
            ["Retention rate (in range)", formatPercent(data.kpis.retention_rate)],
          ]}
          note="Churn = cancellations in the selected period ÷ subscriptions active at the start of the period. Renders “—” when the denominator is 0."
        />
      );
    }

    case "mrr":
    case "arr":
      return (
        <FormulaPanel
          rows={[
            ["Active subscriptions", String(data.kpis.active_subs)],
            ["MRR", formatINR(data.kpis.mrr)],
            ["ARR", formatINR(data.kpis.arr)],
          ]}
          note="MRR sums (bread_price × quantity_per_delivery × days_per_week × 4.33) across every active subscription. ARR = MRR × 12."
        />
      );

    case "new_locations":
      return (
        <ComingSoonTable
          headers={["Date added", "Area / Pincode", "City", "Status"]}
          note="Serviceable-area history isn't tracked yet."
        />
      );

    case "new_stores":
      return (
        <ComingSoonTable
          headers={["Date added", "Store name", "Locality", "Status"]}
          note="Vizag store rollout isn't tracked yet."
        />
      );
  }
}

// ---- shared table + empty/placeholder ----------------------------------
function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div style={{ overflowX: "auto", marginTop: "1.25rem" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "var(--font-body)",
          fontSize: "0.8rem",
          color: CREAM,
        }}
      >
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "0.55rem 0.75rem",
                  borderBottom: `1px solid ${BORDER}`,
                  color: FADED,
                  fontSize: "0.58rem",
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  fontWeight: 400,
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  style={{
                    padding: "0.55rem 0.75rem",
                    borderBottom: "1px solid rgba(251,243,212,0.07)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Compact key/value panel used to break down the formula-derived metrics
// (MRR, ARR, retention, churn) into their inputs and result. Kept simple
// on purpose — the headline number above is the answer; this just shows
// how it was computed and cites the divide-by-zero guard in the note.
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

function ComingSoonTable({
  headers,
  note,
}: {
  headers: string[];
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
            fontSize: "0.8rem",
            color: CREAM,
          }}
        >
          <thead>
            <tr>
              {headers.map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "0.55rem 0.75rem",
                    borderBottom: `1px solid ${BORDER}`,
                    color: FADED,
                    fontSize: "0.58rem",
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    fontWeight: 400,
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                colSpan={headers.length}
                style={{
                  padding: "2.5rem 0.75rem",
                  textAlign: "center",
                  color: FADED,
                  letterSpacing: "0.1em",
                }}
              >
                Coming soon — no data yet
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p
        style={{
          marginTop: "0.85rem",
          color: "rgba(251,243,212,0.35)",
          fontFamily: "var(--font-body)",
          fontSize: "0.7rem",
          letterSpacing: "0.08em",
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
      {Array.from({ length: 11 }).map((_, i) => (
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
