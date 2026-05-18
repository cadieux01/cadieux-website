"use client";

// Overview dashboard. Single network round-trip to
// /api/admin/overview?from=&to= renders KPI cards and five recharts
// charts: daily revenue line, orders-by-status bar, top 5 products
// bar, sub-lifecycle donut, and customer-cohort bars.
//
// All chart styling stays in the Cadieux palette (gold #f59e0b on the
// rgb(6,4,2) base). Empty states render a placeholder rather than a
// degenerate zero-zero chart so the operator can tell "no data" from
// "broken chart".

import { Suspense, useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AdminShell } from "@/components/admin/AdminShell";
import {
  DateRangePicker,
  useDateRangeFromQuery,
} from "@/components/admin/DateRangePicker";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatINR } from "@/lib/admin-formatting";

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
    churn_rate: number;
  };
  daily_revenue: { date: string; revenue: number; orders: number }[];
  orders_by_status: { key: string; count: number }[];
  top_products: { name: string; subscriptions: number; revenue: number }[];
  sub_lifecycle: { key: string; count: number }[];
  customer_cohorts: { month: string; new_customers: number }[];
};

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const GRID = "rgba(245,158,11,0.18)";

// Palette for categorical charts (statuses, lifecycle slices). Ordered
// so common statuses get the most distinct colours.
const STATUS_PALETTE: Record<string, string> = {
  pending_payment: "#fbbf24",
  pending: "#f59e0b",
  confirmed: "#fb923c",
  dispatched: "#fdba74",
  delivered: "#4ade80",
  cancelled: "#ef4444",
  active: "#4ade80",
  paused: "#fbbf24",
  completed: "#22d3ee",
};
function colourFor(key: string, idx: number): string {
  return STATUS_PALETTE[key] ?? FALLBACK_COLOURS[idx % FALLBACK_COLOURS.length]!;
}
const FALLBACK_COLOURS = [GOLD, "#fbbf24", "#fb923c", "#fdba74", "#fde68a"];

