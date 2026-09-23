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
  decodeStatusParam,
  distinctStatuses,
  encodeStatusParam,
  separator,
  statusGroupOptions,
  triggerLabel,
} from "@/lib/filter-menu";
import {
  useScrollRestore,
  useUrlWriteback,
  stashScrollY,
} from "@/lib/admin-url-state";
import { MONTH_SHORT, WEEKDAY_SHORT } from "@/lib/date-names";
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
import { ZoneBadge } from "@/components/admin/ZoneBadge";
import {
  EMPTY_RULE_SET,
  ZONE_KEYS,
  ZONE_LABELS,
  flattenSubscriptionAddress,
  pickRuleKey,
  resolveZoneWithSource,
  type ZoneKey,
  type ZoneResolution,
  type ZoneRuleSet,
} from "@/lib/delivery-zones";
import {
  ZONE_PREFIX,
  decodeZoneParam,
  encodeZoneParam,
} from "@/lib/order-filter";
import {
  buildRuleSet,
  type ZoneRowOverrideRow,
  type ZoneRuleRow,
} from "@/lib/zone-rules";
import { fetchAllRules } from "@/lib/zone-rules-client";
import { ZoneAssignPopover } from "@/components/admin/ZoneAssignPopover";
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
  addCounts,
  countLines,
  countPlan,
  countsByDateFromRecord,
  countsFromRecord,
  longCountText,
  nameHintFor,
  totalLoaves,
  type LoafCounts,
} from "@/lib/subscription-counts";
import { CountMarkers, DayDotRow } from "@/components/admin/ProductMarker";
import {
  addDaysISO,
  formatDate,
  formatINR,
  isoLocalDate,
  istDateParts,
} from "@/lib/admin-formatting";
import {
  describeSubscriptionPlan,
  formatSubscriptionItems,
  subscriptionDays,
  resolveSubscriptionAddress,
  formatAddressShort,
  formatAddressFull,
  phonesDiffer,
} from "@/lib/subscription-display";
import {
  composeNextDeliveryShareMessage,
  composeNextDeliveryShareStop,
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
import { RepeatStar } from "@/components/admin/RepeatStar";
import { buildRepeatIndex } from "@/lib/customer-history";
import { matchesAdminQuery } from "@/lib/admin-search";
import { BulkToolbar, type BulkActionSpec } from "@/components/admin/BulkToolbar";
import { useStoredSelection } from "@/lib/admin-selection";
import { deliverShareText } from "@/lib/share-delivery";
import { composeRun } from "@/lib/order-share-message";

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

// Its own bucket, so ticking six plans here does not resurrect as six
// orders on the other board — the ids would not match anything and the
// toolbar would report a selection the operator cannot see.
const SELECTION_KEY = "admin:subscriptions:selection";

// Its own scroll bucket for the same reason — /admin/orders must not restore
// to an offset measured on a list of a different length.
const SCROLL_KEY = "admin:subscriptions:scrollY";

type SubBulkAction = "share" | "copy";

// No bulk Cancel. Cancelling a plan cancels every delivery hanging off it
// and is a per-plan decision with a refund question attached; there is no
// version of that which should be one click away from six ticked rows.
const BULK_ACTIONS: readonly BulkActionSpec<SubBulkAction>[] = [
  { id: "share", label: "Share on WhatsApp" },
  { id: "copy", label: "Copy details" },
];

function SubscriptionsPageInner() {
  const router = useRouter();
  const [subs, setSubs] = useState<AdminSubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every control on this board hydrates from the query string on first
  // render and mirrors back to it on change, so opening a plan and pressing
  // Back returns the operator to the same slice rather than to an unfiltered
  // board they have to re-narrow. Same contract as /admin/orders.
  //
  // Read ONCE, in a lazy initialiser: useSearchParams() subscribes, and
  // re-deriving state from it on every render would fight the writeback
  // below for control of the same values.
  const searchParams = useSearchParams();

  // ONE multi-select, flat: status keys, `pay:`-prefixed payment states,
  // `zone:`-prefixed delivery zones, and the two computed filters.
  // splitSubscriptionFilterValues sorts them back out into groups.
  //
  // EMPTY MEANS "ALL STATUSES" — there is no "all" member. Representing it as
  // a value would create two encodings of the same state ([] and ["all"]) that
  // could disagree. Same rule as /admin/orders.
  //
  // ZONES LIVE IN HERE, not in a second dropdown beside it. They arrived as
  // their own control because at the time this board still had a chip row
  // with a fixed enum, which could not host them; the orders board has always
  // carried them as a group inside its one menu. Leaving the split in place
  // would mean an operator who learned "zones are in the filter menu" on
  // orders finds no zones in the filter menu here — the precise kind of
  // divergence this work exists to remove.
  //
  // The URL keeps them APART regardless: `status` and `zone` stay separate
  // params, so every link either board has ever produced still parses, and a
  // status selection and a zone selection stay orthogonal to read.
  const [filter, setFilter] = useState<string[]>(() => [
    ...decodeStatusParam(searchParams.get("status")),
    ...decodeZoneParam(searchParams.get("zone")).map(
      (z) => `${ZONE_PREFIX}${z}`,
    ),
  ]);
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");

  // The flat selection, split back into its groups. Declared here rather
  // than beside `filtered` because the URL writeback below needs the zones
  // separated too — splitting twice is how the menu and the URL start
  // disagreeing about what is selected.
  const selection = useMemo(
    () => splitSubscriptionFilterValues(filter),
    [filter],
  );
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
  const [basis, setBasis] = useState<DateBasis>(() =>
    parseBasis(searchParams.get("basis")),
  );
  const [day, setDay] = useState<string | null>(() =>
    parseDayParam(searchParams.get("date")),
  );

  // Defaults are OMITTED, not encoded, so a plain /admin/subscriptions link
  // stays clean and the parsers above remain the single source of truth for
  // what "unset" means.
  //
  // This builds the query string from scratch out of the state the board
  // actually has, so a param it no longer understands cannot survive. That
  // is what retires the old "nearest from area" sort safely: a bookmark
  // still carrying ?area=&area_lat=&area_lng=&area_via= is parsed by
  // nothing, sorts nothing, and is dropped from the URL on the first
  // writeback. The board opens status-grouped, its only sort.
  const qs = useMemo(() => {
    const params = new URLSearchParams();
    // Zones ride in the same flat `filter` as everything else but are
    // written to their OWN param, so the URL keeps saying what it always
    // said and `status` never grows a `zone:`-prefixed member.
    const nonZone = filter.filter((v) => !v.startsWith(ZONE_PREFIX));
    if (nonZone.length > 0) params.set("status", encodeStatusParam(nonZone));
    if (query.trim()) params.set("q", query);
    if (basis !== DEFAULT_BASIS) params.set("basis", basis);
    if (day) params.set("date", day);
    if (selection.zones.length > 0)
      params.set("zone", encodeZoneParam(selection.zones));
    return params.toString();
  }, [filter, selection.zones, query, basis, day]);
  useUrlWriteback("/admin/subscriptions", qs);
  useScrollRestore(SCROLL_KEY, !loading);

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

  // Repeat-plan index, same pure builder the orders list endpoint uses.
  //
  // Built over `subs` and NOT over `inRange`: "has this person subscribed
  // before" is a fact about the customer, not about the date window the
  // operator happens to be looking through. Narrowing to a week would
  // un-star everyone whose first plan predates it, which is the exact
  // opposite of what the star is for.
  //
  // Keyed on phone, so the two spellings of the customer collapse to one
  // person; cancelled plans are excluded by the builder, so a plan someone
  // cancelled and never replaced does not star their next one.
  const repeatIndex = useMemo(
    () =>
      buildRepeatIndex(
        subs.map((s) => ({
          id: s.id,
          status: s.status,
          created_at: s.created_at,
          total_amount: s.total_amount,
          customers: { phone: s.customer?.phone ?? s.customer_phone },
        })),
      ),
    [subs],
  );

  // Learned rules. Same shape and lifecycle as the orders board: fetched
  // once on mount, reloaded on write, NOT polled. A failed fetch leaves the
  // rule set empty and the resolver falls back to the built-in map.
  const [ruleRows, setRuleRows] = useState<ZoneRuleRow[]>([]);
  const [overrideRows, setOverrideRows] = useState<ZoneRowOverrideRow[]>([]);
  const zoneRules: ZoneRuleSet = useMemo(
    () => (ruleRows.length + overrideRows.length === 0
      ? EMPTY_RULE_SET
      : buildRuleSet(ruleRows, overrideRows)),
    [ruleRows, overrideRows],
  );
  const loadRules = useCallback(async () => {
    try {
      const res = await fetchAllRules();
      setRuleRows(res.rules);
      setOverrideRows(res.overrides);
    } catch {
      /* built-in map fallback — see orders board */
    }
  }, []);
  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const [assignTarget, setAssignTarget] = useState<{
    subscriptionId: string;
    anchorRect: DOMRect;
  } | null>(null);

  // Zone lookup keyed by subscription id. Computed off `subs` so it costs
  // one pass per fetch, not one per keystroke of the status filter. The
  // resolver takes strings, so we flatten the row's jsonb + string address
  // fields into a single input and pass customer_pincode as the explicit
  // pin (more trustworthy than a stray 6-digit run in a free-text line).
  // Subscriptions never ship as pickup — the fulfillment branch that adds
  // the pickup zone lives on the orders board.
  const zoneResOf = useMemo(() => {
    const map = new Map<string, ZoneResolution>();
    for (const s of subs) {
      const address = flattenSubscriptionAddress({
        customer_address: s.customer_address,
        delivery_address: s.delivery_address,
      });
      map.set(
        s.id,
        resolveZoneWithSource(
          { address, pincode: s.customer_pincode ?? null, subscriptionId: s.id },
          zoneRules,
        ),
      );
    }
    return map;
  }, [subs, zoneRules]);
  const zoneOf = useMemo(() => {
    const map = new Map<string, ZoneKey>();
    zoneResOf.forEach((r, id) => map.set(id, r.zone));
    return map;
  }, [zoneResOf]);

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

  // Per-zone counts for the current on-day slice, so the MultiSelect can
  // show live counts next to each zone name. Pickup is included in the
  // shape for parity with the orders board even though subscriptions
  // never resolve to it — the count will simply always be zero.
  const zoneCounts = useMemo(() => {
    const c: Record<ZoneKey, number> = {
      zone1: 0,
      zone2: 0,
      zone3: 0,
      zone4: 0,
      unzoned: 0,
      pickup: 0,
    };
    for (const s of onDay) {
      const z = zoneOf.get(s.id);
      if (z) c[z]++;
    }
    return c;
  }, [onDay, zoneOf]);

  // The Zones group inside the one menu. Unzoned stays visible even at zero
  // so an operator can see the bucket exists. Numbered zones hide at zero
  // unless already ticked — same rule the status group uses, and the same
  // rule the orders board's zone group uses. Pickup is omitted entirely:
  // a subscription is never a pickup, so listing it would be offering a
  // filter that is permanently empty rather than an honest bucket.
  const zoneOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    for (const zk of ZONE_KEYS) {
      if (zk === "pickup") continue;
      const zc = zoneCounts[zk];
      const ticked = selection.zones.includes(zk);
      const alwaysShow = zk === "unzoned";
      if (!alwaysShow && !ticked && zc === 0) continue;
      opts.push({
        value: `${ZONE_PREFIX}${zk}`,
        label: `${ZONE_LABELS[zk]} (${zc})`,
      });
    }
    return opts;
  }, [zoneCounts, selection.zones]);

  // Dev-only invariant: zone buckets partition the on-day slice. If this
  // ever fails a subscription's address resolved to something outside the
  // enum, which means the map has a bug.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const sum = ZONE_KEYS.reduce((n, k) => n + zoneCounts[k], 0);
    if (sum !== onDay.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `[admin/subscriptions] zone partition mismatch: ${sum} vs ${onDay.length}`,
      );
    }
  }, [zoneCounts, onDay.length]);

  const filtered = useMemo(() => {
    const rows = onDay.filter((s) => {
      if (!matchesSubscriptionFilter(s, selection, isExpiring)) return false;
      // Zone is AND'd with every other group. Fail closed on a missing
      // zoneOf entry so an enrichment miss shows up as "no rows" rather
      // than silent over-inclusion — same rule as the orders board.
      if (selection.zones.length > 0) {
        const z = zoneOf.get(s.id);
        if (!z || !selection.zones.includes(z)) return false;
      }
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
  }, [
    onDay,
    selection,
    isExpiring,
    query,
    zoneOf,
  ]);

  // ── loaf counts ─────────────────────────────────────────────────────────
  //
  // Derived from `filtered`, so every filter — status, zone, day, search —
  // moves these numbers with the rows. Nothing here re-reads the raw list,
  // which is the only way the bar and the table can be guaranteed to agree.
  //
  // `loaf_counts` is summed server-side across each plan's non-cancelled
  // deliveries (see the enrich branch of /api/admin/subscriptions). Rows
  // fetched without ?enrich=1 have none, and countsFromRecord returns an
  // empty map for them rather than guessing.
  const nameHint = useMemo(() => nameHintFor(filtered), [filtered]);

  // Is the summary scoped to ONE date?
  //
  // Only on the DELIVERY basis. On the order basis the day means "booked on
  // this date", and a plan booked on the 23rd delivers on quite different
  // days — counting its delivery rows against the booking date would produce
  // a number that belongs to neither question. Whole-plan is the honest
  // answer there, and it is what `dateScoped === false` gives.
  const dateScoped = day !== null && basis === "delivery";

  // subscription_id → the counts THIS ROW contributes, under whichever
  // scoping is in force.
  //
  // ONE map, read by both the summary bar and the per-row chip. That is the
  // point of building it here rather than letting each surface do its own
  // lookup: the bar is a sum of the rows, so if the two derive their numbers
  // independently they can drift, and the screen shows a total that none of
  // the visible rows add up to. Deriving both from this map makes that
  // unrepresentable rather than merely unlikely.
  const countsBySub = useMemo(() => {
    const out = new Map<string, LoafCounts>();
    for (const s of filtered) {
      out.set(
        s.id,
        dateScoped
          ? countsByDateFromRecord(s.loaf_counts_by_date).get(day) ??
            (new Map() as LoafCounts)
          : countsFromRecord(s.loaf_counts),
      );
    }
    return out;
  }, [filtered, dateScoped, day]);

  // The summary's two jobs: the loaf counts, and how many plans actually
  // contributed to them.
  //
  // Why `subs` is counted rather than read off `filtered.length`: when a
  // date is selected the sentence claims the plans are "delivering on" that
  // date, and only a plan with a non-cancelled stop on it qualifies.
  // `filtered.length` is the row count, which is the right number for the
  // unscoped sentence and would merely be a plausible one here.
  const summary = useMemo(() => {
    const counts: LoafCounts = new Map();
    let subs = 0;
    for (const s of filtered) {
      const c = countsBySub.get(s.id) ?? (new Map() as LoafCounts);
      if (c.size > 0) subs += 1;
      addCounts(counts, c);
    }
    // Unscoped keeps its long-standing meaning: every row in the filter,
    // including any that carry no counts (rows fetched without ?enrich=1).
    return { counts, subs: dateScoped ? subs : filtered.length };
  }, [filtered, countsBySub, dateScoped]);

  const filteredCounts = summary.counts;
  const filteredLines = useMemo(
    () => countLines(filteredCounts, nameHint),
    [filteredCounts, nameHint],
  );

  // ── bulk selection ──────────────────────────────────────────────────────
  const [selected, setSelected] = useStoredSelection(SELECTION_KEY);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const toggleSelect = (id: string) => {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const masterChecked =
    filtered.length > 0 && filtered.every((s) => selected.has(s.id));
  const someSelected = filtered.some((s) => selected.has(s.id));

  const toggleSelectAll = () => {
    setSelected((curr) => {
      const next = new Set(curr);
      // Add or clear only the currently-VISIBLE ids, so a selection made
      // under another filter is not silently thrown away by a toggle.
      for (const s of filtered) {
        if (masterChecked) next.delete(s.id);
        else next.add(s.id);
      }
      return next;
    });
  };

  /**
   * The ticked rows, in the order the table is currently sorted in, split
   * by whether they may leave the building at all.
   *
   * `blocked` is not a filtering nicety. A swept plan composes cleanly and
   * cheerfully — see shareBlockedReason — and would send a rider to a door
   * with a COD figure against money nobody owes. The per-row Share button
   * already refuses those; the bulk path has to refuse the same rows or the
   * guard is one checkbox away from being bypassed.
   */
  const partitionSelected = useCallback(() => {
    const rows = filtered.filter((s) => selected.has(s.id));
    return {
      shareable: rows.filter((s) => shareBlockedReason(s) === null),
      blocked: rows.filter((s) => shareBlockedReason(s) !== null),
    };
  }, [filtered, selected]);

  const runBulk = async (action: SubBulkAction) => {
    const { shareable, blocked } = partitionSelected();

    // Say WHICH plans were held back rather than just how many — the
    // operator has to know who still needs a phone call.
    const heldBack = blocked.length
      ? ` Left out ${blocked
          .map((s) => formatSubscriptionNumber(s))
          .join(", ")} — payment was never completed.`
      : "";

    if (shareable.length === 0) {
      setNotice(
        blocked.length
          ? `Nothing to share.${heldBack}`
          : "Nothing to share.",
      );
      return;
    }

    // ONE run, not N messages: the run carries a single cash total at the
    // end and one route link, which is what makes it read as a delivery
    // round instead of a stack of receipts. Next delivery, not whole plan —
    // a rider is being sent to a door on a day, and the plan's cadence is
    // not information they can act on.
    const text = composeRun(shareable.map(composeNextDeliveryShareStop));

    setBulkRunning(true);
    try {
      if (action === "share") {
        const delivered = await deliverShareText(text, shareable.length, "plan");
        if (delivered.cleared) setSelected(new Set());
        setNotice(delivered.notice + heldBack);
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        setNotice(
          `Copied ${shareable.length} plan${shareable.length === 1 ? "" : "s"} to clipboard.${heldBack}`,
        );
      } catch {
        // Some browsers block clipboard writes outside a user gesture.
        // Fall back to the same delivery ladder Share uses — it never
        // truncates, which a bare wa.me link does.
        const delivered = await deliverShareText(text, shareable.length, "plan");
        setNotice(`Clipboard blocked. ${delivered.notice}${heldBack}`);
      }
    } finally {
      setBulkRunning(false);
    }
  };

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

    // Zones — in THIS menu, not a second dropdown beside it. They are a
    // fourth orthogonal group, exactly as on the orders board, and they ride
    // the same flat selection under ZONE_PREFIX so one control holds the
    // whole filter state. (`zoneOptions` decides which buckets are listed.)
    if (zoneOptions.length > 0) {
      opts.push(separator("__sep_zone", "Zones"));
      opts.push(...zoneOptions);
    }

    if (filter.length > 0) {
      opts.push({ value: CLEAR_ALL, label: "Clear all", action: true });
    }
    return opts;
  }, [statusValues, counts, selection, zoneOptions, filter.length]);

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
      // "All statuses" clears the STATUS group only, leaving payment, zone
      // and computed filters ticked — it is named "All statuses", not "All
      // rows".
      if (value === ALL_VALUE)
        return curr.filter(
          (v) =>
            v.startsWith(PAY_PREFIX) ||
            v.startsWith(ZONE_PREFIX) ||
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

      {selected.size > 0 ? (
        <BulkToolbar
          count={selected.size}
          actions={BULK_ACTIONS}
          running={bulkRunning}
          onClear={() => setSelected(new Set())}
          onAction={(a) => void runBulk(a)}
        />
      ) : null}

      {notice ? (
        <div
          role="status"
          style={{
            border: "1px solid rgba(251,243,212,0.45)",
            background: "rgba(251,243,212,0.07)",
            color: CREAM,
            padding: "0.7rem 1rem",
            marginBottom: "1rem",
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            letterSpacing: "0.03em",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <span style={{ flex: 1 }}>{notice}</span>
          {/* Dismissed by hand, not on a timer. It can name plans that were
              held back, and that is the one sentence the operator must not
              miss because they looked away. */}
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            style={{
              background: "transparent",
              border: "none",
              color: cream(0.7),
              cursor: "pointer",
              fontFamily: "var(--font-body)",
              fontSize: "1rem",
            }}
          >
            ✕
          </button>
        </div>
      ) : null}

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
            flexWrap: "wrap",
            gap: "6px 20px",
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
          {/* Loaf counts for the CURRENT filter, recomputed from the same
              `filtered` array the table below renders — so the numbers and
              the rows can never disagree.

              Counted off subscription_items via loaf_counts, NEVER off
              subscriptions.product_slug. All nine mixed plans on prod
              store the Multigrain name against their COMBINED quantity, so
              the legacy column would show Multigrain 31 / Plain 12 where
              the truth is 31 / 21.

              WITH A DATE SELECTED these become THAT DATE's stops, summed
              from loaf_counts_by_date instead of the whole-plan
              loaf_counts. A date-filtered board showing lifetime totals
              answered a question nobody had asked: on 23 Sep it read
              P 3 / M 22 / 25 loaves, which is what those four plans come to
              over their whole runs, when six loaves were going out. Both
              maps are bucketed by `scheduled_date ?? delivery_date`, the
              same precedence the day filter matches rows on. */}
          <CountMarkers lines={filteredLines} />
          <span style={{ marginLeft: "auto", color: cream(0.85) }}>
            {filtered.reduce(
              (n, s) => (isSubscriptionFulfilled(s) ? n + 1 : n),
              0,
            )}{" "}
            of {filtered.length} fulfilled
          </span>
          {/* WHAT THE NUMBERS COVER, on screen. A loaf total means nothing
              without its population, and this board's filters change that
              population constantly. Spelled out rather than left to be
              inferred from the chips. */}
          <span
            style={{
              flexBasis: "100%",
              color: cream(0.55),
              fontSize: 12,
            }}
          >
            {totalLoaves(filteredCounts)} loaves across {summary.subs}{" "}
            subscription{summary.subs === 1 ? "" : "s"}{" "}
            {dateScoped ? (
              <>
                delivering on {formatDate(day)} — that date&rsquo;s stops
                only, cancelled excluded. Not the whole plan.
              </>
            ) : (
              <>
                in this filter — every non-cancelled delivery, whole plan, not
                per week.
              </>
            )}
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
                <th style={{ ...th, width: 36 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all visible subscriptions"
                    checked={masterChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = !masterChecked && someSelected;
                    }}
                    onChange={toggleSelectAll}
                  />
                </th>
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
                // Two different totals, deliberately: the markers show the
                // scope the SUMMARY BAR is showing — whole plan normally,
                // that date's stops only when a delivery-date filter is on —
                // while the tooltip adds what goes in one bag. Showing only
                // the per-delivery figure is how a 5-week plan reads as 2
                // loaves.
                //
                // Read from countsBySub, NOT from s.loaf_counts directly.
                // The bar is the sum of these rows; if the row re-derived its
                // own number the two could disagree on the same screen, which
                // is exactly the bug that made the bar say 25 loaves on a day
                // with 5 to bake.
                const rowCounts =
                  countsBySub.get(s.id) ?? (new Map() as LoafCounts);
                const rowLines = countLines(rowCounts, nameHint);
                const perDelivery = longCountText(
                  countLines(countPlan(s), nameHint),
                );
                const rowCountTitle = [
                  rowLines.length > 0
                    ? `${longCountText(rowLines)} ${
                        dateScoped
                          ? `delivering on ${formatDate(day)}`
                          : "across all non-cancelled deliveries"
                      }`
                    : null,
                  perDelivery ? `${perDelivery} per delivery` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
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
                      // Stash scrollY so Back from the plan detail lands on
                      // this row, not the top of the board. Read and cleared
                      // by useScrollRestore above.
                      stashScrollY(SCROLL_KEY);
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
                    <td style={td} data-label="Select">
                      <input
                        type="checkbox"
                        aria-label={`Select subscription ${formatSubscriptionNumber(s)}`}
                        checked={selected.has(s.id)}
                        onChange={() => toggleSelect(s.id)}
                      />
                    </td>
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
                      {/* "plan", not "order" — this star counts standing
                          plans on this phone, and a tooltip saying "3rd
                          order" would be a claim about the orders board. */}
                      <RepeatStar
                        seq={repeatIndex.get(s.id)?.repeat_seq}
                        count={repeatIndex.get(s.id)?.customer_order_count}
                        firstAt={repeatIndex.get(s.id)?.customer_first_order_at}
                        noun="plan"
                      />
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
                      {/* Lifetime loaves for THIS plan, and which days it
                          goes out. The markers carry the whole-plan figure
                          because that is what the bar above totals; the
                          per-delivery figure is one hover away rather than
                          a second set of numbers competing with it. */}
                      <div
                        style={{
                          marginTop: 6,
                          display: "flex",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: "6px 14px",
                        }}
                        title={rowCountTitle}
                      >
                        <CountMarkers lines={rowLines} size={15} gap={8} />
                        <DayDotRow days={subscriptionDays(s)} />
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <ZoneBadge
                          zone={zoneOf.get(s.id)}
                          source={zoneResOf.get(s.id)?.source}
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = (
                              e.currentTarget as HTMLElement
                            ).getBoundingClientRect();
                            setAssignTarget({
                              subscriptionId: s.id,
                              anchorRect: rect,
                            });
                          }}
                        />
                      </div>
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
                          // The row's own onClick bails on anything matching
                          // ROW_INTERACTIVE_SELECTOR, which includes <a>, so
                          // this link has to stash for itself — otherwise
                          // Back from here lands on the top of the board while
                          // Back from a click on the row lands on the row.
                          onClick={() => stashScrollY(SCROLL_KEY)}
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
      {assignTarget
        ? (() => {
            const s = subs.find((x) => x.id === assignTarget.subscriptionId);
            const res = zoneResOf.get(assignTarget.subscriptionId);
            if (!s || !res) return null;
            const address = flattenSubscriptionAddress({
              customer_address: s.customer_address,
              delivery_address: s.delivery_address,
            });
            const ruleKey = pickRuleKey({
              address,
              pincode: s.customer_pincode ?? null,
            });
            const existingRule =
              ruleKey &&
              (res.source === "rule_pincode" || res.source === "rule_locality")
                ? ruleRows.find(
                    (r) =>
                      r.key_type === ruleKey.key_type &&
                      r.key_value === ruleKey.key_value,
                  ) ?? null
                : null;
            const existingOverride =
              res.source === "row_override"
                ? overrideRows.find((x) => x.subscription_id === s.id) ?? null
                : null;
            return (
              <ZoneAssignPopover
                open
                onClose={() => setAssignTarget(null)}
                currentZone={res.zone}
                resolution={res}
                target={{ kind: "subscription", id: s.id }}
                ruleKey={ruleKey}
                existingRuleId={existingRule?.id ?? null}
                existingOverrideId={existingOverride?.id ?? null}
                onChanged={loadRules}
                anchorRect={assignTarget.anchorRect}
              />
            );
          })()
        : null}
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
              {/* NOT `product_name × quantity_per_delivery`. On a mixed
                  plan that reads "Protein Bread — Multigrain × 2" when the
                  bag actually holds one Plain and one Multigrain — the row
                  stores the Multigrain name against the COMBINED quantity.
                  formatSubscriptionItems names every variant. */}
              {formatSubscriptionItems(subscription)}
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
          Updated · {formatUpdatedAt(delivery.status_updated_at)}
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

/** "17 Sep, 10:30 am", in IST. A real timestamp, unlike scheduled_date. */
function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const { day, month } = istDateParts(d);
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${day} ${MONTH_SHORT[month - 1]}, ${time}`;
}

/** "Thu, 17 Sep 2026". `scheduled_date` is an IST calendar date, so the
 *  weekday is taken from a UTC-constructed date and the month is spelled
 *  from MONTH_SHORT — Intl month:"short" renders September as "Sept". */
function formatScheduledDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return iso;
  const weekday = WEEKDAY_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${d} ${MONTH_SHORT[m - 1]} ${y}`;
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

/**
 * CSV export.
 *
 * The old `Product` / `Quantity per delivery` pair came straight off the
 * subscriptions row, and on a mixed plan that pair is not merely incomplete
 * — it is wrong. All nine multi-variant plans on prod store product_name =
 * "Protein Bread — Multigrain" while quantity_per_delivery holds the
 * COMBINED total, so a pivot on those two columns books every loaf to
 * Multigrain and shows Plain at zero. The grand total comes out right,
 * which is what made it survive.
 *
 * Replaced with: one readable `Items per delivery` string, then ONE NUMERIC
 * COLUMN PER PRODUCT so the export pivots correctly, then the combined
 * total under its own name. The per-product columns are derived from the
 * rows being exported, not hardcoded, so a third bread needs no code change
 * — and a slice with no subscriptions simply has no column.
 */
function exportSubsCsv(rows: AdminSubscriptionRow[]): void {
  const hint = nameHintFor(rows);
  const perRow = new Map<AdminSubscriptionRow, LoafCounts>();
  const union: LoafCounts = new Map();
  for (const s of rows) {
    const c = countPlan(s);
    perRow.set(s, c);
    addCounts(union, c);
  }

  // label → the keys rendering under it. Two keys CAN share a label: a
  // legacy row (none on prod today) is keyed by its full product_name
  // while an itemised row is keyed by slug, and both label as
  // "Multigrain". Summing them into one column keeps the pivot honest
  // instead of splitting one product across two headers.
  const keysByLabel = new Map<string, string[]>();
  for (const line of countLines(union, hint)) {
    const keys = keysByLabel.get(line.label) ?? [];
    keys.push(line.slug);
    keysByLabel.set(line.label, keys);
  }

  const productColumns = Array.from(keysByLabel.entries()).map(
    ([label, keys]) => ({
      header: `${label} per delivery`,
      value: (s: AdminSubscriptionRow) => {
        const counts = perRow.get(s);
        return keys.reduce((n, k) => n + (counts?.get(k) ?? 0), 0);
      },
    }),
  );

  const csv = toCsv(rows, [
    { header: "Subscription", value: (s) => formatSubscriptionNumber(s) },
    { header: "Subscription ID", value: (s) => s.id },
    { header: "Customer", value: (s) => s.customer?.full_name ?? "" },
    { header: "Phone", value: (s) => s.customer?.phone ?? "" },
    {
      header: "Items per delivery",
      value: (s) => longCountText(countLines(countPlan(s), hint)),
    },
    ...productColumns,
    {
      header: "Loaves per delivery",
      value: (s) => totalLoaves(countPlan(s)),
    },
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
