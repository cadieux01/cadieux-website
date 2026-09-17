"use client";

// Subscriptions admin board. Calls the enriched
// /api/admin/subscriptions?enrich=1 endpoint so each row carries a
// server-computed derived_end_date and remaining_deliveries count.
//
// Pause/Resume/Cancel actions hit the existing PATCH
// /api/admin/subscriptions/[id] route. We don't build new transition
// logic here.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import Select from "@/components/ui/Select";
import MultiSelect from "@/components/ui/MultiSelect";
import { ALL_VALUE } from "@/lib/order-filter";
import {
  CLEAR_ALL,
  assertStatusCountsPartition,
  distinctStatuses,
  separator,
  statusGroupOptions,
  triggerLabel,
} from "@/lib/filter-menu";
import {
  EXPIRING_7D,
  PAID_UNCONFIRMED,
  PAYMENT_FILTERS,
  PAY_PREFIX,
  isPaidUnconfirmed,
  matchesSubscriptionFilter,
  splitSubscriptionFilterValues,
  type FilterableSubscription,
} from "@/lib/subscription-filter";
import { formatSubscriptionNumber } from "@/lib/order-number";
import { isSubscriptionFulfilled } from "@/lib/order-fulfillment";
import { FulfilledTick } from "@/components/admin/FulfilledTick";
import { DayFilter } from "@/components/admin/DayFilter";
import {
  DEFAULT_BASIS,
  matchesAnyDay,
  parseBasis,
  parseDayParam,
  subscriptionDatesForBasis,
  type DateBasis,
} from "@/lib/day-filter";
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
import { isOrphanedPayment } from "@/lib/subscription-visibility";
import { NoteIconButton } from "@/components/admin/NoteIconButton";
import { NotePanel } from "@/components/admin/NotePanel";
import { ensureAdminFirstName } from "@/lib/admin-first-name";
import { CALL_PRESETS } from "@/lib/admin-call-updates";
import { LastNoteChip } from "@/components/admin/LastNoteChip";
import { matchesAdminQuery } from "@/lib/admin-search";

