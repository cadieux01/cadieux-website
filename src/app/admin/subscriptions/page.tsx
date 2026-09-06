"use client";

// Subscriptions admin board. Calls the enriched
// /api/admin/subscriptions?enrich=1 endpoint so each row carries a
// server-computed derived_end_date and remaining_deliveries count.
//
// Pause/Resume/Cancel actions hit the existing PATCH
// /api/admin/subscriptions/[id] route. We don't build new transition
// logic here.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import Select from "@/components/ui/Select";
import {
  DateRangeDropdown,
  resolvePreset,
  withinDateRange,
  type DateRangeValue,
} from "@/components/admin/DateRangeDropdown";
import { ContactActions } from "@/components/admin/ContactActions";
import { StatusBadge } from "@/components/admin/StatusBadge";
import {
  PartnerShareButton,
  type ShareablePartner,
  type ShareScope,
} from "@/components/admin/PartnerShareButton";
import {
  BORDER,
  BORDER_SUBTLE,
  CREAM,
  DANGER,
  DANGER_BORDER,
  INK,
  TEXT_FADED,
  TEXT_MUTED,
  cream,
} from "@/components/admin/theme";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { csvFilename, downloadCsv, toCsv } from "@/lib/admin-csv";
import {
  addDaysISO,
  formatDate,
  formatINR,
  isoLocalDate,
} from "@/lib/admin-formatting";
import {
  describeSubscriptionPlan,
  resolveSubscriptionAddress,
  formatAddressShort,
  formatAddressFull,
  phonesDiffer,
} from "@/lib/subscription-display";
import {
  composeNextDeliveryShareMessage,
  composeSubscriptionShareMessage,
} from "@/lib/subscription-share-message";
import {
  AdminDeliveryRow,
  AdminSubscriptionRow,
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_OPTIONS,
  SUBSCRIPTION_PAYMENT_STATUSES,
  SUBSCRIPTION_STATUSES,
  formatStatusLabel,
  subscriptionStatusRank,
} from "@/lib/admin-shared";

type FilterValue =
  | "all"
  | "pending_confirmation"
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "expiring_7d";

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending_confirmation", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expiring_7d", label: "Expiring in 7 days" },
];