// Suspense wrapper required by Next.js prerender for any client page
// that reads useSearchParams() — useDateRangeFromQuery does.
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
        color: "rgba(245,158,11,0.7)",
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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const range = useDateRangeFromQuery();

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (range.from) sp.set("from", range.from);
      if (range.to) sp.set("to", range.to);
      const qs = sp.toString();
      const res = await adminFetch<OverviewResponse>(
        qs ? `/api/admin/overview?${qs}` : "/api/admin/overview",
      );
      setData(res);
    } catch (e) {
      if (e instanceof AdminFetchError) setError(e.message);
      else if (e instanceof Error) setError(e.message);
      else setError("Could not load overview.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminShell
      title="Overview"
      subtitle={
        data
          ? `${data.range.from} → ${data.range.to}`
          : "Analytics dashboard"
      }
      actions={
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          style={{
            ...chipNeutral,
            cursor: refreshing ? "wait" : "pointer",
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      <div className="mb-6">
        <DateRangePicker value={range} />
      </div>

      {error ? (
        <div
          style={{
            border: "1px solid rgba(239,68,68,0.45)",
            padding: "0.8rem 1rem",
            color: "#fca5a5",
            marginBottom: "1rem",
            fontFamily: "var(--font-body)",
            fontSize: "0.85rem",
          }}
        >
          {error}
        </div>
      ) : null}

      {loading || !data ? (
        <Skeletons />
      ) : (
        <>
          <KpiGrid k={data.kpis} />
          <ChartCard title="Daily revenue">
            {data.daily_revenue.every((p) => p.revenue === 0 && p.orders === 0) ? (
              <EmptyChart label="No orders in the selected range." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart
                  data={data.daily_revenue}
                  margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                >
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: CREAM, fontSize: 10 }}
                    stroke={GRID}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis
                    tick={{ fill: CREAM, fontSize: 10 }}
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
                      const key = String(name).toLowerCase();
                      return key === "revenue" ? formatINR(n) : String(n);
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "0.7rem", color: CREAM }} />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke={GOLD}
                    strokeWidth={2}
                    dot={false}
                    name="Revenue"
                  />
                  <Line
                    type="monotone"
                    dataKey="orders"
                    stroke="#4ade80"
                    strokeWidth={2}
                    dot={false}
                    name="Orders"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <div
            style={{
              display: "grid",
              gap: "1rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
              marginTop: "1rem",
            }}
          >
            <ChartCard title="Orders by status">
              {data.orders_by_status.length === 0 ? (
                <EmptyChart label="No orders in the selected range." />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={data.orders_by_status}
                    margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="key"
                      tick={{ fill: CREAM, fontSize: 10 }}
                      stroke={GRID}
                    />
                    <YAxis
                      tick={{ fill: CREAM, fontSize: 10 }}
                      stroke={GRID}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: CREAM }}
                    />
                    <Bar dataKey="count" name="Orders">
                      {data.orders_by_status.map((entry, idx) => (
                        <Cell
                          key={entry.key}
                          fill={colourFor(entry.key, idx)}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Top 5 products">
              {data.top_products.length === 0 ? (
                <EmptyChart label="No subscriptions started in the selected range." />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={data.top_products}
                    layout="vertical"
                    margin={{ top: 10, right: 20, left: 80, bottom: 0 }}
                  >
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      tick={{ fill: CREAM, fontSize: 10 }}
                      stroke={GRID}
                      allowDecimals={false}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      tick={{ fill: CREAM, fontSize: 10 }}
                      stroke={GRID}
                      width={80}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: CREAM }}
                    />
                    <Bar
                      dataKey="subscriptions"
                      fill={GOLD}
                      name="Subscriptions"
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Subscription lifecycle">
              {data.sub_lifecycle.length === 0 ? (
                <EmptyChart label="No subscriptions yet." />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={data.sub_lifecycle}
                      dataKey="count"
                      nameKey="key"
                      innerRadius={50}
                      outerRadius={90}
                      stroke="rgb(6,4,2)"
                    >
                      {data.sub_lifecycle.map((entry, idx) => (
                        <Cell
                          key={entry.key}
                          fill={colourFor(entry.key, idx)}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: CREAM }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: "0.7rem", color: CREAM }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Customer cohorts (12 months)">
              {data.customer_cohorts.every((p) => p.new_customers === 0) ? (
                <EmptyChart label="No customer signups in the last 12 months." />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={data.customer_cohorts}
                    margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: CREAM, fontSize: 10 }}
                      stroke={GRID}
                      tickFormatter={(v: string) => v.slice(2)}
                    />
                    <YAxis
                      tick={{ fill: CREAM, fontSize: 10 }}
                      stroke={GRID}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: CREAM }}
                    />
                    <Bar
                      dataKey="new_customers"
                      fill={GOLD}
                      name="New customers"
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
        </>
      )}
    </AdminShell>
  );
}

function KpiGrid({ k }: { k: OverviewResponse["kpis"] }) {
  const cards: { label: string; value: string; sub?: string }[] = [
    { label: "Revenue (range)", value: formatINR(k.revenue_range) },
    { label: "Revenue today", value: formatINR(k.revenue_today) },
    { label: "Revenue this week", value: formatINR(k.revenue_week) },
    { label: "Revenue this month", value: formatINR(k.revenue_month) },
    {
      label: "Orders (range)",
      value: String(k.orders_range),
      sub: `AOV ${formatINR(Math.round(k.aov_range))}`,
    },
    {
      label: "New customers",
      value: String(k.new_customers_range),
    },
    {
      label: "Active subs",
      value: String(k.active_subs),
      sub: `${k.paused_subs} paused`,
    },
    {
      label: "Churn rate",
      value: `${Math.round(k.churn_rate * 100)}%`,
      sub: `${k.cancelled_subs} cancelled total`,
    },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: "0.75rem",
        marginBottom: "1.5rem",
      }}
    >
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            border: "1px solid rgba(245,158,11,0.2)",
            padding: "0.9rem 1rem",
            borderRadius: 6,
            background: "rgba(245,158,11,0.04)",
          }}
        >
          <div
            style={{
              color: "rgba(245,158,11,0.85)",
              fontFamily: "var(--font-body)",
              fontSize: "0.6rem",
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              marginBottom: "0.4rem",
            }}
          >
            {c.label}
          </div>
          <div
            style={{
              color: CREAM,
              fontFamily: "var(--font-heading)",
              fontSize: "1.4rem",
              letterSpacing: "0.04em",
            }}
          >
            {c.value}
          </div>
          {c.sub ? (
            <div
              style={{
                color: "rgba(192,200,206,0.55)",
                fontSize: "0.7rem",
                marginTop: "0.25rem",
              }}
            >
              {c.sub}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(245,158,11,0.18)",
        padding: "1rem",
        borderRadius: 6,
        background: "rgba(245,158,11,0.02)",
        marginBottom: "1rem",
      }}
    >
      <h3
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.7rem",
          letterSpacing: "0.25em",
          textTransform: "uppercase",
          color: "rgba(245,158,11,0.9)",
          margin: "0 0 0.7rem 0",
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div
      style={{
        height: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "rgba(192,200,206,0.45)",
        fontFamily: "var(--font-body)",
        fontSize: "0.8rem",
        border: "1px dashed rgba(245,158,11,0.18)",
        borderRadius: 4,
      }}
    >
      {label}
    </div>
  );
}

function Skeletons() {
  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={skel(80)} />
        ))}
      </div>
      <div style={skel(280)} />
      <div
        style={{
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          marginTop: "1rem",
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={skel(240)} />
        ))}
      </div>
    </>
  );
}

const skel = (h: number): React.CSSProperties => ({
  height: h,
  background: "rgba(245,158,11,0.05)",
  border: "1px solid rgba(245,158,11,0.12)",
  borderRadius: 6,
  marginBottom: "0.5rem",
});

const tooltipStyle: React.CSSProperties = {
  background: "rgb(12,8,4)",
  border: "1px solid rgba(245,158,11,0.4)",
  fontFamily: "var(--font-body)",
  fontSize: "0.78rem",
};

const chipNeutral: React.CSSProperties = {
  padding: "0.35rem 0.85rem",
  border: "1px solid rgba(245,158,11,0.4)",
  fontFamily: "var(--font-body)",
  fontSize: "0.65rem",
  letterSpacing: "0.22em",
  background: "transparent",
  color: "rgba(245,158,11,0.85)",
  cursor: "pointer",
  textTransform: "uppercase",
};