// The status group's PREFERRED ORDER, not the menu itself. The menu is built
// from the statuses actually present (see distinctStatuses below) — this list
// only decides what comes first. That distinction is the whole fix: the old
// hardcoded chip row listed `paused`, which is not a value public.subscriptions
// has ever held, so the board permanently advertised "PAUSED · 0".
//
// SUBSCRIPTION_STATUSES itself is NOT reused here: it is the set of statuses an
// operator may WRITE from the drawer, which legitimately includes `paused`.
// What you can set and what exists in the data are different questions.
const STATUS_ORDER: readonly string[] = [
  ALL_VALUE,
  "pending_confirmation",
  "active",
  "completed",
  "cancelled",
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

/**
 * Why this row must not be handed to a rider, or null if it may be.
 *
 * `abandoned` is a plan whose payment attempt died and which the sweeper
 * has already cancelled every delivery row of. It has no next delivery,
 * nobody is baking for it and nobody is owed anything.
 *
 * It was unreachable until now only because /api/admin/subscriptions was
 * silently filtering these rows off the board. That filter is gone — it
 * was hiding OLS34 from Sunny while it went created → abandoned and
 * nobody rang Padmavathi. But "must be SEEN" and "may be DISPATCHED" are
 * different questions, and un-hiding the row answered only the first.
 *
 * Without this, the Share button on a swept plan composes cleanly and
 * cheerfully — composeNextDeliveryShareStop falls back to naming the
 * plan when next_delivery is null, "so the button is never dead" — and
 * sends a rider to a door with "COD ₹288" against money nobody owes.
 * Labelling it differently would not help; the row must not go out.
 */
function shareBlockedReason(s: AdminSubscriptionRow): string | null {
  const status = (s.payment_status ?? "").trim().toLowerCase();
  if (status === "abandoned") {
    return (
      "Not shareable — payment was never completed, so every delivery on " +
      "this plan is already cancelled. There is nothing for a rider to " +
      "deliver and no money to collect. Call the customer instead."
    );
  }
  return null;
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
// that reads useSearchParams() — the ?basis/?date hydration does.
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
  // Multi-select, flat: status keys plus `pay:`-prefixed payment states plus
  // the one computed filter. splitSubscriptionFilterValues sorts them out.
  //
  // EMPTY MEANS "ALL STATUSES" — there is no "all" member. Representing it as
  // a value would create two encodings of the same state ([] and ["all"]) that
  // could disagree. Same rule as /admin/orders.
  const [filter, setFilter] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which row's Date cell is showing its subscribed/receives breakdown.
  const [openDateId, setOpenDateId] = useState<string | null>(null);
  const [noteOwner, setNoteOwner] = useState<
    | { kind: "subscription"; id: string; label: string }
    | null
  >(null);
  const [callBusyId, setCallBusyId] = useState<string | null>(null);

  // The date filter: the same control, the same module and the same two
  // params as /admin/orders.
  //
  // The default is NO DAY — every row. It replaces a "last one year"
  // preset that existed only to undo the old shared default of "This
  // Month", which on created_at had hidden five live subscriptions,
  // including the only active one, because they were signed up in July.
  // A window wide enough to be harmless was never answering a question;
  // showing everything until an operator picks a day is.
  const searchParams = useSearchParams();
  const [basis, setBasis] = useState<DateBasis>(() =>
    parseBasis(searchParams.get("basis")),
  );
  const [day, setDay] = useState<string | null>(() =>
    parseDayParam(searchParams.get("date")),
  );

  // URL writeback, so a picked day survives reload and Back from a
  // detail page. `replace` rather than `push`: a filter change is not a
  // navigation, and pushing would make Back step through every keystroke
  // of date-picking instead of leaving the board.
  useEffect(() => {
    const params = new URLSearchParams();
    if (basis !== DEFAULT_BASIS) params.set("basis", basis);
    if (day) params.set("date", day);
    const qs = params.toString();
    router.replace(qs ? `/admin/subscriptions?${qs}` : "/admin/subscriptions", {
      scroll: false,
    });
  }, [basis, day, router]);

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

  // Generation counter for `subs`. Every load() stamps its request and
  // discards its own response if anything has touched `subs` since —
  // either a newer load, or a local optimistic write.
  //
  // Without this the 10-second poll silently reverts status changes: the
  // poll fires at t=0, Sunny changes a status at t=0.5s, the poll's
  // response lands at t=1.6s still carrying pre-change data and overwrites
  // the row, which then stays wrong until the NEXT poll. It looks exactly
  // like "the status didn't save" even though the PATCH succeeded.
  const subsGeneration = useRef(0);

  const load = useCallback(async () => {
    const gen = ++subsGeneration.current;
    setError(null);
    try {
      // Always fetch every row (the dataset is small) and filter
      // client-side — that lets the chips show live per-status counts
      // and keeps the "expiring in 7 days" window computable.
      const res = await adminFetch<{ subscriptions: AdminSubscriptionRow[] }>(
        `/api/admin/subscriptions?enrich=1`,
      );
      if (gen !== subsGeneration.current) return;
      setSubs(res.subscriptions ?? []);
    } catch (e) {
      if (gen !== subsGeneration.current) return;
      if (e instanceof AdminFetchError) setError(e.message);
      else if (e instanceof Error) setError(e.message);
      else setError("Could not load subscriptions.");
    } finally {
      // Unconditional: a superseded response must still clear the initial
      // spinner, or a load raced on mount would leave it up forever.
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
  //
  // Skipped while the tab is hidden. A backgrounded board was still firing a
  // full round trip to Tokyo every 10 seconds forever, and nobody was looking
  // at the result. Returning to the tab refetches immediately, so pausing
  // never leaves a human staring at stale data.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load();
    }, 10_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const drawerSub = useMemo(
    () => (drawerId ? subs.find((s) => s.id === drawerId) ?? null : null),
    [drawerId, subs],
  );

  // A subscription is not one delivery, so on the delivery basis it
  // matches the day if ANY of its remaining/served stops lands on it —
  // see subscriptionDatesForBasis. Matching next_delivery alone would
  // drop a plan that runs on the 18th and the 20th from the 20th.
  const onDay = useMemo(
    () =>
      subs.filter((s) =>
        matchesAnyDay(subscriptionDatesForBasis(s, basis), day),
      ),
    [subs, basis, day],
  );

  const isExpiring = useCallback((s: FilterableSubscription): boolean => {
    if (s.status !== "active") return false;
    const end = s.derived_end_date;
    if (!end) return false;
    const today = isoLocalDate(new Date());
    const horizon = addDaysISO(today, 7);
    return end >= today && end <= horizon;
  }, []);

  // The statuses the chosen DAY actually contains, preferred order first and
  // anything unrecognised appended. Never a hardcoded array — that is what
  // hid 46 pending orders on the orders board and invented PAUSED · 0 here.
  const statusValues = useMemo(
    () => [ALL_VALUE, ...distinctStatuses(onDay, STATUS_ORDER)],
    [onDay],
  );

  // One pass, three tallies. Status counts PARTITION the rows (every row has
  // exactly one status); payment and expiry counts OVERLAP them, which is
  // precisely why they are grouped separately in the menu below.
  const counts = useMemo(() => {
    const c: Record<string, number> = { [ALL_VALUE]: onDay.length };
    for (const s of onDay) {
      const st = (s.status ?? "").trim().toLowerCase();
      if (st) c[st] = (c[st] ?? 0) + 1;
      const pay = (s.payment_status ?? "").trim().toLowerCase();
      if (pay) {
        const key = `${PAY_PREFIX}${pay}`;
        c[key] = (c[key] ?? 0) + 1;
      }
      if (isExpiring(s)) c[EXPIRING_7D] = (c[EXPIRING_7D] ?? 0) + 1;
      if (isPaidUnconfirmed(s))
        c[PAID_UNCONFIRMED] = (c[PAID_UNCONFIRMED] ?? 0) + 1;
    }
    return c;
  }, [onDay, isExpiring]);

  const selection = useMemo(
    () => splitSubscriptionFilterValues(filter),
    [filter],
  );

  const filtered = useMemo(() => {
    const rows = onDay.filter((s) => {
      if (!matchesSubscriptionFilter(s, selection, isExpiring)) return false;
      // Both spellings of the customer, because a subscription carries
      // two: the joined `customer` row and the flat snapshot taken at
      // signup. They disagree whenever someone renamed themselves or
      // ordered for a parent, and the operator has no idea which one the
      // caller is about to read out. `delivery_address.phone` is a third
      // number — the one the rider actually calls. Matcher is shared with
      // the orders board; see admin-search.ts.
      return matchesAdminQuery(query, [
        s.customer?.full_name,
        s.customer?.phone,
        s.customer_name,
        s.customer_phone,
        s.delivery_address?.phone,
        s.subscription_number,
      ]);
    });
    // Status group first, newest-first within each group, so completed and
    // cancelled subscriptions stop pushing live ones down the page. The API
    // already returns created_at DESC; this re-sorts a copy. Display only —
    // no status is written. See subscriptionStatusRank in lib/admin-shared.
    //
    // Above all of it: paid but not yet confirmed. pending_confirmation is
    // already rank 1, but that bucket holds unpaid rows too, and those two
    // are not the same urgency — one owes us money, the other is owed bread.
    // Ranking it 0 here rather than in subscriptionStatusRank keeps that
    // helper a pure function of `status`, which orders shares.
    const rank = (s: AdminSubscriptionRow) =>
      isPaidUnconfirmed(s) ? 0 : subscriptionStatusRank(s);
    return [...rows].sort((a, b) => {
      const rankCmp = rank(a) - rank(b);
      if (rankCmp !== 0) return rankCmp;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [onDay, selection, isExpiring, query]);

  // THE MENU. Three groups, and the divider between them is load-bearing:
  //
  //   statuses   — partition the rows, counts sum to the header count
  //   payment    — a DIFFERENT column, so it overlaps every status above
  //   filters    — computed from derived_end_date, overlaps everything
  //
  // "Expiring in 7 days" used to sit in the status row as a seventh chip.
  // Its 7 rows are 3 pending_confirmation + 2 active + 2 completed, each of
  // which was ALSO counted in its own chip, so the chips added up to more
  // than the table held.
  const filterOptions = useMemo(() => {
    const opts = statusGroupOptions(
      statusValues,
      counts,
      selection.statuses,
      formatStatusLabel,
    );

    // Payment. Only listed when the range contains rows in that state (or the
    // operator has it ticked) — same zero-count rule as the statuses.
    const payTicked = selection.payments.map((p) => `${PAY_PREFIX}${p}`);
    const payShown = PAYMENT_FILTERS.filter(
      (p) => (counts[p.value] ?? 0) > 0 || payTicked.includes(p.value),
    );
    if (payShown.length > 0) {
      opts.push(separator("__sep_pay", "Payment"));
      for (const p of payShown) {
        opts.push({ value: p.value, label: `${p.label} (${counts[p.value] ?? 0})` });
      }
    }

    // Computed. Labelled as filters, never as statuses.
    opts.push(separator("__sep_computed", "Filters (not statuses)"));
    opts.push({
      value: PAID_UNCONFIRMED,
      label: `Paid, not confirmed (${counts[PAID_UNCONFIRMED] ?? 0})`,
    });
    opts.push({
      value: EXPIRING_7D,
      label: `Expiring in 7 days (${counts[EXPIRING_7D] ?? 0})`,
    });

    if (filter.length > 0) {
      opts.push({ value: CLEAR_ALL, label: "Clear all", action: true });
    }
    return opts;
  }, [statusValues, counts, selection, filter.length]);

  // The bracketed number is the LIVE ROW COUNT, never the sum of the ticked
  // options — see triggerLabel. Tick a status and a payment state and the two
  // groups AND, so the sum becomes an upper bound.
  const filterLabel = useMemo(
    () => triggerLabel(filterOptions, filter, filtered.length),
    [filterOptions, filter, filtered.length],
  );

  // Dev-only breadcrumb: real-status counts must sum to the unfiltered row
  // count. Asserts the RELATIONSHIP — the number moves daily.
  useEffect(() => {
    assertStatusCountsPartition(
      "admin/subscriptions",
      counts,
      statusValues.filter((v) => v !== ALL_VALUE),
      onDay.length,
    );
  }, [counts, statusValues, onDay.length]);

  const toggleFilter = useCallback((value: string) => {
    if (value.startsWith("__sep_")) return;
    setFilter((curr) => {
      if (value === CLEAR_ALL) return [];
      // "All statuses" clears the STATUS group only, leaving payment and
      // computed filters ticked — it is named "All statuses", not "All rows".
      if (value === ALL_VALUE)
        return curr.filter(
          (v) =>
            v.startsWith(PAY_PREFIX) ||
            v === EXPIRING_7D ||
            v === PAID_UNCONFIRMED,
        );
      return curr.includes(value)
        ? curr.filter((v) => v !== value)
        : [...curr, value];
    });
  }, []);

  // "All statuses" ticks when no status is chosen, mirroring the orders menu.
  const tickedValues = useMemo(
    () => (selection.statuses.length === 0 ? [...filter, ALL_VALUE] : filter),
    [filter, selection.statuses.length],
  );

  // Shared by the row's Select and its shortcut buttons, so both writes
  // go through the same optimistic-update + expected_status guard.
  const setStatus = async (sub: AdminSubscriptionRow, nextStatus: string) => {
    if (nextStatus === sub.status) return;
    setBusyId(sub.id);
    const prev = subs;
    // Invalidate any load() already in flight. It was fetched BEFORE this
    // write, so its response describes the old status and would undo the
    // optimistic update below.
    subsGeneration.current += 1;
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
      // Rollback is also a local write — same invalidation.
      subsGeneration.current += 1;
      setSubs(prev);
      if (e instanceof AdminFetchError) alert(e.message);
      else alert("Update failed.");
    } finally {
      setBusyId(null);
    }
  };

  // Append a call-preset note to a subscription. Mirrors the orders
  // board pattern: optimistically bumps note_count + last_call_note so
  // the chip flips without waiting on the poll.
  const postCallNote = async (sub: AdminSubscriptionRow, body: string) => {
    if (callBusyId) return;
    setCallBusyId(sub.id);
    try {
      const author = ensureAdminFirstName();
      const payload: Record<string, unknown> = {
        subscription_id: sub.id,
        kind: "call",
        body,
      };
      if (author) payload.author = author;
      const res = await adminFetch<{
        note: {
          id: string;
          kind: string;
          body: string;
          author: string | null;
          created_at: string;
        };
      }>("/api/admin/notes", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      subsGeneration.current += 1;
      setSubs((curr) =>
        curr.map((s) =>
          s.id === sub.id
            ? {
                ...s,
                note_count: (s.note_count ?? 0) + 1,
                last_call_note: {
                  body: res.note.body,
                  author: res.note.author,
                  created_at: res.note.created_at,
                },
              }
            : s,
        ),
      );
    } catch (e) {
      alert(
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to save call update.",
      );
    } finally {
      setCallBusyId(null);
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
      {/* Both controls come from the same modules the orders board uses, so
          the two boards cannot ask the same question two ways. DayFilter
          replaced the old From/To pair and its "last one year" preset — that
          preset only ever existed to undo a default which had itself hidden
          five live plans. */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <DayFilter
          idPrefix="subs-date"
          basis={basis}
          onBasisChange={setBasis}
          day={day}
          onDayChange={setDay}
        />
        {/* Same MultiSelect the orders board uses. The menu stays open so
            several can be ticked in a row; it closes on outside click or Esc. */}
        {/* Wider than the orders board's 230: "Payment not completed (5)" is
            the longest label either menu carries and it ellipsised at 260. */}
        <div style={{ minWidth: 300 }}>
          <MultiSelect
            values={tickedValues}
            onToggle={toggleFilter}
            triggerLabel={filterLabel}
            ariaLabel="Filter subscriptions by status"
            options={filterOptions}
          />
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, phone or OLS ref"
          aria-label="Search subscriptions"
          className="px-3 py-2 bg-transparent outline-none"
          style={{
            border: "1px solid rgba(251,243,212,0.3)",
            color: "#FBF3D4",
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            letterSpacing: "0.05em",
            minWidth: 240,
          }}
        />
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

      {!loading && filtered.length > 0 ? (
        // Fulfilment ratio for the current filter. Mirrors the "N of M
        // fulfilled" span on ProductionCountStrip so the two boards
        // read the same way. Definition of "fulfilled" is centralised
        // in lib/order-fulfillment.ts and includes the delivery-rows
        // safety net (see isSubscriptionFulfilled).
        <section
          aria-label="Fulfilment count for current filter"
          style={{
            margin: "0 0 12px",
            padding: "10px 14px",
            border: "1px solid rgba(251,243,212,0.18)",
            borderRadius: 6,
            background: "rgba(251,243,212,0.04)",
            color: CREAM,
            display: "flex",
            alignItems: "center",
            gap: 20,
            fontFamily: "var(--font-body)",
            fontSize: 14,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.35em",
              textTransform: "uppercase",
              color: cream(0.6),
            }}
          >
            Summary
          </span>
          <span style={{ marginLeft: "auto", color: cream(0.85) }}>
            {filtered.reduce(
              (n, s) => (isSubscriptionFulfilled(s) ? n + 1 : n),
              0,
            )}{" "}
            of {filtered.length} fulfilled
          </span>
        </section>
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
                <th style={th}>Subscription</th>
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
                // Money in, plan not confirmed. Derived, never stored — see
                // isPaidUnconfirmed. Marks the row and nothing else: Share
                // stays enabled, because the payment is good and the bread
                // is owed, which is the whole reason it needs chasing.
                const paidUnconfirmed = isPaidUnconfirmed(s);
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
                      // A left rule rather than a tinted row: the zebra
                      // striping already owns the background, and an amber
                      // wash over alternating greys reads as two different
                      // ambers.
                      boxShadow: paidUnconfirmed
                        ? "inset 3px 0 0 0 #F59E0B"
                        : undefined,
                    }}
                  >
                    <td style={td} data-label="Subscription">
                      <span
                        style={{
                          fontSize: "0.875rem",
                          letterSpacing: "0.1em",
                          color: CREAM,
                        }}
                        title={s.id}
                      >
                        {formatSubscriptionNumber(s)}
                        {isSubscriptionFulfilled(s) ? <FulfilledTick /> : null}
                      </span>
                    </td>
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
                      {/* The left rule says a row is special; this says WHICH
                          special. "Pending confirmation" alone reads as "no
                          hurry" and on a paid plan it is the opposite. */}
                      {paidUnconfirmed && (
                        <div
                          style={{
                            marginTop: 4,
                            display: "inline-block",
                            padding: "1px 6px",
                            border: "1px solid rgba(245,158,11,0.6)",
                            color: "#F59E0B",
                            fontSize: "0.75rem",
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            borderRadius: 3,
                          }}
                          title="Payment received and the plan is not confirmed yet — bread is owed."
                        >
                          Paid · not confirmed
                        </div>
                      )}
                      {/* Call-update dropdown — separate control from the
                          status Select. Presets append kind='call' notes;
                          "Custom" opens the NotePanel with kind pre-set. */}
                      <div style={{ marginTop: 6 }}>
                        <Select
                          value=""
                          disabled={callBusyId === s.id}
                          ariaLabel="Log a call update"
                          style={statusSelect}
                          onChange={(v) => {
                            if (!v) return;
                            if (v === "__custom") {
                              setNoteOwner({
                                kind: "subscription",
                                id: s.id,
                                label: formatSubscriptionNumber(s),
                              });
                              return;
                            }
                            void postCallNote(s, v);
                          }}
                          options={[
                            { value: "", label: "Call update…" },
                            ...CALL_PRESETS.map((p) => ({
                              value: p,
                              label: p,
                            })),
                            { value: "__custom", label: "Custom…" },
                          ]}
                        />
                      </div>
                      {/* The newest note of ANY kind, same component and same
                          colours as the orders board. This board used to read
                          `last_call_note`, so a plain note or an admin edit
                          left no trace here at all — the chip was present,
                          which is what made the gap invisible. */}
                      <LastNoteChip note={s.last_note} />
                      {/* An orphan's `status` is untouched — it still reads
                          "Pending confirmation", which is exactly how it
                          would slip past a skim. The money is only visible
                          in payment_status, so surface it here explicitly
                          and say what it needs, not just what it is. */}
                      {isOrphanedPayment(s) ? (
                        <div style={{ marginTop: 6 }}>
                          <StatusBadge status="paid_orphaned" />
                          <div
                            style={{
                              marginTop: 4,
                              color: "#F59E0B",
                              fontSize: "0.875rem",
                              lineHeight: 1.5,
                              maxWidth: 260,
                            }}
                          >
                            Payment received, nothing scheduled — your
                            decision: refund, or restart on fresh dates.
                          </div>
                        </div>
                      ) : null}
                    </td>
                    <td style={td} data-label="Actions">
                      <div className="flex flex-wrap gap-2 items-center">
                        <NoteIconButton
                          count={s.note_count ?? 0}
                          onClick={() =>
                            setNoteOwner({
                              kind: "subscription",
                              id: s.id,
                              label: formatSubscriptionNumber(s),
                            })
                          }
                        />
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
                          blockedReason={shareBlockedReason(s)}
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

      {noteOwner ? (
        <NotePanel
          owner={noteOwner}
          onCountChange={(next) => {
            const targetId = noteOwner.id;
            subsGeneration.current += 1;
            setSubs((curr) =>
              curr.map((s) =>
                s.id === targetId ? { ...s, note_count: next } : s,
              ),
            );
          }}
          onClose={() => {
            // Panel edits are append-only. Reload so a custom call note
            // added inside the panel becomes the row's last_call_note.
            setNoteOwner(null);
            void load();
          }}
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

  // Same race, same guard as the list above: this drawer runs its own
  // 10-second poll, and updateDeliveryStatus writes optimistically into the
  // state that poll overwrites.
  const deliveriesGeneration = useRef(0);

  const fetchDeliveries = useCallback(async () => {
    const gen = ++deliveriesGeneration.current;
    try {
      const r = await adminFetch<{ deliveries: AdminDeliveryRow[] }>(
        `/api/admin/subscriptions/${subscription.id}/deliveries`,
      );
      if (gen !== deliveriesGeneration.current) return;
      setDeliveries(r.deliveries ?? []);
      setError(null);
    } catch (e) {
      if (gen !== deliveriesGeneration.current) return;
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
    deliveriesGeneration.current += 1;
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
      deliveriesGeneration.current += 1;
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
              options={[
                ...SUBSCRIPTION_PAYMENT_STATUSES.map((opt) => ({
                  value: opt,
                  label: formatStatusLabel(opt),
                })),
                // 'paid_orphaned' is written by the verify path, never chosen
                // here — the PATCH route rejects it — but the row still has to
                // render its own value or the control would come up blank and
                // the one state that needs attention would look like no state
                // at all. Resolving it means picking Refunded or Paid, which
                // are already in the list above.
                ...(subscription.payment_status &&
                !(
                  SUBSCRIPTION_PAYMENT_STATUSES as readonly string[]
                ).includes(subscription.payment_status)
                  ? [
                      {
                        value: subscription.payment_status,
                        label: formatStatusLabel(subscription.payment_status),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
          {isOrphanedPayment(subscription) ? (
            <div
              style={{
                border: "1px solid rgba(245,158,11,0.6)",
                borderRadius: 4,
                padding: "10px 12px",
                color: "#F59E0B",
                fontSize: "0.9375rem",
                lineHeight: 1.6,
              }}
            >
              Payment received, nothing scheduled — your decision. This money
              arrived after the subscription had already been written off, so
              the deliveries are cancelled and no dates are booked. Call the
              customer, then either refund in full or restart the plan on
              fresh dates.
            </div>
          ) : null}
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

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {groupDeliveriesByWeek(deliveries).map((g) => (
            <AdminWeekGroup key={g.week} group={g}>
              {g.items.map((d) => (
                <DeliveryCard
                  key={d.id}
                  delivery={d}
                  onStatusChange={(next) =>
                    void updateDeliveryStatus(d.id, next)
                  }
                  onNotesSave={(notes) => void updateDeliveryNotes(d.id, notes)}
                />
              ))}
            </AdminWeekGroup>
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

/** ISO date `YYYY-MM-DD` for today in local time. Used only for the "past
 *  week" collapse heuristic — an exact tz is not load-bearing here (a week
 *  boundary drifting by a few hours doesn't change the collapse decision). */
function localTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Group deliveries by `week_number`, ordered ascending. week 0 (or
 *  missing) is legal — the DB uses it as a sentinel. */
function groupDeliveriesByWeek(
  items: AdminDeliveryRow[],
): { week: number; items: AdminDeliveryRow[] }[] {
  const map = new Map<number, AdminDeliveryRow[]>();
  for (const it of items) {
    const w = it.week_number ?? 0;
    const cur = map.get(w);
    if (cur) cur.push(it);
    else map.set(w, [it]);
  }
  return Array.from(map.entries())
    .map(([week, list]) => ({ week, items: list }))
    .sort((a, b) => a.week - b.week);
}

/**
 * Wrap one week's deliveries with a summary header ("Week 3 — 2 of 2
 * delivered") and collapse the body when the whole week is done and in
 * the past. Current or open weeks stay expanded. Header is a real button
 * so keyboard + screen-reader users can toggle.
 */
function AdminWeekGroup({
  group,
  children,
}: {
  group: { week: number; items: AdminDeliveryRow[] };
  children: React.ReactNode;
}) {
  const total = group.items.length;
  const delivered = group.items.filter((d) => d.status === "delivered").length;
  const cancelled = group.items.filter((d) => d.status === "cancelled").length;
  const open = total - delivered - cancelled;
  const allTerminal = open === 0;
  const today = localTodayIso();
  const allPast = group.items.every((d) => d.scheduled_date < today);
  // Collapse only fully-terminal past weeks — the operator's job is on the
  // open ones, so those must NEVER hide themselves.
  const [collapsed, setCollapsed] = useState<boolean>(allTerminal && allPast);
  const summary = allTerminal
    ? cancelled === total
      ? `${total} cancelled`
      : `${delivered} of ${total} delivered${cancelled ? ` · ${cancelled} cancelled` : ""}`
    : `${delivered} of ${total} delivered · ${open} open`;
  return (
    <div
      style={{
        border: "1px solid rgba(251,243,212,0.12)",
        borderRadius: 4,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        style={{
          appearance: "none",
          background: "transparent",
          border: "none",
          color: "rgba(251,243,212,0.85)",
          padding: 0,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: "inherit",
          fontSize: "0.875rem",
          letterSpacing: "0.25em",
          textTransform: "uppercase",
        }}
      >
        <span>
          Week {group.week} — {summary}
        </span>
        <span
          aria-hidden
          style={{
            fontSize: 14,
            color: "rgba(251,243,212,0.6)",
            marginLeft: 12,
            transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
            transition: "transform 0.15s ease",
          }}
        >
          ›
        </span>
      </button>
      {!collapsed ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {children}
        </div>
      ) : null}
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
    { header: "Subscription", value: (s) => formatSubscriptionNumber(s) },
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