// Friendly labels for the drawer's overall-status Select (the raw column
// values include the ungainly "pending_confirmation").
const SUB_STATUS_OPTION_LABEL: Record<string, string> = {
  pending_confirmation: "Pending confirmation",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

// Cancelling is the one destructive action on this board, so the
// confirmation names the customer and spells out the plan rather than
// asking "are you sure?" about an anonymous row. `remaining_deliveries`
// is the non-terminal delivery count — exactly the rows the server-side
// cascade will cancel — so the operator sees the blast radius first.
function cancelPrompt(s: AdminSubscriptionRow): string {
  const who =
    s.customer?.full_name?.trim() || s.customer_name?.trim() || "this customer";
  const plan = describeSubscriptionPlan(s);
  const open = s.remaining_deliveries ?? 0;
  const tail =
    open > 0
      ? `\n\nThis also cancels ${open} scheduled ${
          open === 1 ? "delivery that hasn't" : "deliveries that haven't"
        } happened yet.`
      : "";
  return `Cancel ${who}'s subscription?\n\n${
    s.product_name ?? "Subscription"
  }\n${plan}${tail}`;
}

// Two things are worth sending about a subscription. The rider almost
// always wants the first, so it leads and is the default.
function shareScopes(s: AdminSubscriptionRow): ShareScope[] {
  return [
    {
      id: "next",
      label: "Next delivery",
      message: composeNextDeliveryShareMessage(s),
    },
    {
      id: "plan",
      label: "Whole plan",
      message: composeSubscriptionShareMessage(s),
    },
  ];
}

// Suspense wrapper required by Next.js prerender for any client page
// that reads useSearchParams() — useDateRangeFromQuery does.
export default function SubscriptionsPage() {
  return (
    <Suspense fallback={<AdminLoading />}>
      <SubscriptionsPageInner />
    </Suspense>
  );
}

function AdminLoading() {
  return (
    <div
      style={{
        padding: "2rem",
        color: "rgba(251,243,212,0.7)",
        fontFamily: "var(--font-body)",
        fontSize: "1rem",
        letterSpacing: "0.05em",
      }}
    >
      Loading…
    </div>
  );
}

// Interactive descendants of a row that must keep their own click
// behaviour — clicking any of these must NOT navigate to the detail page.
// Mirrors the same guard on /admin/orders.
const ROW_INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, label, [role="button"], [role="combobox"], [role="listbox"], [role="option"]';

function SubscriptionsPageInner() {
  const router = useRouter();
  const [subs, setSubs] = useState<AdminSubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which row's Date cell is showing its subscribed/receives breakdown.
  const [openDateId, setOpenDateId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRangeValue | null>(() =>
    resolvePreset("this_month"),
  );

  // Delivery partners power the per-row "Share" button. Fetched once on
  // mount (never polled) and passed to every PartnerShareButton — same
  // pattern as /admin/orders.
  const [partners, setPartners] = useState<ShareablePartner[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(true);
  const [partnersError, setPartnersError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch<{
          partners: { id: string; name: string; phone: string }[];
        }>("/api/admin/delivery-partners");
        if (cancelled) return;
        setPartners(
          (res.partners ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            phone: p.phone,
          })),
        );
        setPartnersError(null);
      } catch (e) {
        if (cancelled) return;
        setPartnersError(
          e instanceof AdminFetchError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Could not load partners.",
        );
      } finally {
        if (!cancelled) setPartnersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Always fetch every row (the dataset is small) and filter
      // client-side — that lets the chips show live per-status counts
      // and keeps the "expiring in 7 days" window computable.
      const res = await adminFetch<{ subscriptions: AdminSubscriptionRow[] }>(
        `/api/admin/subscriptions?enrich=1`,
      );
      setSubs(res.subscriptions ?? []);
    } catch (e) {
      if (e instanceof AdminFetchError) setError(e.message);
      else if (e instanceof Error) setError(e.message);
      else setError("Could not load subscriptions.");
    } finally {
      setLoading(false);
    }
  }, []);

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

  // 10s polling — same cadence as the legacy admin dashboard.
  useEffect(() => {
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const drawerSub = useMemo(
    () => (drawerId ? subs.find((s) => s.id === drawerId) ?? null : null),
    [drawerId, subs],
  );

  const inRange = useMemo(
    () => subs.filter((s) => withinDateRange(s.created_at, range)),
    [subs, range],
  );

  const isExpiring = useCallback((s: AdminSubscriptionRow): boolean => {
    if (s.status !== "active") return false;
    const end = s.derived_end_date;
    if (!end) return false;
    const today = isoLocalDate(new Date());
    const horizon = addDaysISO(today, 7);
    return end >= today && end <= horizon;
  }, []);

  const counts = useMemo(() => {
    const c: Record<FilterValue, number> = {
      all: inRange.length,
      pending_confirmation: 0,
      active: 0,
      paused: 0,
      completed: 0,
      cancelled: 0,
      expiring_7d: 0,
    };
    for (const s of inRange) {
      if (s.status in c) c[s.status as FilterValue]++;
      if (isExpiring(s)) c.expiring_7d++;
    }
    return c;
  }, [inRange, isExpiring]);

  const filtered = useMemo(() => {
    const rows =
      filter === "all"
        ? inRange
        : filter === "expiring_7d"
          ? inRange.filter(isExpiring)
          : inRange.filter((s) => s.status === filter);
    // Status group first, newest-first within each group, so completed and
    // cancelled subscriptions stop pushing live ones down the page. The API
    // already returns created_at DESC; this re-sorts a copy. Display only —
    // no status is written. See subscriptionStatusRank in lib/admin-shared.
    return [...rows].sort((a, b) => {
      const rankCmp = subscriptionStatusRank(a) - subscriptionStatusRank(b);
      if (rankCmp !== 0) return rankCmp;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [inRange, filter, isExpiring]);

  // Shared by the row's Select and its shortcut buttons, so both writes
  // go through the same optimistic-update + expected_status guard.
  const setStatus = async (sub: AdminSubscriptionRow, nextStatus: string) => {
    if (nextStatus === sub.status) return;
    setBusyId(sub.id);
    const prev = subs;
    setSubs((curr) =>
      curr.map((s) => (s.id === sub.id ? { ...s, status: nextStatus } : s)),
    );
    try {
      await adminFetch(`/api/admin/subscriptions/${sub.id}`, {
        method: "PATCH",
        // Guard on the status we believe is current so a stale row can't
        // clobber a change made elsewhere (409 → rollback + message).
        body: JSON.stringify({
          status: nextStatus,
          expected_status: sub.status,
        }),
      });
      void load();
    } catch (e) {
      setSubs(prev);
      if (e instanceof AdminFetchError) alert(e.message);
      else alert("Update failed.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminShell
      title="Subscriptions"
      subtitle="Date = the next delivery you owe"
      actions={
        <>
          <button
            type="button"
            onClick={() => exportSubsCsv(filtered)}
            disabled={filtered.length === 0}
            style={chipNeutral}
          >
            Export CSV
          </button>
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
        </>
      }
    >
      <div className="mb-4">
        <DateRangeDropdown onChange={setRange} />
      </div>
      <div className="flex flex-wrap gap-2 mb-6">
        {FILTERS.map((f) => {
          const active = f.value === filter;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              style={{
                ...chipBase,
                color: active ? INK : cream(0.85),
                background: active ? CREAM : "transparent",
                borderColor: active ? CREAM : BORDER,
              }}
            >
              {f.label} · {counts[f.value]}
            </button>
          );
        })}
      </div>

      {error ? (
        <div
          style={{
            border: `1px solid ${DANGER_BORDER}`,
            padding: "0.8rem 1rem",
            color: DANGER,
            marginBottom: "1rem",
            fontSize: "1rem",
            fontFamily: "var(--font-body)",
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <Placeholder>Loading subscriptions…</Placeholder>
      ) : filtered.length === 0 ? (
        <Placeholder>No subscriptions match the filter.</Placeholder>
      ) : (
        <div
          style={{
            border: `1px solid ${BORDER_SUBTLE}`,
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
        <div style={{ overflowX: "auto" }}>
          <table
            className="subs-table"
            style={{ width: "100%", borderCollapse: "collapse" }}
          >
            <thead>
              <tr style={tableHeadRow}>
                <th style={th}>Customer</th>
                <th style={th}>Plan</th>
                <th style={th}>Date</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const busy = busyId === s.id;
                const canMarkActive = s.status === "pending_confirmation";
                const canPause = s.status === "active";
                const canResume = s.status === "paused";
                const canCancel =
                  s.status !== "cancelled" && s.status !== "completed";
                const rowAddr = resolveSubscriptionAddress(s);
                return (
                  <tr
                    key={s.id}
                    onClick={(e) => {
                      // Row-wide navigation, minus the controls that own
                      // their own click (customer link, action buttons).
                      if (
                        (e.target as HTMLElement).closest(
                          ROW_INTERACTIVE_SELECTOR,
                        )
                      ) {
                        return;
                      }
                      if (window.getSelection()?.toString()) return;
                      router.push(`/admin/subscriptions/${s.id}`);
                    }}
                    title="Open subscription detail"
                    style={{
                      cursor: "pointer",
                      background: i % 2 === 0 ? cream(0.025) : "transparent",
                    }}
                  >
                    <td style={td} data-label="Customer">
                      <Link
                        href={
                          s.customer_id
                            ? `/admin/customers/${s.customer_id}`
                            : "#"
                        }
                        style={{ color: CREAM, textDecoration: "none" }}
                      >
                        {s.customer?.full_name ?? "—"}
                      </Link>
                      {s.customer?.phone ? (
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span
                            style={{
                              color: cream(0.85),
                              fontSize: "1rem",
                            }}
                          >
                            {s.customer.phone}
                          </span>
                          <ContactActions
                            phone={s.customer.phone}
                            customerName={s.customer.full_name}
                            orderInfo={`${s.product_name} subscription`}
                          />
                        </div>
                      ) : null}
                    </td>
                    <td style={td} data-label="Plan">
                      {/* One line naming the variants and the cadence —
                          "Multigrain 1, Plain 1 — every week on Sunday". */}
                      <div>{describeSubscriptionPlan(s)}</div>
                      {rowAddr.hasAny ? (
                        <div
                          className="sub-addr"
                          title={formatAddressFull(rowAddr)}
                          style={{
                            color: TEXT_MUTED,
                            fontSize: "0.875rem",
                            marginTop: 4,
                            maxWidth: 280,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatAddressShort(rowAddr)}
                          {rowAddr.incomplete ? (
                            <span style={{ color: DANGER }}> · incomplete</span>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td style={td} data-label="Date">
                      {/* The date I owe them, not the day they signed up.
                          Click to see both. */}
                      <button
                        type="button"
                        onClick={() =>
                          setOpenDateId((id) => (id === s.id ? null : s.id))
                        }
                        aria-expanded={openDateId === s.id}
                        style={dateButton}
                        title="Show subscribed and delivery dates"
                      >
                        {s.next_delivery
                          ? formatDate(s.next_delivery.date)
                          : "No delivery due"}
                      </button>
                      {s.next_delivery?.slot ? (
                        <div
                          style={{ color: TEXT_MUTED, fontSize: "0.875rem" }}
                        >
                          {s.next_delivery.slot}
                        </div>
                      ) : null}
                      {openDateId === s.id ? (
                        <div
                          style={{
                            marginTop: 6,
                            paddingTop: 6,
                            borderTop: `1px solid ${BORDER_SUBTLE}`,
                            color: TEXT_MUTED,
                            fontSize: "0.875rem",
                            lineHeight: 1.6,
                          }}
                        >
                          <div>Subscribed {formatDate(s.created_at)}</div>
                          <div>
                            Receives{" "}
                            {s.next_delivery
                              ? [
                                  formatDate(s.next_delivery.date),
                                  s.next_delivery.slot,
                                ]
                                  .filter(Boolean)
                                  .join(", ")
                              : "nothing further"}
                          </div>
                        </div>
                      ) : null}
                    </td>
                    <td style={td} data-label="Status">
                      {/* Inline status control, same shape as the orders
                          board: Select to change, badge underneath so the
                          current state still reads at a glance. */}
                      <Select
                        value={(s.status ?? "").toLowerCase()}
                        disabled={busy}
                        ariaLabel="Subscription status"
                        className="sub-status-select"
                        style={statusSelect}
                        onChange={(v) => {
                          if (v === "cancelled" && !confirm(cancelPrompt(s))) {
                            return;
                          }
                          void setStatus(s, v);
                        }}
                        options={[
                          ...SUBSCRIPTION_STATUSES.map((opt) => ({
                            value: opt,
                            label: SUB_STATUS_OPTION_LABEL[opt] ?? opt,
                          })),
                          // A row carrying a value outside the allowed set
                          // still needs to render its own status.
                          ...(s.status &&
                          !SUBSCRIPTION_STATUSES.includes(
                            s.status as (typeof SUBSCRIPTION_STATUSES)[number],
                          )
                            ? [
                                {
                                  value: s.status,
                                  label: formatStatusLabel(s.status),
                                },
                              ]
                            : []),
                        ]}
                      />
                      <div style={{ marginTop: 4 }}>
                        <StatusBadge status={s.status} />
                      </div>
                    </td>
                    <td style={td} data-label="Actions">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/admin/subscriptions/${s.id}`}
                          style={{ ...buttonSm, textDecoration: "none" }}
                        >
                          Details
                        </Link>
                        <button
                          type="button"
                          onClick={() => setDrawerId(s.id)}
                          style={buttonSm}
                        >
                          Open
                        </button>
                        <PartnerShareButton
                          message={shareScopes(s)}
                          partners={partners}
                          partnersLoading={partnersLoading}
                          partnersError={partnersError}
                          buttonStyle={buttonSm}
                        />
                        {canMarkActive ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void setStatus(s, "active")}
                            style={{ ...buttonSm, opacity: busy ? 0.5 : 1 }}
                          >
                            Mark Active
                          </button>
                        ) : null}
                        {canPause ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void setStatus(s, "paused")}
                            style={{ ...buttonSm, opacity: busy ? 0.5 : 1 }}
                          >
                            Pause
                          </button>
                        ) : null}
                        {canResume ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void setStatus(s, "active")}
                            style={{ ...buttonSm, opacity: busy ? 0.5 : 1 }}
                          >
                            Resume
                          </button>
                        ) : null}
                        {canCancel ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (confirm(cancelPrompt(s))) {
                                void setStatus(s, "cancelled");
                              }
                            }}
                            style={{
                              ...buttonSm,
                              color: DANGER,
                              borderColor: DANGER_BORDER,
                              opacity: busy ? 0.5 : 1,
                            }}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {drawerSub ? (
        <SubscriptionDrawer
          subscription={drawerSub}
          onClose={() => setDrawerId(null)}
          onChanged={() => void load()}
        />
      ) : null}

      <p
        style={{
          marginTop: "1.5rem",
          color: TEXT_FADED,
          fontSize: "1rem",
          fontFamily: "var(--font-body)",
          maxWidth: 720,
          lineHeight: 1.6,
        }}
      >
        Date = the earliest delivery that hasn&rsquo;t happened yet. Click it
        for the day they subscribed and the day they receive. Allowed
        statuses: {SUBSCRIPTION_STATUSES.join(", ")}.
      </p>

      {/* One table markup, two shapes. Below 860px the rows stop being a
          grid and stack into labelled cards — a five-column table cannot
          be read on a 390px screen, and side-scrolling hides the actions. */}
      <style jsx global>{`
        .subs-table {
          min-width: 880px;
        }
        @media (max-width: 860px) {
          .subs-table {
            min-width: 0;
          }
          .subs-table thead {
            position: absolute;
            width: 1px;
            height: 1px;
            overflow: hidden;
            clip: rect(0 0 0 0);
            white-space: nowrap;
          }
          .subs-table tr {
            display: block;
            border-bottom: 1px solid ${BORDER_SUBTLE};
            padding: 0.35rem 0;
          }
          .subs-table td {
            display: block;
            min-width: 0;
            border-bottom: none;
            padding: 0.4rem 0.9rem;
            overflow-wrap: anywhere;
          }
          .subs-table td::before {
            content: attr(data-label);
            display: block;
            margin-bottom: 0.15rem;
            color: ${TEXT_MUTED};
            font-size: 0.875rem;
            letter-spacing: 0.18em;
            text-transform: uppercase;
          }
          /* Inline caps override the ellipsis/max-width tuned for the wide
             table — on a phone the value simply wraps to the next line. */
          .subs-table .sub-addr {
            max-width: none !important;
            white-space: normal !important;
            overflow: visible !important;
          }
          .subs-table .sub-status-select > button {
            max-width: none !important;
            width: 100% !important;
          }
        }
      `}</style>
    </AdminShell>
  );
}

function SubscriptionDrawer({
  subscription,
  onClose,
  onChanged,
}: {
  subscription: AdminSubscriptionRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [deliveries, setDeliveries] = useState<AdminDeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDeliveries = useCallback(async () => {
    try {
      const r = await adminFetch<{ deliveries: AdminDeliveryRow[] }>(
        `/api/admin/subscriptions/${subscription.id}/deliveries`,
      );
      setDeliveries(r.deliveries ?? []);
      setError(null);
    } catch (e) {
      setError(
        e instanceof AdminFetchError ? e.message : "Failed to load deliveries.",
      );
    } finally {
      setLoading(false);
    }
  }, [subscription.id]);

  useEffect(() => {
    void fetchDeliveries();
    const t = setInterval(() => void fetchDeliveries(), 10_000);
    return () => clearInterval(t);
  }, [fetchDeliveries]);

  const updateOverallStatus = async (next: string) => {
    // Same named confirmation as the row's Cancel button — picking
    // "Cancelled" from this Select cascades to open deliveries too.
    if (next === "cancelled" && !confirm(cancelPrompt(subscription))) return;
    try {
      await adminFetch(`/api/admin/subscriptions/${subscription.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: next,
          expected_status: subscription.status,
        }),
      });
      onChanged();
    } catch (e) {
      alert(e instanceof AdminFetchError ? e.message : "Update failed.");
    }
  };

  const updatePaymentStatus = async (next: string) => {
    try {
      await adminFetch(`/api/admin/subscriptions/${subscription.id}`, {
        method: "PATCH",
        body: JSON.stringify({ payment_status: next }),
      });
      onChanged();
    } catch (e) {
      alert(e instanceof AdminFetchError ? e.message : "Update failed.");
    }
  };

  const updateDeliveryStatus = async (deliveryId: string, next: string) => {
    const prev = deliveries;
    const current = prev.find((d) => d.id === deliveryId)?.status ?? null;
    setDeliveries((curr) =>
      curr.map((d) => (d.id === deliveryId ? { ...d, status: next } : d)),
    );
    try {
      await adminFetch(
        `/api/admin/subscriptions/${subscription.id}/deliveries/${deliveryId}`,
        {
          method: "PATCH",
          // Guard on the status this row was rendered with — the drawer
          // polls every 10s, so a stale click must 409 rather than write.
          body: JSON.stringify({
            status: next,
            ...(current ? { expected_status: current } : {}),
          }),
        },
      );
      void fetchDeliveries();
      onChanged();
    } catch (e) {
      setDeliveries(prev);
      alert(
        e instanceof AdminFetchError ? e.message : "Delivery update failed.",
      );
    }
  };

  const updateDeliveryNotes = async (deliveryId: string, notes: string) => {
    try {
      await adminFetch(
        `/api/admin/subscriptions/${subscription.id}/deliveries/${deliveryId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ admin_notes: notes }),
        },
      );
      void fetchDeliveries();
    } catch (e) {
      alert(
        e instanceof AdminFetchError ? e.message : "Notes update failed.",
      );
    }
  };

  const addr = resolveSubscriptionAddress(subscription);
  const addrLine = formatAddressFull(addr);
  // The address's own phone may differ from the customer record — show
  // both, labelled, when they do.
  const custPhone = subscription.customer?.phone ?? null;
  const showBothPhones = phonesDiffer(addr.phone, custPhone);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(29,29,31,0.7)",
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        style={{
          width: "min(620px, 100%)",
          maxHeight: "100dvh",
          height: "100dvh",
          background: "#1D1D1F",
          borderLeft: "1px solid rgba(251,243,212,0.25)",
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding:
            "28px 28px calc(60px + env(safe-area-inset-bottom)) 28px",
          color: "#FBF3D4",
          fontFamily: "var(--font-body)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 18,
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                fontSize: "0.875rem",
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: "rgba(251,243,212,0.75)",
              }}
            >
              Subscription
            </p>
            <p
              style={{
                margin: "4px 0 0",
                fontFamily: "var(--font-heading)",
                fontSize: "1.5rem",
                fontWeight: 300,
                letterSpacing: "0.04em",
              }}
            >
              {subscription.product_name} × {subscription.quantity_per_delivery}
            </p>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "1rem",
                color: "rgba(251,243,212,0.55)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span>
                {subscription.customer?.full_name ?? "—"} ·{" "}
                {subscription.customer?.phone ?? "—"}
              </span>
              {subscription.customer?.phone ? (
                <ContactActions
                  phone={subscription.customer.phone}
                  customerName={subscription.customer.full_name}
                  orderInfo={`${subscription.product_name} subscription`}
                />
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(251,243,212,0.55)",
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            background: "rgba(251,243,212,0.05)",
            border: "1px solid rgba(251,243,212,0.35)",
            padding: "14px 16px",
            marginBottom: 18,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: "0.875rem",
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: "rgba(251,243,212,0.8)",
              }}
            >
              Overall status
            </span>
            <Select
              value={subscription.status}
              onChange={(v) => void updateOverallStatus(v)}
              ariaLabel="Overall subscription status"
              style={drawerSelect}
              options={SUBSCRIPTION_STATUSES.map((opt) => ({
                value: opt,
                label: SUB_STATUS_OPTION_LABEL[opt] ?? opt,
              }))}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: "0.875rem",
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: "rgba(251,243,212,0.5)",
              }}
            >
              Payment
            </span>
            <Select
              value={subscription.payment_status}
              onChange={(v) => void updatePaymentStatus(v)}
              ariaLabel="Payment status"
              style={drawerSelect}
              options={SUBSCRIPTION_PAYMENT_STATUSES.map((opt) => ({
                value: opt,
                label: formatStatusLabel(opt),
              }))}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "1rem",
            }}
          >
            <span style={{ color: TEXT_FADED }}>Plan</span>
            <span style={{ textAlign: "right", maxWidth: 360 }}>
              {describeSubscriptionPlan(subscription)}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "1rem",
            }}
          >
            <span style={{ color: "rgba(251,243,212,0.5)" }}>Total</span>
            <span>
              {formatINR(subscription.total_amount)} · {subscription.total_weeks} weeks
            </span>
          </div>
          {addr.hasAny ? (
            <div
              style={{
                fontSize: "1rem",
                color: "rgba(251,243,212,0.55)",
                lineHeight: 1.5,
              }}
            >
              {addr.name ? (
                <>
                  <b style={{ color: "#FBF3D4", fontWeight: 500 }}>
                    {addr.name}
                  </b>
                  <br />
                </>
              ) : null}
              {addrLine}
              {addr.incomplete ? (
                <span style={{ color: "#EF4444" }}> · incomplete address</span>
              ) : null}
              {showBothPhones ? (
                <>
                  <br />
                  <span style={{ color: "rgba(251,243,212,0.75)" }}>
                    Delivery phone: {addr.phone}
                  </span>
                  <br />
                  <span style={{ color: "rgba(251,243,212,0.75)" }}>
                    Account phone: {custPhone}
                  </span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <p
          style={{
            margin: "0 0 14px",
            fontSize: "0.875rem",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(251,243,212,0.75)",
          }}
        >
          Deliveries · {deliveries.length}
        </p>

        {loading ? (
          <p style={{ color: "rgba(251,243,212,0.45)" }}>Loading…</p>
        ) : null}
        {error ? <p style={{ color: "#EF4444" }}>Error: {error}</p> : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {deliveries.map((d) => (
            <DeliveryCard
              key={d.id}
              delivery={d}
              onStatusChange={(next) => void updateDeliveryStatus(d.id, next)}
              onNotesSave={(notes) => void updateDeliveryNotes(d.id, notes)}
            />
          ))}
          {!loading && deliveries.length === 0 && !error ? (
            <p style={{ color: "rgba(251,243,212,0.45)", fontSize: "1rem" }}>
              No deliveries scheduled.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DeliveryCard({
  delivery,
  onStatusChange,
  onNotesSave,
}: {
  delivery: AdminDeliveryRow;
  onStatusChange: (s: string) => void;
  onNotesSave: (notes: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(delivery.admin_notes ?? "");
  const userEdited = (delivery.admin_notes ?? "").includes("[user edit");
  return (
    <div
      style={{
        border: "1px solid rgba(251,243,212,0.2)",
        background: "rgba(251,243,212,0.03)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "0.875rem",
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            color: "rgba(251,243,212,0.75)",
          }}
        >
          Week {delivery.week_number}
        </span>
        <Select
          value={delivery.status}
          onChange={onStatusChange}
          ariaLabel={`Week ${delivery.week_number} delivery status`}
          style={drawerSelect}
          options={DELIVERY_STATUS_OPTIONS.map((opt) => ({
            value: opt,
            label: DELIVERY_STATUS_LABELS[opt] ?? opt,
          }))}
        />
      </div>
      <div style={{ fontSize: "1rem", color: "#FBF3D4" }}>
        {formatScheduledDate(delivery.scheduled_date)}
        <span style={{ color: "rgba(251,243,212,0.5)" }}>
          {" "}
          · {delivery.scheduled_time_slot}
        </span>
      </div>
      {delivery.status_updated_at ? (
        <div
          style={{
            fontSize: "0.875rem",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "rgba(251,243,212,0.35)",
          }}
        >
          Updated ·{" "}
          {new Date(delivery.status_updated_at).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
      ) : null}
      {userEdited ? (
        <span
          style={{
            alignSelf: "flex-start",
            fontSize: "0.875rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#FBF3D4",
            border: "1px solid rgba(251,243,212,0.5)",
            padding: "2px 8px",
            borderRadius: 999,
          }}
        >
          ✎ User edited
        </span>
      ) : null}
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            style={{
              background: "transparent",
              border: "1px solid rgba(251,243,212,0.3)",
              color: "#FBF3D4",
              padding: "0.45rem 0.6rem",
              fontFamily: "var(--font-body)",
              fontSize: "1rem",
              resize: "vertical",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => {
                setDraft(delivery.admin_notes ?? "");
                setEditing(false);
              }}
              style={buttonSm}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onNotesSave(draft);
                setEditing(false);
              }}
              style={buttonSm}
            >
              Save
            </button>
          </div>
        </div>
      ) : delivery.admin_notes ? (
        <div
          style={{
            fontSize: "1rem",
            color: "rgba(251,243,212,0.6)",
            fontStyle: "italic",
            whiteSpace: "pre-wrap",
          }}
        >
          Notes: {delivery.admin_notes}{" "}
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{
              ...buttonSm,
              fontSize: "0.875rem",
              padding: "0.15rem 0.5rem",
              marginLeft: 6,
            }}
          >
            Edit notes
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={{
            ...buttonSm,
            fontSize: "0.875rem",
            padding: "0.2rem 0.6rem",
            alignSelf: "flex-start",
          }}
        >
          Add notes
        </button>
      )}
    </div>
  );
}

function formatScheduledDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const drawerSelect: React.CSSProperties = {
  background: "rgba(29,29,31,0.4)",
  color: "#FBF3D4",
  border: "1px solid rgba(251,243,212,0.4)",
  padding: "5px 10px",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  cursor: "pointer",
  minHeight: 0,
  borderRadius: 6,
  minWidth: 150,
};

function exportSubsCsv(rows: AdminSubscriptionRow[]): void {
  const csv = toCsv(rows, [
    { header: "Subscription ID", value: (s) => s.id },
    { header: "Customer", value: (s) => s.customer?.full_name ?? "" },
    { header: "Phone", value: (s) => s.customer?.phone ?? "" },
    { header: "Product", value: (s) => s.product_name },
    { header: "Quantity per delivery", value: (s) => s.quantity_per_delivery },
    { header: "Frequency", value: (s) => s.frequency },
    { header: "Total weeks", value: (s) => s.total_weeks },
    { header: "Status", value: (s) => s.status },
    { header: "Payment status", value: (s) => s.payment_status },
    { header: "Total amount", value: (s) => s.total_amount },
    { header: "Started", value: (s) => s.created_at },
    { header: "Derived end", value: (s) => s.derived_end_date ?? "" },
    { header: "Remaining deliveries", value: (s) => s.remaining_deliveries ?? "" },
  ]);
  downloadCsv(csvFilename("subscriptions"), csv);
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px dashed rgba(251,243,212,0.2)",
        padding: "3rem 1rem",
        textAlign: "center",
        color: "rgba(251,243,212,0.55)",
        fontFamily: "var(--font-body)",
        fontSize: "1rem",
      }}
    >
      {children}
    </div>
  );
}

const chipBase: React.CSSProperties = {
  padding: "0.35rem 0.85rem",
  border: `1px solid ${BORDER}`,
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  background: "transparent",
  cursor: "pointer",
  textTransform: "uppercase",
};

const chipNeutral: React.CSSProperties = {
  ...chipBase,
  color: cream(0.85),
};

const tableHeadRow: React.CSSProperties = {
  background: cream(0.08),
  color: cream(0.9),
  textTransform: "uppercase",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.7rem 1rem",
  fontFamily: "var(--font-body)",
  fontWeight: 400,
  borderBottom: `1px solid ${cream(0.15)}`,
};

const td: React.CSSProperties = {
  padding: "0.7rem 1rem",
  fontFamily: "var(--font-body)",
  color: CREAM,
  fontSize: "1rem",
  verticalAlign: "top",
  borderBottom: `1px solid ${cream(0.06)}`,
};

// The Date cell's own trigger. Looks like the text it replaces, but it is
// a real button so the row-click guard leaves it alone.
const dateButton: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
  textAlign: "left",
  cursor: "pointer",
  textDecoration: "underline",
  textUnderlineOffset: "3px",
  textDecorationColor: BORDER,
};

// Metrics for the shared ui/Select — same values the orders board uses, so
// the two lists read identically. Colour is handled globally: the scoped
// rules in src/app/admin/layout.tsx repaint the Select's Foundation Green
// to INK for both the trigger and the open menu. 0.875rem = 14px, the floor.
const statusSelect: React.CSSProperties = {
  padding: "0.3rem 0.5rem",
  background: "transparent",
  border: `1px solid ${cream(0.45)}`,
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  cursor: "pointer",
  // Wider than the orders board's 140 — "Pending confirmation" is the
  // longest label here and truncating it would hide the one status an
  // operator most needs to recognise.
  maxWidth: 240,
  minHeight: 0,
  borderRadius: 6,
};

const buttonSm: React.CSSProperties = {
  padding: "0.3rem 0.7rem",
  background: "transparent",
  border: `1px solid ${cream(0.45)}`,
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  cursor: "pointer",
};
