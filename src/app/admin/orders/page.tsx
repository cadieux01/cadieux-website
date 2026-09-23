"use client";

// Today's Orders — operational view used during dispatch hours.
//
// Reads /api/admin/orders (admin-token-gated GET) and lets the operator
// filter by status, search by customer name/phone, sort by status group
// (then newest-first) or by delivery_date, and run per-row PATCH actions
// that match the transitions /api/admin/orders/[id] accepts.
//
// Live columns surfaced (post the orders.delivery_date + items
// migration): delivery_date, delivery_slot, items jsonb. Rows that
// predate the migration (where these are null) fall back to created_at
// for the "Delivery" column and a single-line "—" for items.

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
import { AreaSortControl } from "@/components/admin/AreaSortControl";
import { DistanceBadge } from "@/components/admin/DistanceBadge";
import { EditOrderPanel } from "@/components/admin/EditOrderPanel";
import {
  ProductionCountStrip,
  type BakeSubscriptionStop,
} from "@/components/admin/ProductionCountStrip";
import { DayFilter } from "@/components/admin/DayFilter";
import { ContactActions } from "@/components/admin/ContactActions";
import { OrderLocationActions } from "@/components/admin/OrderLocationActions";
import {
  OrderShareButton,
  type ShareablePartner,
} from "@/components/admin/OrderShareButton";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { ZoneBadge } from "@/components/admin/ZoneBadge";
import { adminAuthHeaders, adminFetch, AdminFetchError } from "@/lib/admin-client";
import { csvFilename, downloadCsv, toCsv } from "@/lib/admin-csv";
import { itemQty, itemSlug } from "@/lib/order-items";
import {
  PRODUCT_NAMES,
  productDisplayName,
  productNameMap,
  type ProductNameMap,
} from "@/lib/product-names";
import {
  formatDate,
  formatDateTime,
  formatINR,
} from "@/lib/admin-formatting";
import {
  AdminOrderRow,
  ORDER_STATUSES,
  OrderFilterValue,
  OrderStatus,
  formatStatusLabel,
  orderStatusRank,
} from "@/lib/admin-shared";
import {
  sendCustomerEditSMS,
  sendOrderStatusSMS,
  sendOrderWhatsApp,
  toNotifyStatus,
} from "@/lib/admin-notify";
import Select from "@/components/ui/Select";
import MultiSelect from "@/components/ui/MultiSelect";
import {
  ALL_VALUE,
  CALL_PREFIX,
  REPEAT_ONLY,
  ZONE_PREFIX,
  decodeZoneParam,
  encodeZoneParam,
  matchesOrderFilter,
  splitFilterValues,
} from "@/lib/order-filter";
import { decodeStatusParam, encodeStatusParam } from "@/lib/filter-menu";
import {
  useScrollRestore,
  useUrlWriteback,
  stashScrollY,
} from "@/lib/admin-url-state";
import {
  EMPTY_RULE_SET,
  ZONE_KEYS,
  ZONE_LABELS,
  pickRuleKey,
  resolveZoneWithSource,
  type ZoneKey,
  type ZoneResolution,
  type ZoneRuleSet,
} from "@/lib/delivery-zones";
import {
  buildRuleSet,
  type ZoneRowOverrideRow,
  type ZoneRuleRow,
} from "@/lib/zone-rules";
import { fetchAllRules } from "@/lib/zone-rules-client";
import { ZoneAssignPopover } from "@/components/admin/ZoneAssignPopover";
import {
  DEFAULT_BASIS,
  matchesDay,
  orderDateForBasis,
  parseBasis,
  parseDayParam,
  type DateBasis,
} from "@/lib/day-filter";
import { RepeatStar } from "@/components/admin/RepeatStar";
import { BulkToolbar, type BulkActionSpec } from "@/components/admin/BulkToolbar";
import { useStoredSelection } from "@/lib/admin-selection";
import { RetentionPanel } from "@/components/admin/RetentionPanel";
import type { RetentionSummary } from "@/lib/customer-history";
import {
  distanceFrom,
  orderLocation,
  parseAnchorParams,
  sortByDistanceFromAnchor,
  writeAnchorParams,
  type DistanceInfo,
  type ResolvedArea,
} from "@/lib/distance-sort";
import { usePincodeCoords } from "@/lib/use-pincode-coords";
import { formatOrderNumber } from "@/lib/order-number";
import { isOrderFulfilled } from "@/lib/order-fulfillment";
import { FulfilledTick } from "@/components/admin/FulfilledTick";
import { composeShareRun, isShareable } from "@/lib/order-share-message";
import { deliverShareText } from "@/lib/share-delivery";
import { CALL_PRESETS } from "@/lib/admin-call-updates";
import { LastNoteChip } from "@/components/admin/LastNoteChip";
import { matchesAdminQuery } from "@/lib/admin-search";
import { LoafDots } from "@/components/admin/LoafDots";
import { formatSlotForDisplay } from "@/lib/delivery-slots";
import { NoteIconButton } from "@/components/admin/NoteIconButton";
import { NotePanel } from "@/components/admin/NotePanel";
import { ensureAdminFirstName } from "@/lib/admin-first-name";

type SortKey = "created_desc" | "delivery_asc" | "nearest_from_area";

/** A subscription stop with its zone resolved once, so the per-zone strips
 *  can be fed the same way the per-zone order slices are. Resolved here and
 *  not on the server because zone is derived, never stored — the one
 *  resolver in delivery-zones.ts is the only thing allowed to decide it. */
type ZonedBakeStop = BakeSubscriptionStop & { zone: ZoneKey };

// The date filter is ONE DAY on ONE COLUMN, and all of its semantics —
// DateBasis, DEFAULT_BASIS, orderDateForBasis, matchesDay — are imported
// from @/lib/day-filter rather than declared here. The packing list at
// /admin/orders/print and the subscriptions board import the same module,
// so a sheet that walks into the kitchen cannot be cut on a different
// axis or a different day than the screen it was printed from.
const DEFAULT_SORT: SortKey = "created_desc";

const SORT_KEYS: readonly SortKey[] = [
  "created_desc",
  "delivery_asc",
  "nearest_from_area",
];

// ── URL state ──────────────────────────────────────────────────────────────
// Everything the operator can touch on this page rides in the query
// string. Reason (verified live): opening an order and clicking "Back
// to orders" was resetting the filter, the sort, the range, and the
// scroll position — Sunny had to re-narrow to Pending every time. With
// state in the URL, router.back() from the detail page returns to the
// exact same slice, and the scroll restoration below returns to the
// same row.
//
// Empty / default values are OMITTED from the URL so a plain
// /admin/orders link stays clean. The parser is the sole source of
// truth for defaults, so /admin/orders and /admin/orders?basis=delivery
// resolve identically.

type UrlInitial = {
  filter: string[];
  query: string;
  sort: SortKey;
  basis: DateBasis;
  /** The selected day, or null for "all dates". */
  day: string | null;
  anchor: ResolvedArea | null;
};

function parseUrlInitial(sp: URLSearchParams): UrlInitial {
  // Statuses ride a comma-separated `status` param (back-compat with
  // /admin/orders/print's existing link). Call updates ride REPEATED
  // `call` params because their bodies are operator-typed and could
  // contain commas.
  const statuses = decodeStatusParam(sp.get("status"));
  const calls = sp.getAll("call").filter((c) => c.length > 0);
  // Zones live on their own `zone` param, comma-separated. Kept off the
  // `status` param so a link that scopes to a zone reads plainly and one
  // group can be changed without touching the other.
  const zones = decodeZoneParam(sp.get("zone"));
  // "Repeat customers only" is a single flag, so it rides its own `repeat=1`
  // param rather than being smuggled into `status`. Same spelling the print
  // link uses, so one encoding serves the screen, the URL and the sheet.
  const filter = [
    ...statuses,
    ...calls.map((c) => `${CALL_PREFIX}${c}`),
    ...zones.map((z) => `${ZONE_PREFIX}${z}`),
    ...(sp.get("repeat") === "1" ? [REPEAT_ONLY] : []),
  ];

  const query = sp.get("q") ?? "";

  const sortRaw = sp.get("sort");
  const sort: SortKey =
    sortRaw && (SORT_KEYS as readonly string[]).includes(sortRaw)
      ? (sortRaw as SortKey)
      : DEFAULT_SORT;

  const basis: DateBasis = parseBasis(sp.get("basis"));

  // One param, one day. A malformed or absent `date` means no day filter
  // at all — every row. It deliberately does NOT fall back to "today":
  // a link that quietly re-aims itself at a different day than the one it
  // names is the drift this filter exists to end.
  const day = parseDayParam(sp.get("date"));

  // Area anchor — same four params, same all-or-nothing rule, as
  // /admin/subscriptions. See parseAnchorParams.
  const anchor = parseAnchorParams(sp);

  return {
    filter,
    query,
    sort,
    basis,
    day,
    anchor,
  };
}

function stateToSearch(s: {
  filter: string[];
  query: string;
  sort: SortKey;
  basis: DateBasis;
  day: string | null;
  anchor: ResolvedArea | null;
}): string {
  const params = new URLSearchParams();
  const { statuses, calls, zones, repeatOnly } = splitFilterValues(s.filter);
  if (statuses.length > 0) params.set("status", encodeStatusParam(statuses));
  for (const c of calls) params.append("call", c);
  if (zones.length > 0) params.set("zone", encodeZoneParam(zones));
  if (repeatOnly) params.set("repeat", "1");
  if (s.query.trim()) params.set("q", s.query);
  if (s.sort !== DEFAULT_SORT) params.set("sort", s.sort);
  if (s.basis !== DEFAULT_BASIS) params.set("basis", s.basis);
  if (s.day) params.set("date", s.day);
  writeAnchorParams(params, s.anchor);
  return params.toString();
}

// ── scroll restoration ────────────────────────────────────────────────────
// Simple session-storage handoff. Set on row click, read on mount, then
// cleared. Because it is only ever set immediately before navigating to
// a detail page, a fresh visit to /admin/orders (or a hard reload) sees
// no entry and starts at the top — no accidental scroll to a stale row.
const SCROLL_KEY = "admin:orders:scrollY";

// Unlike SCROLL_KEY, the selection bucket is a mirror rather than a one-shot
// handoff — it is rewritten on every change, so Clear and the bulk handlers
// empty it without any extra bookkeeping. See @/lib/admin-selection.
const SELECTION_KEY = "admin:orders:selection";

/**
 * The Status dropdown, in operator order.
 *
 * INVARIANT: the counts on the visible options must sum to the count on
 * "All statuses". Every entry below is a distinct stored `orders.status`
 * value, so the buckets partition the rows exactly — no row is counted
 * twice and none is left without an option. If you add an entry here,
 * check it still holds.
 *
 * It held in neither direction before, and the dropdown was under-reporting
 * the month by 40 orders (116 listed against 156 in "All statuses"):
 *
 *   • `pending` was MISSING. It is what the website writes on COD checkout
 *     and the biggest live bucket after `delivered` — all 40 of the missing
 *     rows. Unreachable from this dropdown, so unworkable from this page.
 *   • `expired` is NOT a stored status. It is computed on read
 *     (computeOrderState; src/lib/order-state.ts) from rows that are ALSO
 *     counted under `pending`/`placed`, so it double-counts by construction.
 *     It happened to read 0 this month only because no pending order was
 *     older than the 7-day window; over a wider range it would have pushed
 *     the visible total PAST "All statuses". Do not put a computed state in
 *     this list.
 *   • `pending_payment` and `picked_up` are dead — zero rows have ever
 *     carried either. They are still valid filter values (see
 *     ORDER_FILTER_VALUES) and the print view still accepts them off a URL;
 *     they are just not worth a line in the menu.
 */
/** Menu command, not a filter value — never enters the selection. */
const CLEAR_ALL = "__clear_all";

const STATUS_FILTER_OPTIONS: readonly OrderFilterValue[] = [
  "all",
  "pending",
  "placed",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "ready_for_pickup",
];

const NEXT_STATUS_DELIVERY: Record<string, OrderStatus | null> = {
  pending_payment: "confirmed",
  placed: "confirmed",
  confirmed: "preparing",
  preparing: "out_for_delivery",
  out_for_delivery: "delivered",
  delivered: null,
  cancelled: null,
  // legacy aliases — handled so historic rows still get a sane "next"
  pending: "confirmed",
  dispatched: "delivered",
};

// Pickup skips preparing + out_for_delivery. The stall side goes:
// placed → confirmed → ready_for_pickup → picked_up.
const NEXT_STATUS_PICKUP: Record<string, OrderStatus | null> = {
  pending_payment: "confirmed",
  placed: "confirmed",
  confirmed: "ready_for_pickup",
  ready_for_pickup: "picked_up",
  picked_up: null,
  cancelled: null,
  pending: "confirmed",
};

/** Returns the next status this order should transition to, or null if it's
 *  already at a terminal stage. Branches on fulfillment_type; legacy rows
 *  with no value are treated as delivery. */
function nextStatusFor(order: AdminOrderRow): OrderStatus | null {
  const key = (order.status ?? "").toLowerCase();
  const map =
    order.fulfillment_type === "pickup"
      ? NEXT_STATUS_PICKUP
      : NEXT_STATUS_DELIVERY;
  return map[key] ?? null;
}

// Bulk actions on /admin/orders. Status transitions were retired at
// Sunny's request in favour of the two 5am operations that actually
// benefit from a multi-select: batching one WhatsApp handoff message
// for a whole delivery run, and copying the same block for a paste
// elsewhere. The per-row status Select still exists — status changes
// were never actually batched, just shortcut, and one row at a time
// is honest.
type BulkAction = "share" | "copy" | "cancel";

type BulkResult = {
  succeeded: string[];
  failed: { id: string; error: string }[];
  action: BulkAction;
};

// Suspense wrapper required by Next.js prerender for any client page
// that reads useSearchParams() — parseUrlInitial does, so the boundary
// lives at the page export.
export default function OrdersPage() {
  return (
    <Suspense fallback={<AdminLoading />}>
      <OrdersPageInner />
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
// `[role="option"]`/`[role="combobox"]` cover the custom Select widget.
const ROW_INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, label, [role="button"], [role="combobox"], [role="listbox"], [role="option"]';

function OrdersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Parse the URL ONCE on first render. useSearchParams() subscribes,
  // so re-parsing it every render would let our own writeback below
  // re-seed initial state on the very next tick. useMemo with an empty
  // dep array pins the initial slice.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const urlInit = useMemo(
    () => parseUrlInitial(new URLSearchParams(searchParams?.toString() ?? "")),
    [],
  );
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  // All-time retention, computed by the list endpoint. Deliberately NOT
  // scoped to the date range or the filters — "how many customers ever
  // came back" is a fixed number, not a property of the current view.
  const [retention, setRetention] = useState<RetentionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Multi-select. Holds status keys ("confirmed"), the legacy "expired"
  // value and call-update filters encoded as "call:<body>", mixed in one
  // flat list; splitFilterValues sorts them into their two groups.
  //
  // EMPTY MEANS "ALL STATUSES". There is no "all" member — representing it
  // as a value would create two encodings of the same state ([] and ["all"])
  // that could disagree. The menu still shows an "All statuses" row; it is
  // rendered ticked when the status group is empty.
  const [filter, setFilter] = useState<string[]>(urlInit.filter);
  const {
    statuses: statusSel,
    calls: callSel,
    zones: zoneSel,
    repeatOnly,
  } = useMemo(() => splitFilterValues(filter), [filter]);
  // Owner of the currently-open NotePanel (order id + display label).
  // null = panel closed.
  const [noteOwner, setNoteOwner] = useState<
    | { kind: "order"; id: string; label: string }
    | null
  >(null);
  // Row id currently posting a call-preset (dropdown disables while
  // in-flight so a fast double-click can't stack two rows).
  const [callBusyId, setCallBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState(urlInit.query);
  const [sort, setSort] = useState<SortKey>(urlInit.sort);
  const [basis, setBasis] = useState<DateBasis>(urlInit.basis);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 'bread' (default) | 'sandwich' — order_kind tab. Every legacy row
  // is 'bread' at the DB default, so the initial view is unchanged.
  // Sandwich rows only appear once the kitchen is opened.
  const [kindTab, setKindTab] = useState<"bread" | "sandwich">("bread");
  const [selected, setSelected] = useStoredSelection(SELECTION_KEY);
  const [pendingBulk, setPendingBulk] = useState<BulkAction | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  // The whole of the date filter: one day, or null for every row. There is
  // no second representation of it to keep in sync — that is the point.
  const [day, setDay] = useState<string | null>(urlInit.day);

  // "Nearest from typed area" sort — see AreaSortControl. anchor is null
  // until the operator matches an area; pincodeCoords powers the fallback
  // for orders that lack GPS but carry a pincode in delivery_address.
  const [anchor, setAnchor] = useState<ResolvedArea | null>(urlInit.anchor);
  const pincodeCoords = usePincodeCoords();

  // Changing a status must update the row where it sits, not teleport it.
  // Without this, flipping Pending → Preparing moves the row from group 1
  // to group 3 mid-click and the operator loses their place. We freeze the
  // row's sort rank at the value it had before the edit; pins are dropped
  // on an explicit Refresh or when the filter / sort / range changes, so
  // the grouping re-asserts itself the next time the operator asks for it.
  const [rankPins, setRankPins] = useState<Map<string, number>>(
    () => new Map(),
  );
  const clearRankPins = useCallback(() => {
    setRankPins((curr) => (curr.size === 0 ? curr : new Map()));
  }, []);

  /** Selecting or clearing the day. Pins are dropped for the same reason
   *  a filter or sort change drops them: the rows underneath are about to
   *  be a different set, so a frozen rank has nothing left to freeze. */
  const applyDay = useCallback(
    (next: string | null) => {
      clearRankPins();
      setDay(next);
    },
    [clearRankPins],
  );

  // Delivery partners power the per-row "Share" button. Fetched once on
  // mount (never polled — the list changes only when the operator edits
  // /admin/delivery-partners) and passed down to every OrderShareButton.
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

  // Popover state — the ZoneAssignPopover that opens on a badge click.
  // Null when closed. `anchorRect` is captured at click time so the popover
  // can position itself even after the row scrolls; on re-open we recompute.
  const [assignTarget, setAssignTarget] = useState<{
    orderId: string;
    anchorRect: DOMRect;
  } | null>(null);

  // Zone rules — the learned overrides Sunny writes from the badge. Fetched
  // once on mount and reloaded whenever the popover writes. NOT polled: rule
  // changes are operator-driven and single-writer, so polling every 10s
  // would be pure noise.
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
      // A rules-load failure must not blank the board — the resolver falls
      // back to the built-in map, same as if no rules existed. The next
      // successful fetch heals it.
    }
  }, []);
  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  // Subscription stops due on the selected day — the other half of the
  // bake. See ProductionCountStrip: the strip counted only one-time orders,
  // so the number on screen at 5am was below the number in the 18:00
  // bake-plan email for the same day.
  //
  // ONLY ON A SINGLE DELIVERY DAY. With no day chosen there is no honest
  // subscription figure to show (every future stop of every live plan is
  // not a bake list), and on the `order` basis the day means "when it was
  // PLACED", which says nothing about when a plan delivers. In both cases
  // the list stays empty and the strip silently reverts to its old
  // orders-only shape rather than printing a number it cannot stand behind.
  //
  // Zone resolution here uses the SAME resolveZoneWithSource + zoneRules
  // as the order rows on this page. If it used the built-in-map-only
  // resolveZone(), a subscription stop and a one-time order on the same
  // day at the same address could land in different zones — the exact
  // "one row, two zones" failure the rules panel was built to prevent.
  const [subStops, setSubStops] = useState<ZonedBakeStop[]>([]);

  // Catalogue names, slug → name, live from public.products.
  //
  // Every product label on this board (dots tooltip, bake strip, CSV
  // headers) resolves through this rather than printing the `name` stored
  // on the order line. Those stored names are snapshots of what the
  // customer bought and are never rewritten, so after a rename the board
  // would go on naming a product the shop no longer sells.
  //
  // Reuses the availability feed, which already returns { id, name } for
  // every product and is already admin-gated — `products.id` and
  // `products.slug` hold the same text. Failure is silent and harmless:
  // productDisplayName falls back to the bundled catalogue, which is one
  // deploy behind at worst.
  const [productNames, setProductNames] = useState<ProductNameMap>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch<{
          products: { id: string; name: string }[];
        }>("/api/admin/products/availability");
        if (!cancelled) setProductNames(productNameMap(res.products));
      } catch {
        // Bundled fallback stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (basis !== "delivery" || !day) {
      setSubStops([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch<{
          deliveries: (BakeSubscriptionStop & {
            address: string;
            pincode: string | null;
          })[];
        }>(`/api/admin/bake-plan?date=${encodeURIComponent(day)}`);
        if (cancelled) return;
        setSubStops(
          (res.deliveries ?? []).map((d) => ({
            ref: d.ref,
            items: d.items,
            paid: d.paid,
            zone: resolveZoneWithSource(
              { address: d.address, pincode: d.pincode },
              zoneRules,
            ).zone,
          })),
        );
      } catch {
        // A failed leg must not blank the strip's order counts, which are
        // correct and locally computed. Drop to empty — the same state as
        // "no day selected" — rather than showing a partial sum.
        if (!cancelled) setSubStops([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [basis, day, zoneRules]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await adminFetch<{
        orders: AdminOrderRow[];
        retention?: RetentionSummary;
      }>("/api/admin/orders");
      setOrders(res.orders ?? []);
      setRetention(res.retention ?? null);
    } catch (e) {
      if (e instanceof AdminFetchError) setError(e.message);
      else if (e instanceof Error) setError(e.message);
      else setError("Could not load orders.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    clearRankPins();
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load, clearRankPins]);

  useEffect(() => {
    void load();
  }, [load]);

  // 10s polling — matches the legacy admin dashboard cadence. We keep
  // this lightweight: the same /api/admin/orders endpoint is hit every
  // tick (it's a small payload and the admin is one user). Cleared on
  // unmount.
  useEffect(() => {
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  // URL writeback + scroll restoration, both shared with
  // /admin/subscriptions. stateToSearch stays here because the params are
  // this board's own; everything downstream of the string is identical on
  // both boards and lives in admin-url-state.
  useUrlWriteback(
    "/admin/orders",
    stateToSearch({ filter, query, sort, basis, day, anchor }),
  );
  useScrollRestore(SCROLL_KEY, !loading);

  const [editing, setEditing] = useState<AdminOrderRow | null>(null);
  const [orderEditing, setOrderEditing] = useState<AdminOrderRow | null>(null);
  const [scheduling, setScheduling] = useState<AdminOrderRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const showNotice = useCallback((m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(null), 4000);
  }, []);

  const rankOf = useCallback(
    (o: AdminOrderRow) => rankPins.get(o.id) ?? orderStatusRank(o),
    [rankPins],
  );

  // Resolve zone once per row. Zone is derived from the address at read
  // time — no column, no migration (see src/lib/delivery-zones.ts). The
  // map keys on order id so the same lookup serves the filter, the counts,
  // the badge on the row and the bake-strip split.
  // Full resolution per row — the zone AND the ladder step that produced
  // it. Kept in a parallel map so the ZoneBadge can render a provenance dot
  // for row-overrides and learned rules, and the popover can decide RULE
  // mode vs ROW-PIN mode from the same resolution.
  const zoneResOf = useMemo(() => {
    const m = new Map<string, ZoneResolution>();
    for (const o of orders) {
      m.set(
        o.id,
        resolveZoneWithSource(
          {
            address: o.delivery_address,
            isPickup: o.fulfillment_type === "pickup",
            orderId: o.id,
          },
          zoneRules,
        ),
      );
    }
    return m;
  }, [orders, zoneRules]);
  const zoneOf = useMemo(() => {
    const m = new Map<string, ZoneKey>();
    zoneResOf.forEach((r, id) => m.set(id, r.zone));
    return m;
  }, [zoneResOf]);

  const filtered = useMemo(() => {
    const rows = orders.filter((o) => {
      // Bread / Sandwiches tab. NULL is grandfathered as 'bread' — every
      // row predating the sandwich migration lacks the column and must
      // still show up under Bread.
      const kind = (o.order_kind ?? "bread") as "bread" | "sandwich";
      if (kind !== kindTab) return false;
      if (!matchesDay(orderDateForBasis(o, basis), day)) return false;
      // Statuses OR'd, call updates OR'd, zones OR'd, the groups AND'd.
      // Shared with the print view so the packing list can't disagree with
      // the screen it was printed from — see src/lib/order-filter.ts.
      const withZone = { ...o, zone: zoneOf.get(o.id) };
      if (!matchesOrderFilter(withZone, statusSel, callSel, repeatOnly, zoneSel))
        return false;
      // Name, phone and BOTH references. The customer knows public_ref
      // ("CX-7K4M2P"); order_number ("OLF43", legacy "CDX-00006") is what
      // is on the bag. Shared with the subscriptions board so one typed
      // phone number behaves the same on either — see admin-search.ts.
      return matchesAdminQuery(query, [
        o.customers?.full_name,
        o.customers?.phone,
        o.public_ref,
        o.order_number,
      ]);
    });

    // Distance sort — nearest first, "no location" grouped last. Runs
    // over the SAME filtered set as the other sorts so the strip totals
    // never diverge from the table. Anchor coordinates come from the
    // typed area, distance falls back to pincode centroid when the
    // order lacks GPS.
    if (sort === "nearest_from_area" && anchor) {
      // sortByDistanceFromAnchor attaches a `distance` field. We strip
      // it so `filtered` stays typed as AdminOrderRow[]; the row-level
      // badge recomputes it cheaply from the same anchor/coords.
      const sorted = sortByDistanceFromAnchor(
        rows,
        anchor,
        pincodeCoords,
        orderLocation,
      );
      return sorted.map((r) => {
        const copy: AdminOrderRow & { distance?: DistanceInfo } = { ...r };
        delete copy.distance;
        return copy as AdminOrderRow;
      });
    }

    return rows.sort((a, b) => {
        if (sort === "delivery_asc") {
          // Packing list — stays in pure delivery order. Status grouping is
          // deliberately NOT applied here; it would break the run order.
          // delivery_date is YYYY-MM-DD (lex-sortable). Rows that
          // predate the migration fall back to created_at so they
          // still appear at a stable position in the queue.
          const aKey = a.delivery_date ?? a.created_at.slice(0, 10);
          const bKey = b.delivery_date ?? b.created_at.slice(0, 10);
          const cmp = aKey.localeCompare(bKey);
          if (cmp !== 0) return cmp;
          // Tie-break by slot then created_at so packing groups stay
          // contiguous within a day.
          const aSlot = a.delivery_slot ?? "";
          const bSlot = b.delivery_slot ?? "";
          const slotCmp = aSlot.localeCompare(bSlot);
          if (slotCmp !== 0) return slotCmp;
          return a.created_at.localeCompare(b.created_at);
        }
        // "Newest first" = status group first, newest-first inside each
        // group, so delivered and cancelled orders stop pushing live work
        // down the page. Display only — no status is written. See
        // orderStatusRank in lib/admin-shared for the group order. A pinned
        // rank keeps a just-edited row in place (see rankPins).
        const rankCmp = rankOf(a) - rankOf(b);
        if (rankCmp !== 0) return rankCmp;
        return b.created_at.localeCompare(a.created_at);
      });
  }, [orders, statusSel, callSel, zoneSel, repeatOnly, query, sort, day, rankOf, anchor, pincodeCoords, basis, zoneOf, kindTab]);

  // A restored id is only meaningful if the row is still there — an order
  // can have been cancelled, or the filters can have moved on, while the
  // operator was away. Prune ONCE, against the first loaded list, and
  // never again: narrowing the filter afterwards must not silently drop
  // selections made under a different filter, which is the same property
  // toggleSelectAll already goes out of its way to preserve. Declared
  // after `filtered` because the dependency array is evaluated during
  // render, where an earlier reference would hit the TDZ.
  const selectionPruned = useRef(false);
  useEffect(() => {
    if (selectionPruned.current || loading) return;
    selectionPruned.current = true;
    setSelected((curr) => {
      if (curr.size === 0) return curr;
      const live = new Set(filtered.map((o) => o.id));
      const next = new Set(Array.from(curr).filter((id) => live.has(id)));
      return next.size === curr.size ? curr : next;
    });
  }, [loading, filtered]);

  // Counts are scoped to the selected day so the numbers in the
  // Status dropdown match the rows the operator is actually looking at.
  const counts = useMemo(() => {
    const onDay = orders.filter((o) =>
      matchesDay(orderDateForBasis(o, basis), day),
    );
    const c: Record<string, number> = { all: onDay.length };
    for (const o of onDay) {
      const k = (o.status ?? "").toLowerCase();
      c[k] = (c[k] ?? 0) + 1;
      if ((o.repeat_seq ?? 0) >= 2) c.repeat = (c.repeat ?? 0) + 1;
      const z = zoneOf.get(o.id);
      if (z) c[`zone_${z}`] = (c[`zone_${z}`] ?? 0) + 1;
    }
    return c;
  }, [orders, day, basis, zoneOf]);

  // Invariant we assert only in dev: the six zone bucket counts must sum
  // to the total on-day rows. If a zone gets added or a resolver bug
  // over- or under-counts, this fires in local dev while it is cheap to
  // fix, and stays out of the way in production. Do NOT throw here — an
  // admin board that crashes because ONE row went unzoned is much worse
  // than a badge that says "Unzoned".
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const sum = ZONE_KEYS.reduce(
      (n, k) => n + (counts[`zone_${k}`] ?? 0),
      0,
    );
    if (sum !== (counts.all ?? 0)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[zones] invariant broken: zone sum ${sum} !== on-day ${counts.all}`,
      );
    }
  }, [counts]);

  // Distinct call-note bodies + occurrence count across the same
  // day-scoped slice. Powers the "Call updates" group in the filter
  // dropdown; the label the operator sees is the exact note body.
  const callBodies = useMemo(() => {
    const onDay = orders.filter((o) =>
      matchesDay(orderDateForBasis(o, basis), day),
    );
    const tally = new Map<string, number>();
    for (const o of onDay) {
      const b = o.last_call_note?.body;
      if (!b) continue;
      tally.set(b, (tally.get(b) ?? 0) + 1);
    }
    return Array.from(tally.entries())
      .map(([body, count]) => ({ body, count }))
      .sort((a, b) => b.count - a.count);
  }, [orders, day, basis]);

  // Data-derived option list for the status filter. Iterates the
  // preferred ordering in STATUS_FILTER_OPTIONS (which already omits
  // `pending_payment`, `picked_up` and `expired` per Sunny's call),
  // then hides zero-count buckets — except the active filter, which is
  // always kept so widening the date range never leaves the Select
  // pointing at a value not in its own list. Call-update presets are
  // appended as their own group under a disabled separator so the
  // operator can jump straight to rows tagged with a given call outcome.
  const filterOptions = useMemo(() => {
    const opts: Array<{
      value: string;
      label: string;
      disabled?: boolean;
      action?: boolean;
    }> = [];
    for (const v of STATUS_FILTER_OPTIONS) {
      // A TICKED option always stays listed, even at zero, or narrowing the
      // date range would hide the very filter that is suppressing the rows —
      // the operator would see an empty table and no way to tell why.
      if (v === ALL_VALUE || statusSel.includes(v) || (counts[v] ?? 0) > 0) {
        const label = v === ALL_VALUE ? "All statuses" : formatStatusLabel(v);
        opts.push({ value: v, label: `${label} (${counts[v] ?? 0})` });
      }
    }
    // Same rule for call updates, but they are data-derived rather than from a
    // fixed list: a ticked body whose rows have all left the range is absent
    // from callBodies entirely, so it has to be re-added at zero.
    const tallied = new Map(callBodies.map((c) => [c.body, c.count]));
    for (const body of callSel) {
      if (!tallied.has(body)) tallied.set(body, 0);
    }
    if (tallied.size > 0) {
      opts.push({
        value: "__sep_call",
        label: "── Call updates ──",
        disabled: true,
      });
      // callBodies is already sorted by count desc; keep that order and put
      // any re-added zero-count bodies at the end.
      const ordered = [
        ...callBodies.map((c) => c.body),
        ...callSel.filter((b) => !callBodies.some((c) => c.body === b)),
      ];
      for (const body of ordered) {
        opts.push({
          value: `${CALL_PREFIX}${body}`,
          label: `${body} (${tallied.get(body) ?? 0})`,
        });
      }
    }
    // Zones — its own group, AND'd with the rest. Fixed order (Zone 1..4,
    // Unzoned, Pickup). "Unzoned" and "Pickup" ARE ALWAYS LISTED, even at
    // zero, because they are honest buckets — an unzoned row must be
    // findable, and pickup must not disappear from the menu on a day with
    // only deliveries. The four numbered zones hide at zero UNLESS they are
    // ticked (same rule the status group uses), so a wide day-range does
    // not print every zone the customer base has ever visited.
    opts.push({
      value: "__sep_zone",
      label: "── Zones ──",
      disabled: true,
    });
    for (const zk of ZONE_KEYS) {
      const zc = counts[`zone_${zk}`] ?? 0;
      const alwaysShow = zk === "unzoned" || zk === "pickup";
      const ticked = zoneSel.includes(zk);
      if (!alwaysShow && !ticked && zc === 0) continue;
      opts.push({
        value: `${ZONE_PREFIX}${zk}`,
        label: `${ZONE_LABELS[zk]} (${zc})`,
      });
    }
    // Repeat customers — its own one-entry group, AND'd with the rest.
    // Always listed (unlike the data-derived call bodies) so "how many of
    // these are returning customers?" is answerable even when the answer
    // is zero.
    opts.push({
      value: "__sep_repeat",
      label: "── Customers ──",
      disabled: true,
    });
    opts.push({
      value: REPEAT_ONLY,
      label: `Repeat customers only (${counts.repeat ?? 0})`,
    });
    // Escape hatch. "All statuses" deliberately clears only its own group
    // (see toggleFilter), so with a call update ticked there would otherwise
    // be no single click that gets back to an unfiltered table. Only shown
    // when there is something to clear.
    if (filter.length > 0) {
      opts.push({ value: CLEAR_ALL, label: "Clear all", action: true });
    }
    return opts;
  }, [counts, callBodies, statusSel, callSel, zoneSel, filter.length]);

  // Trigger label. One selected → "Pending (27)". Two or more → name the
  // first and count the rest → "Pending +2 (43)".
  //
  // HARD INVARIANT: the bracketed number is the LIVE ROW COUNT — exactly what
  // the table below is showing, in every combination, no exceptions. It is
  // NOT the sum of the ticked options' counts. The sum only equals the row
  // count when the selection is pure-status; tick a call update as well and
  // the two groups AND, so the sum becomes an upper bound (153 against 16
  // rows in one run). A number in the filter that disagrees with the list
  // underneath it is worse than no number at all.
  //
  // The per-option counts in the menu are untouched: those are per-bucket
  // totals and remain honest as bucket totals. Note the row count also
  // reflects the search box and the date range, which is the point — it is a
  // count of what is on screen, not of what the filter alone would allow.
  const filterLabel = useMemo(() => {
    const picked = filterOptions.filter(
      (o) => !o.disabled && !o.action && filter.includes(o.value),
    );
    const total = filtered.length;
    if (picked.length === 0) return `All statuses (${total})`;
    // Strip the option's own "(n)" — the label carries the live one.
    const head = picked[0].label.replace(/\s*\(\d+\)\s*$/, "");
    const rest = picked.length - 1;
    return rest === 0 ? `${head} (${total})` : `${head} +${rest} (${total})`;
  }, [filterOptions, filter, filtered.length]);

  // Toggle rules:
  //   • "All statuses" clears the STATUS group only. It is named "All
  //     statuses", it sits above the "Call updates" separator, and the
  //     whole point of the feature is combining the two groups — so
  //     widening the statuses must not silently drop a call filter.
  //   • "Clear all" resets BOTH groups — the one click back to an
  //     unfiltered table.
  //   • Unticking the last status leaves the group empty, which already
  //     means "all". No special case needed, and none is wanted: a special
  //     case would give "all" a second encoding.
  const toggleFilter = useCallback((value: string) => {
    if (
      value === "__sep_call" ||
      value === "__sep_repeat" ||
      value === "__sep_zone"
    )
      return;
    clearRankPins();
    setFilter((curr) => {
      if (value === CLEAR_ALL) return [];
      if (value === ALL_VALUE)
        return curr.filter((v) => v.startsWith(CALL_PREFIX) || v === REPEAT_ONLY);
      return curr.includes(value)
        ? curr.filter((v) => v !== value)
        : [...curr, value];
    });
  }, [clearRankPins]);

  // What the menu shows as ticked: the raw selection, plus "All statuses"
  // when the status group is empty.
  const tickedValues = useMemo(
    () => (statusSel.length === 0 ? [...filter, ALL_VALUE] : filter),
    [filter, statusSel],
  );

  const advance = async (order: AdminOrderRow) => {
    const next = nextStatusFor(order);
    if (!next) return;
    await patchStatus(order, next);
  };

  const toggleSelect = (id: string) => {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const masterChecked =
    filtered.length > 0 && filtered.every((o) => selected.has(o.id));
  const someSelected = filtered.some((o) => selected.has(o.id));

  const toggleSelectAll = () => {
    setSelected((curr) => {
      if (masterChecked) {
        // Clear only the currently-visible ids so selections on other
        // filters aren't lost when the operator toggles.
        const next = new Set(curr);
        for (const o of filtered) next.delete(o.id);
        return next;
      }
      const next = new Set(curr);
      for (const o of filtered) next.add(o.id);
      return next;
    });
  };

  // Selected orders in the ORDER THE TABLE IS CURRENTLY SORTED IN.
  // Iterating `filtered` and filtering by membership in `selected` is
  // deliberate: sorting by "nearest from area" makes the concatenated
  // share message read as a delivery run, and picking up the ids from
  // the Set would lose that order.
  const selectedInSortOrder = useCallback(
    () => filtered.filter((o) => selected.has(o.id)),
    [filtered, selected],
  );

  // Build one WhatsApp handoff block for all selected orders, in the
  // current sort order, using the same composer as the per-row Share
  // button (see @/lib/order-share-message.ts). Two blank lines between
  // orders — one \n splits the receipt lines inside an order, so the
  // separator has to be visibly heavier than that.
  const buildBulkShareText = useCallback(() => {
    const rows = selectedInSortOrder();
    // composeShareRun, not composeShareMessage per row: the run needs ONE
    // cash total at the end (composeShareMessage appends its own, being a
    // run of one) and ONE route link instead of a pin per stop.
    return composeShareRun(rows, zoneRules);
  }, [selectedInSortOrder, zoneRules]);

  const runBulk = async (action: BulkAction) => {
    const rows = selectedInSortOrder();
    const ids = rows.map((o) => o.id);
    if (ids.length === 0) return;

    if (action === "share") {
      const text = buildBulkShareText();
      const delivered = await deliverShareText(text, ids.length);
      if (delivered.cleared) setSelected(new Set());
      setPendingBulk(null);
      showNotice(delivered.notice);
      return;
    }

    if (action === "copy") {
      const text = buildBulkShareText();
      try {
        await navigator.clipboard.writeText(text);
        showNotice(
          `Copied ${ids.length} order${ids.length === 1 ? "" : "s"} to clipboard.`,
        );
      } catch {
        // Some browsers block clipboard writes outside a user gesture.
        // Fall back to the same delivery ladder the Share action uses —
        // it never truncates, which the old bare wa.me link did.
        const delivered = await deliverShareText(text, ids.length);
        showNotice(`Clipboard blocked. ${delivered.notice}`);
      }
      setPendingBulk(null);
      return;
    }

    // action === "cancel". Only status transition still bulkable; the
    // server route continues to expect this exact action string.
    setBulkRunning(true);
    try {
      const res = await adminFetch<{
        succeeded: string[];
        failed: { id: string; error: string }[];
      }>("/api/admin/orders/bulk", {
        method: "POST",
        body: JSON.stringify({ orderIds: ids, action }),
      });
      setBulkResult({ ...res, action });
      // Drop succeeded ids from selection and refetch so the UI matches
      // the canonical server state.
      setSelected((curr) => {
        const next = new Set(curr);
        for (const id of res.succeeded) next.delete(id);
        return next;
      });
      await load();
    } catch (e) {
      const msg =
        e instanceof AdminFetchError ? e.message : "Bulk action failed.";
      setBulkResult({ succeeded: [], failed: ids.map((id) => ({ id, error: msg })), action });
    } finally {
      setBulkRunning(false);
      setPendingBulk(null);
    }
  };

  const patchStatus = async (order: AdminOrderRow, next: OrderStatus) => {
    setBusyId(order.id);
    // Hold this row at its current sort rank so the badge changes under
    // the operator's cursor instead of the row jumping to another group.
    setRankPins((curr) => {
      if (curr.has(order.id)) return curr;
      const next = new Map(curr);
      next.set(order.id, orderStatusRank(order));
      return next;
    });
    // Optimistic — flip the status locally and roll back on failure.
    const prev = orders;
    setOrders((curr) =>
      curr.map((o) => (o.id === order.id ? { ...o, status: next } : o)),
    );
    try {
      await adminFetch(`/api/admin/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      // Mirror legacy: SMS + WhatsApp on every status change we have
      // copy for. Both are fire-and-forget; failures surface in a toast
      // but never roll back the status update.
      const phone = order.customers?.phone;
      const name = order.customers?.full_name ?? "Customer";
      const notify = toNotifyStatus(next);
      if (phone && notify) {
        const [smsRes, waRes] = await Promise.all([
          sendOrderStatusSMS({
            phone,
            name,
            orderId: order.id,
            status: notify,
          }),
          notify === "Pending"
            ? Promise.resolve({ ok: true as const, error: undefined as string | undefined })
            : sendOrderWhatsApp(phone, name, notify),
        ]);
        if (!smsRes.ok || !waRes.ok) {
          showNotice(
            `Status updated. Notify warnings: ${[
              smsRes.ok ? null : `SMS: ${smsRes.error}`,
              waRes.ok ? null : `WA: ${waRes.error}`,
            ]
              .filter(Boolean)
              .join(" · ")}`,
          );
        } else if (notify !== "Pending") {
          showNotice(`SMS + WhatsApp sent to ${name}.`);
        }
      }
    } catch (e) {
      setOrders(prev);
      if (e instanceof AdminFetchError) {
        alert(e.message);
      } else {
        alert("Update failed.");
      }
    } finally {
      setBusyId(null);
    }
  };

  // Append a call-preset note to a row. Purely additive — never edits
  // an earlier note, so a rapid double-click just stacks two rows in
  // the log. Optimistically bumps note_count + last_call_note on the
  // row so the operator sees the chip flip without waiting on the
  // list-endpoint re-poll.
  const postCallNote = async (order: AdminOrderRow, body: string) => {
    if (callBusyId) return;
    setCallBusyId(order.id);
    try {
      const author = ensureAdminFirstName();
      const payload: Record<string, unknown> = {
        order_id: order.id,
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
      setOrders((curr) =>
        curr.map((o) =>
          o.id === order.id
            ? {
                ...o,
                note_count: (o.note_count ?? 0) + 1,
                last_call_note: {
                  body: res.note.body,
                  author: res.note.author,
                  created_at: res.note.created_at,
                },
                // This POST is always kind='call', so it is both the
                // newest call AND the newest note of any kind.
                last_note: {
                  body: res.note.body,
                  author: res.note.author,
                  created_at: res.note.created_at,
                  kind: "call" as const,
                },
              }
            : o,
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
      title="Today's Orders"
      subtitle="Operational queue"
      actions={
        <>
          <Link
            href="/admin/orders/new"
            className="uppercase"
            style={chipPrimary}
          >
            Register new order
          </Link>
          <Link
            href={{
              pathname: "/admin/orders/print",
              query: {
                // `status` stays comma-separated (back-compatible with the
                // old single-value links); call updates ride a REPEATED
                // `call` param because note bodies can contain commas.
                status: encodeStatusParam(statusSel),
                ...(callSel.length > 0 ? { call: callSel } : {}),
                ...(repeatOnly ? { repeat: "1" } : {}),
                q: query,
                sort,
                // Carry the selected day so the print view shows exactly
                // the same slice as the on-screen table — and the BASIS
                // with it, or the sheet would filter on a different column
                // than the screen it was printed from.
                basis,
                ...(day ? { date: day } : {}),
              },
            }}
            className="uppercase"
            style={chipPrimary}
          >
            Print orders
          </Link>
          <button
            type="button"
            onClick={() => exportCsv(filtered, productNames)}
            className="uppercase"
            style={chipNeutral}
            disabled={filtered.length === 0}
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="uppercase"
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
      {/* Bread / Sandwiches tabs — filters the same board in-memory,
          keyed off orders.order_kind. Every legacy row is 'bread' at the
          DB default, so switching to Sandwiches on a pre-launch DB shows
          an empty list (not an error). */}
      <div
        className="mb-4"
        role="tablist"
        aria-label="Order kind"
        style={{ display: "flex", gap: "0.5rem" }}
      >
        {(["bread", "sandwich"] as const).map((k) => {
          const on = kindTab === k;
          const count = orders.filter(
            (o) => ((o.order_kind ?? "bread") as string) === k,
          ).length;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => {
                if (on) return;
                clearRankPins();
                setKindTab(k);
              }}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.75rem",
                letterSpacing: "0.22em",
                color: on ? "#1D1D1F" : "#FBF3D4",
                background: on ? "#FBF3D4" : "transparent",
                border: `1px solid ${on ? "#FBF3D4" : "rgba(251,243,212,0.3)"}`,
                padding: "0.4rem 0.85rem",
                cursor: "pointer",
              }}
            >
              {k === "bread" ? "Bread" : "Sandwiches"}
              <span style={{ marginLeft: 8, opacity: 0.7 }}>{count}</span>
            </button>
          );
        })}
      </div>

      <div
        className="mb-4"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "flex-start",
        }}
      >
        {/* ONE control: which date-column, and which day. Shared with
            /admin/subscriptions so the two boards cannot ask the same
            question two different ways. */}
        <DayFilter
          idPrefix="orders-date"
          basis={basis}
          onBasisChange={(next) => {
            clearRankPins();
            setBasis(next);
          }}
          day={day}
          onDayChange={applyDay}
        />
      </div>

      {/* Status filter + search + sort */}
      <div className="flex flex-wrap gap-3 items-center mb-6">
        {/* One dropdown instead of 11 wrapping chips. Same filter values,
            same live counts (range-scoped) — just folded into the label.
            Multi-select: the menu stays open so several can be ticked in a
            row; it closes on outside click or Esc. */}
        <div style={{ minWidth: 230 }}>
          <MultiSelect
            values={tickedValues}
            onToggle={toggleFilter}
            triggerLabel={filterLabel}
            ariaLabel="Filter orders by status"
            options={filterOptions}
          />
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, phone, OLF or CX ref"
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
        <div style={{ minWidth: 190 }}>
          <Select
            value={sort}
            onChange={(v) => {
              clearRankPins();
              const next = v as SortKey;
              // Picking any non-area sort drops the anchor so the chip
              // doesn't linger over a table it isn't sorting.
              if (next !== "nearest_from_area") setAnchor(null);
              setSort(next);
            }}
            ariaLabel="Sort orders"
            options={[
              { value: "created_desc", label: "Status, newest first" },
              { value: "delivery_asc", label: "Delivery date ↑" },
              ...(anchor
                ? [{ value: "nearest_from_area", label: "Nearest from area" }]
                : []),
            ]}
          />
        </div>
        <AreaSortControl
          anchor={anchor}
          onResolve={(a) => {
            clearRankPins();
            setAnchor(a);
            setSort("nearest_from_area");
          }}
          onClear={() => {
            setAnchor(null);
            // Flip back to the default sort so the table doesn't sit on
            // an invalid sort key with a stale row order.
            if (sort === "nearest_from_area") setSort("created_desc");
          }}
        />
      </div>

      {selected.size > 0 ? (
        <BulkToolbar
          count={selected.size}
          actions={BULK_ACTIONS}
          running={bulkRunning}
          onClear={() => setSelected(new Set())}
          onAction={(a) => {
            // Only "cancel" gets a confirmation modal — it writes to
            // the DB and notifies customers. Share / copy are pure
            // read paths and run immediately.
            if (a === "cancel") setPendingBulk(a);
            else void runBulk(a);
          }}
        />
      ) : null}

      {pendingBulk ? (
        <ConfirmModal
          action={pendingBulk}
          count={selected.size}
          running={bulkRunning}
          onCancel={() => setPendingBulk(null)}
          onConfirm={() => void runBulk(pendingBulk)}
        />
      ) : null}

      {bulkResult ? (
        <ResultModal result={bulkResult} onClose={() => setBulkResult(null)} />
      ) : null}

      {notice ? (
        <div
          style={{
            border: "1px solid rgba(251,243,212,0.45)",
            background: "rgba(251,243,212,0.07)",
            color: "#FBF3D4",
            padding: "0.7rem 1rem",
            marginBottom: "1rem",
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            letterSpacing: "0.03em",
          }}
        >
          {notice}
        </div>
      ) : null}

      {editing ? (
        <EditOrderModal
          order={editing}
          onCancel={() => setEditing(null)}
          onSaved={(updated, msg) => {
            setEditing(null);
            setOrders((curr) =>
              curr.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)),
            );
            showNotice(msg);
            void load();
          }}
        />
      ) : null}

      {orderEditing ? (
        <EditOrderPanel
          order={orderEditing}
          onCancel={() => setOrderEditing(null)}
          onSaved={(msg) => {
            setOrderEditing(null);
            showNotice(msg);
            void load();
          }}
        />
      ) : null}

      {scheduling ? (
        <SchedulePreorderModal
          order={scheduling}
          onCancel={() => setScheduling(null)}
          onSaved={(updated, msg) => {
            setScheduling(null);
            setOrders((curr) =>
              curr.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)),
            );
            showNotice(msg);
            void load();
          }}
        />
      ) : null}

      {noteOwner ? (
        <NotePanel
          owner={noteOwner}
          onCountChange={(next) => {
            const targetId = noteOwner.id;
            setOrders((curr) =>
              curr.map((o) =>
                o.id === targetId ? { ...o, note_count: next } : o,
              ),
            );
          }}
          onClose={() => {
            // Panel edits stack notes append-only; refresh so any new
            // last_call_note (e.g. a Custom call the operator typed
            // in the panel) shows in the row chip.
            const shouldReload = true;
            setNoteOwner(null);
            if (shouldReload) void load();
          }}
        />
      ) : null}

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {/* All-time retention. Sits above the table but is deliberately
          independent of the filters and the date range above it. */}
      {!loading && retention ? <RetentionPanel data={retention} /> : null}
      {/* Bake summary — the same filtered set as the table below, so the
          ORDER numbers on this strip and on the rows can never disagree,
          plus the subscription stops due on the selected day (see subStops).
          Cancelled orders are excluded inside aggregateProduction.
          When a zone filter is active, split into one strip per selected
          zone so a mixed selection can't silently combine loaf counts.

          The `subStops.length` arm matters: a day can have subscription
          deliveries and no one-time orders at all, and under the old
          orders-only guard the whole strip vanished — a blank screen for a
          day that still owed bread. */}
      {!loading && (filtered.length > 0 || subStops.length > 0) ? (
        zoneSel.length > 0 ? (
          zoneSel.map((z) => (
            <ProductionCountStrip
              key={z}
              zone={z}
              orders={filtered.filter((o) => zoneOf.get(o.id) === z)}
              subscriptions={subStops.filter((s) => s.zone === z)}
              names={productNames}
            />
          ))
        ) : (
          <ProductionCountStrip
            orders={filtered}
            subscriptions={subStops}
            names={productNames}
          />
        )
      ) : null}
      {loading ? (
        <Placeholder>Loading orders…</Placeholder>
      ) : filtered.length === 0 ? (
        <Placeholder>No orders match the current filters.</Placeholder>
      ) : (
        <div
          style={{
            border: "1px solid rgba(251,243,212,0.18)",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
            <thead>
              <tr style={tableHeadRow}>
                <th style={{ ...th, width: 36 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all visible orders"
                    checked={masterChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = !masterChecked && someSelected;
                    }}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th style={th}>Order</th>
                <th style={th}>Customer</th>
                <th style={th}>Address</th>
                <th style={th}>Total</th>
                <th style={th}>Payment</th>
                <th style={th}>Status</th>
                <th style={th}>Delivery</th>
                <th style={th}>Created</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => {
                const next = nextStatusFor(o);
                const busy = busyId === o.id;
                const dist =
                  sort === "nearest_from_area" && anchor
                    ? distanceFrom(orderLocation(o), anchor, pincodeCoords)
                    : null;
                return (
                  <tr
                    key={o.id}
                    onClick={(e) => {
                      // Row-wide navigation, minus the controls that own
                      // their own click (checkbox, status Select, actions).
                      if (
                        (e.target as HTMLElement).closest(
                          ROW_INTERACTIVE_SELECTOR,
                        )
                      ) {
                        return;
                      }
                      if (window.getSelection()?.toString()) return;
                      // Stash scrollY so Back-to-orders can restore
                      // exactly this position. Read on mount, then
                      // cleared — see useScrollRestore above.
                      stashScrollY(SCROLL_KEY);
                      router.push(`/admin/orders/${o.id}`);
                    }}
                    title="Open order detail"
                    style={{
                      cursor: "pointer",
                      background:
                        i % 2 === 0
                          ? "rgba(251,243,212,0.025)"
                          : "transparent",
                    }}
                  >
                    <td style={td}>
                      <input
                        type="checkbox"
                        aria-label={`Select order ${o.id}`}
                        checked={selected.has(o.id)}
                        onChange={() => toggleSelect(o.id)}
                      />
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          fontFamily: "var(--font-body)",
                          fontSize: "0.875rem",
                          letterSpacing: "0.1em",
                          color: "#FBF3D4",
                        }}
                        title={o.id}
                      >
                        {formatOrderNumber(o)}
                        {isOrderFulfilled(o) ? <FulfilledTick /> : null}
                      </span>
                      <LoafDots items={o.items} names={productNames} />
                    </td>
                    <td style={td}>
                      <div style={{ color: "#FBF3D4", fontSize: "1rem" }}>
                        {o.customers?.full_name ?? "—"}
                        <RepeatStar
                          seq={o.repeat_seq}
                          count={o.customer_order_count}
                          firstAt={o.customer_first_order_at}
                        />
                      </div>
                      {o.customers?.phone ? (
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span
                            style={{
                              color: "rgba(251,243,212,0.85)",
                              fontSize: "1rem",
                              letterSpacing: "0.05em",
                            }}
                          >
                            {o.customers.phone}
                          </span>
                          <ContactActions
                            phone={o.customers.phone}
                            customerName={o.customers.full_name}
                            orderInfo={`order ${formatOrderNumber(o)}`}
                          />
                        </div>
                      ) : null}
                    </td>
                    <td style={{ ...td, maxWidth: 240 }}>
                      {/* Zone pill (also shows "Pickup" for pickup rows, so the
                          old bespoke pickup badge is subsumed here). Zone is
                          resolved from the address at read time via
                          src/lib/delivery-zones.ts — no column, no migration. */}
                      <div style={{ marginBottom: 4 }}>
                        <ZoneBadge
                          zone={zoneOf.get(o.id)}
                          source={zoneResOf.get(o.id)?.source}
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = (
                              e.currentTarget as HTMLElement
                            ).getBoundingClientRect();
                            setAssignTarget({ orderId: o.id, anchorRect: rect });
                          }}
                        />
                      </div>
                      <div
                        style={{
                          color: "#FBF3D4",
                          fontSize: "1rem",
                          lineHeight: 1.4,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {o.delivery_address ?? "—"}
                      </div>
                      {o.fulfillment_type === "pickup" && o.pickup_location ? (
                        <div
                          style={{
                            color: "rgba(251,243,212,0.85)",
                            fontSize: "1rem",
                            letterSpacing: "0.03em",
                            marginTop: 2,
                          }}
                        >
                          {o.pickup_location.name}
                          {o.pickup_location.area ? ` · ${o.pickup_location.area}` : ""}
                        </div>
                      ) : o.customers?.city ? (
                        <div
                          style={{
                            color: "rgba(251,243,212,0.65)",
                            fontSize: "1rem",
                            letterSpacing: "0.05em",
                            marginTop: 2,
                          }}
                        >
                          {o.customers.city}
                        </div>
                      ) : null}
                      {o.fulfillment_type === "pickup" ? null : (
                        <OrderLocationActions
                          latitude={o.latitude}
                          longitude={o.longitude}
                          orderId={o.id}
                          orderNumber={o.order_number}
                        />
                      )}
                      {dist ? <DistanceBadge info={dist} /> : null}
                    </td>
                    <td style={td}>
                      <span style={{ color: "#FBF3D4", fontSize: "1rem" }}>
                        {formatINR(o.total_amount)}
                      </span>
                    </td>
                    <td style={td}>
                      <PaymentBadge
                        method={o.payment_method}
                        status={o.payment_status}
                      />
                    </td>
                    <td style={td}>
                      <Select
                        value={(o.status ?? "").toLowerCase()}
                        disabled={busy}
                        ariaLabel="Order status"
                        style={statusSelect}
                        onChange={(v) => {
                          const next = v as OrderStatus;
                          if (next === "cancelled") {
                            if (!confirm("Cancel this order?")) return;
                          }
                          void patchStatus(o, next);
                        }}
                        options={[
                          ...ORDER_STATUSES.map((s) => ({
                            value: s,
                            label: formatStatusLabel(s),
                          })),
                          ...(o.status &&
                          !ORDER_STATUSES.includes(o.status as OrderStatus)
                            ? [
                                {
                                  value: o.status,
                                  label: formatStatusLabel(o.status),
                                },
                              ]
                            : []),
                        ]}
                      />
                      <div style={{ marginTop: 4 }}>
                        {/* Show 'expired' badge for stale unpaid pending orders
                            (>7d, per src/lib/order-state.ts). Stored orders.status
                            is still 'pending' — computed_state is derived on read. */}
                        <StatusBadge
                          status={
                            o.computed_state === "expired" ? "expired" : o.status
                          }
                        />
                      </div>
                      {/* Call-update dropdown — separate control from Status.
                          Selecting a preset appends a kind='call' note; "Custom"
                          opens the NotePanel with the panel's Kind pre-set. */}
                      <div style={{ marginTop: 6 }}>
                        <Select
                          value=""
                          disabled={callBusyId === o.id}
                          ariaLabel="Log a call update"
                          style={statusSelect}
                          onChange={(v) => {
                            if (!v) return;
                            if (v === "__custom") {
                              setNoteOwner({
                                kind: "order",
                                id: o.id,
                                label: formatOrderNumber(o),
                              });
                              return;
                            }
                            void postCallNote(o, v);
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
                      {/* The most recent note of ANY kind, so the operator
                          sees "already contacted, said reschedule" without
                          opening the panel. Shared with the subscriptions
                          board — see LastNoteChip. */}
                      <LastNoteChip note={o.last_note} />
                    </td>
                    <td style={td}>
                      <div style={{ color: "#FBF3D4", fontSize: "1rem" }}>
                        {o.delivery_date ? formatDate(o.delivery_date) : "—"}
                      </div>
                      {o.delivery_slot ? (
                        <div
                          style={{
                            color: "rgba(251,243,212,0.65)",
                            fontSize: "1rem",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {/* Same formatter as the detail page and the CSV, so
                              one order never reads three different ways.
                              Legacy bare "07:30" rows become "7:30–8:00 AM";
                              the sort above still compares the raw value. */}
                          {formatSlotForDisplay(o.delivery_slot)}
                        </div>
                      ) : null}
                      {o.is_preorder ? (
                        <div
                          style={{
                            marginTop: 4,
                            display: "inline-block",
                            padding: "2px 6px",
                            border: "1px solid rgba(251,243,212,0.5)",
                            color: "#FBF3D4",
                            fontSize: "0.875rem",
                            letterSpacing: "0.18em",
                            textTransform: "uppercase",
                            borderRadius: 3,
                          }}
                        >
                          {o.delivery_date ? "Pre-order · Scheduled" : "Pre-order · Unscheduled"}
                        </div>
                      ) : null}
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          color: "rgba(251,243,212,0.7)",
                          fontSize: "1rem",
                        }}
                      >
                        {formatDateTime(o.created_at)}
                      </span>
                    </td>
                    <td style={td}>
                      <div className="flex flex-wrap gap-2 items-center">
                        <NoteIconButton
                          count={o.note_count ?? 0}
                          onClick={() =>
                            setNoteOwner({
                              kind: "order",
                              id: o.id,
                              label: formatOrderNumber(o),
                            })
                          }
                        />
                        {next ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void advance(o)}
                            style={{
                              ...buttonSm,
                              opacity: busy ? 0.5 : 1,
                            }}
                          >
                            Mark {next}
                          </button>
                        ) : null}
                        {isShareable(o) ? (
                          <OrderShareButton
                            order={o}
                            partners={partners}
                            partnersLoading={partnersLoading}
                            partnersError={partnersError}
                            buttonStyle={{
                              ...buttonSm,
                              opacity: busy ? 0.5 : 1,
                            }}
                            rules={zoneRules}
                          />
                        ) : null}
                        {o.is_preorder && !o.delivery_date ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setScheduling(o)}
                            style={{
                              ...buttonSm,
                              color: "#FBF3D4",
                              borderColor: "rgba(251,243,212,0.6)",
                              opacity: busy ? 0.5 : 1,
                            }}
                            title="Set delivery date and notify customer (SMS + WhatsApp)"
                          >
                            Schedule
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setEditing(o)}
                          style={{ ...buttonSm, opacity: busy ? 0.5 : 1 }}
                          title="Edit customer name/phone/city/address"
                        >
                          Customer
                        </button>
                        {/* Labelled for the job it is actually opened for.
                            It read "Order", sat next to "Customer", and
                            nothing on the face of it said "date" — that
                            word appeared only in the title attr, which
                            never renders on the touch devices this board
                            is worked from, so the control was invisible in
                            practice. The panel still edits items, fee,
                            address and location; the tooltip carries those,
                            the label carries the common case. */}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setOrderEditing(o)}
                          style={{ ...buttonSm, opacity: busy ? 0.5 : 1 }}
                          title="Edit delivery date, slot, items, fee, address, location"
                        >
                          Edit date &amp; time
                        </button>
                        <Link
                          href={`/admin/orders/${o.id}/print`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            ...buttonSm,
                            textDecoration: "none",
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                          title="Print single-order receipt"
                        >
                          Print
                        </Link>
                        {o.status !== "cancelled" && o.status !== "delivered" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (confirm("Cancel this order?")) {
                                void patchStatus(o, "cancelled");
                              }
                            }}
                            style={{
                              ...buttonSm,
                              color: "#EF4444",
                              borderColor: "rgba(239,68,68,0.45)",
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
      {assignTarget
        ? (() => {
            const o = orders.find((x) => x.id === assignTarget.orderId);
            const res = zoneResOf.get(assignTarget.orderId);
            if (!o || !res) return null;
            const ruleKey =
              res.zone === "pickup"
                ? null
                : pickRuleKey({ address: o.delivery_address });
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
                ? overrideRows.find((x) => x.order_id === o.id) ?? null
                : null;
            return (
              <ZoneAssignPopover
                open
                onClose={() => setAssignTarget(null)}
                currentZone={res.zone}
                resolution={res}
                target={{ kind: "order", id: o.id }}
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

const BULK_ACTIONS: readonly BulkActionSpec<BulkAction>[] = [
  { id: "share", label: "Share on WhatsApp" },
  { id: "copy", label: "Copy details" },
  { id: "cancel", label: "Cancel", danger: true },
];

// Derived, not written twice: the confirm modal's heading must say the same
// word the button the operator just pressed said.
const ACTION_LABEL = Object.fromEntries(
  BULK_ACTIONS.map((a) => [a.id, a.label]),
) as Record<BulkAction, string>;

// Only "cancel" surfaces in the result modal — share/copy don't touch
// the server. Kept as a Record so a future bulk write stays typed.
const ACTION_PAST: Record<BulkAction, string> = {
  share: "shared",
  copy: "copied",
  cancel: "cancelled",
};

function ConfirmModal({
  action,
  count,
  running,
  onCancel,
  onConfirm,
}: {
  action: BulkAction;
  count: number;
  running: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div style={modalBackdrop} onClick={running ? undefined : onCancel}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={modalTitle}>
            {ACTION_LABEL[action]} · {count} order{count === 1 ? "" : "s"}?
          </h3>
        </div>
        <div style={modalScrollBody}>
          <p style={modalBody}>
            {action === "cancel"
              ? `This will mark ${count} order${count === 1 ? "" : "s"} as cancelled. The customer will receive a push notification. This cannot be undone via the admin UI.`
              : `${count} order${count === 1 ? "" : "s"} will be marked as ${ACTION_PAST[action]} and the customers notified.`}
          </p>
        </div>
        <div style={modalFooter}>
          <div style={modalActions}>
            <button
              type="button"
              onClick={onCancel}
              disabled={running}
              style={chipNeutral}
            >
              Back
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={running}
              style={{
                ...chipPrimary,
                background: action === "cancel" ? "rgba(239,68,68,0.15)" : "rgba(251,243,212,0.15)",
                borderColor:
                  action === "cancel"
                    ? "rgba(239,68,68,0.6)"
                    : "rgba(251,243,212,0.6)",
                color: action === "cancel" ? "#EF4444" : "#FBF3D4",
                opacity: running ? 0.6 : 1,
              }}
            >
              {running ? "Working…" : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultModal({
  result,
  onClose,
}: {
  result: BulkResult;
  onClose: () => void;
}) {
  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={modalTitle}>Bulk {ACTION_PAST[result.action]} complete</h3>
        </div>
        <div style={modalScrollBody}>
          <p style={{ ...modalBody, marginBottom: "1rem" }}>
            {result.succeeded.length} succeeded · {result.failed.length} failed
          </p>
          {result.failed.length > 0 ? (
            <ul
              style={{
                border: "1px solid rgba(239,68,68,0.35)",
                padding: "0.5rem 0.8rem",
                color: "#EF4444",
                fontFamily: "var(--font-body)",
                fontSize: "1rem",
                listStyle: "none",
                margin: 0,
              }}
            >
              {result.failed.map((f) => (
                <li key={f.id} style={{ padding: "0.2rem 0" }}>
                  {formatOrderNumber({ id: f.id })} — {f.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div style={modalFooter}>
          <div style={modalActions}>
            <button type="button" onClick={onClose} style={chipPrimary}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditOrderModal({
  order,
  onCancel,
  onSaved,
}: {
  order: AdminOrderRow;
  onCancel: () => void;
  onSaved: (updated: AdminOrderRow, message: string) => void;
}) {
  const [fullName, setFullName] = useState(order.customers?.full_name ?? "");
  const [phone, setPhone] = useState(order.customers?.phone ?? "");
  const [city, setCity] = useState(order.customers?.city ?? "");
  const [address, setAddress] = useState(order.delivery_address ?? "");
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const customerId = order.customer_id;
  const canSave =
    !saving &&
    (fullName.trim().length > 0 || phone.trim().length > 0 || address.trim().length > 0);

  const save = async () => {
    setErr(null);
    setSaving(true);
    try {
      const updatedCustomer = {
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        city: city.trim() || null,
      };
      if (customerId) {
        await adminFetch(`/api/admin/customers/${customerId}`, {
          method: "PATCH",
          body: JSON.stringify(updatedCustomer),
        });
      }
      if (address.trim() && address.trim() !== (order.delivery_address ?? "")) {
        await adminFetch(`/api/admin/orders/${order.id}`, {
          method: "PATCH",
          body: JSON.stringify({ delivery_address: address.trim() }),
        });
      }
      let notifyMessage = "Customer + order updated.";
      if (notify && phone.trim()) {
        // Legacy parity: SMS customer_edit + WhatsApp informational ping.
        const sms = await sendCustomerEditSMS({
          phone: phone.trim(),
          name: fullName.trim() || "Customer",
          address: address.trim(),
        });
        const waBody = `Hi ${fullName.trim() || "Customer"}! Your Cadieux account details have been updated. Name: ${fullName.trim()} · Address: ${address.trim()}. If you did not request this change, please contact us immediately.`;
        let waOk = true;
        let waErr = "";
        try {
          const r = await fetch("/api/send-whatsapp", {
            method: "POST",
            headers: adminAuthHeaders({ "Content-Type": "application/json" }),
            credentials: "include",
            body: JSON.stringify({ phone: phone.trim(), message: waBody }),
          });
          if (!r.ok) {
            const d = (await r.json().catch(() => ({}))) as { error?: string };
            waOk = false;
            waErr = d.error ?? `HTTP ${r.status}`;
          }
        } catch (e) {
          waOk = false;
          waErr = String(e);
        }
        if (sms.ok && waOk) {
          notifyMessage = "Customer + order updated. SMS + WhatsApp sent.";
        } else {
          notifyMessage = `Updated. Notify warnings: ${[
            sms.ok ? null : `SMS: ${sms.error}`,
            waOk ? null : `WA: ${waErr}`,
          ]
            .filter(Boolean)
            .join(" · ")}`;
        }
      }
      onSaved(
        {
          ...order,
          delivery_address: address.trim() || order.delivery_address,
          customers: {
            id: customerId ?? "",
            full_name: updatedCustomer.full_name,
            phone: updatedCustomer.phone,
            city: updatedCustomer.city,
          },
        },
        notifyMessage,
      );
    } catch (e) {
      if (e instanceof AdminFetchError) setErr(e.message);
      else setErr("Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={modalBackdrop} onClick={saving ? undefined : onCancel}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={modalTitle}>Edit customer · order {formatOrderNumber(order)}</h3>
        </div>
        <div style={modalScrollBody}>
          <Field label="Full name">
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={saving}
              style={modalInput}
            />
          </Field>
          <Field label="Phone">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={saving}
              style={modalInput}
            />
          </Field>
          <Field label="City">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              disabled={saving}
              style={modalInput}
            />
          </Field>
          <Field label="Delivery address">
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={saving}
              rows={4}
              style={{
                ...modalInput,
                fontFamily: "var(--font-body)",
                resize: "vertical",
              }}
            />
          </Field>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              margin: "0.5rem 0 1rem",
              color: "rgba(251,243,212,0.8)",
              fontFamily: "var(--font-body)",
              fontSize: "1rem",
            }}
          >
            <input
              type="checkbox"
              checked={notify}
              disabled={saving}
              onChange={(e) => setNotify(e.target.checked)}
            />
            Send SMS + WhatsApp to customer about this change
          </label>
          {err ? (
            <p style={{ color: "#EF4444", fontSize: "1rem", margin: 0 }}>
              {err}
            </p>
          ) : null}
        </div>
        <div style={modalFooter}>
          <div style={modalActions}>
            <button type="button" onClick={onCancel} disabled={saving} style={chipNeutral}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
              style={{
                ...chipPrimary,
                opacity: !canSave ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Pre-order scheduling modal — admin sets a delivery_date on an
// is_preorder=true row that hasn't been scheduled yet. The PATCH handler
// stamps scheduled_delivery_date_at and fires MSG91 SMS + WhatsApp
// (env-gated templates). See src/app/api/admin/orders/[id]/route.ts.
function SchedulePreorderModal({
  order,
  onCancel,
  onSaved,
}: {
  order: AdminOrderRow;
  onCancel: () => void;
  onSaved: (updated: AdminOrderRow, message: string) => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayYmd = today.toISOString().slice(0, 10);
  const [date, setDate] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSave = !saving && date && date >= todayYmd;

  const save = async () => {
    if (!canSave) return;
    setErr(null);
    setSaving(true);
    try {
      const updated = await adminFetch<{ order: AdminOrderRow }>(
        `/api/admin/orders/${order.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ delivery_date: date }),
        },
      );
      onSaved(
        {
          ...order,
          ...(updated.order ?? {}),
          delivery_date: date,
          scheduled_delivery_date_at: new Date().toISOString(),
        },
        `Scheduled ${formatDate(date)}. Customer notified by SMS + WhatsApp.`,
      );
    } catch (e) {
      if (e instanceof AdminFetchError) setErr(e.message);
      else setErr("Schedule failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={modalBackdrop} onClick={saving ? undefined : onCancel}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={modalTitle}>
            Schedule pre-order · {formatOrderNumber(order)}
          </h3>
        </div>
        <div style={modalScrollBody}>
          <p
            style={{
              margin: "0 0 1rem",
              color: "rgba(251,243,212,0.8)",
              fontFamily: "var(--font-body)",
              fontSize: "1rem",
              lineHeight: 1.55,
            }}
          >
            Sets the delivery date on this pre-order and sends the customer
            an SMS + WhatsApp confirmation. Slot can be edited later from
            the standard Edit dialog if needed.
          </p>
          <Field label="Delivery date">
            <input
              type="date"
              value={date}
              min={todayYmd}
              onChange={(e) => setDate(e.target.value)}
              disabled={saving}
              style={modalInput}
            />
          </Field>
          {err ? (
            <p style={{ color: "#EF4444", fontSize: "1rem", margin: 0 }}>
              {err}
            </p>
          ) : null}
        </div>
        <div style={modalFooter}>
          <div style={modalActions}>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              style={chipNeutral}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
              style={{
                ...chipPrimary,
                opacity: !canSave ? 0.5 : 1,
              }}
            >
              {saving ? "Scheduling…" : "Schedule + notify"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.3rem",
        margin: "0 0 0.8rem",
        fontFamily: "var(--font-body)",
        fontSize: "0.875rem",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "rgba(251,243,212,0.85)",
      }}
    >
      {label}
      {children}
    </label>
  );
}

const modalInput: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(251,243,212,0.3)",
  color: "#FBF3D4",
  padding: "0.55rem 0.7rem",
  fontSize: "1rem",
  letterSpacing: "0.02em",
  outline: "none",
  textTransform: "none",
};

/** Units of each product on one order, keyed by `slug ?? product_id`.
 *  Lines with no identity at all are dropped rather than guessed into a
 *  column — see lib/order-items.ts. */
function unitsBySlug(o: AdminOrderRow): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of o.items ?? []) {
    const slug = itemSlug(it);
    if (!slug) continue;
    const q = itemQty(it);
    if (q === 0) continue;
    m.set(slug, (m.get(slug) ?? 0) + q);
  }
  return m;
}

/** One column per product, so the export answers "how many of each" and
 *  not just "how much money".
 *
 *  The three known products always get a column, in a fixed order, even
 *  when the exported slice contains none of them — a column that appears
 *  and disappears between exports cannot be pasted into the same sheet
 *  twice. Anything else that turns up is appended, so a product added to
 *  the catalogue shows up here with no code change. */
function productColumns(rows: AdminOrderRow[], names?: ProductNameMap) {
  const known = Object.keys(PRODUCT_NAMES);
  const extra = new Set<string>();
  for (const o of rows) {
    for (const slug of Array.from(unitsBySlug(o).keys())) {
      if (!known.includes(slug)) extra.add(slug);
    }
  }
  return [...known, ...Array.from(extra).sort()].map((slug) => ({
    // Header from the catalogue, not from any line in the export — two
    // exports taken either side of a rename must not produce two different
    // column headers for the same slug.
    header: `${productDisplayName(slug, names)} units`,
    value: (o: AdminOrderRow) => unitsBySlug(o).get(slug) ?? 0,
  }));
}

function exportCsv(rows: AdminOrderRow[], names?: ProductNameMap): void {
  const csv = toCsv(rows, [
    { header: "Order ID", value: (o) => o.id },
    { header: "Customer", value: (o) => o.customers?.full_name ?? "" },
    { header: "Phone", value: (o) => o.customers?.phone ?? "" },
    { header: "Total", value: (o) => o.total_amount ?? 0 },
    { header: "Status", value: (o) => o.status ?? "" },
    { header: "Delivery date", value: (o) => o.delivery_date ?? "" },
    {
      header: "Delivery slot",
      value: (o) => formatSlotForDisplay(o.delivery_slot),
    },
    { header: "Delivery address", value: (o) => o.delivery_address ?? "" },
    { header: "Created", value: (o) => o.created_at },
    // Appended, never inserted: an existing sheet keyed on column
    // position keeps working.
    ...productColumns(rows, names),
  ]);
  downloadCsv(csvFilename("orders"), csv);
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
        letterSpacing: "0.05em",
      }}
    >
      {children}
    </div>
  );
}

// Payment status pill for the orders table. Paid = green, COD = grey,
// Failed = red, anything else (razorpay created/pending) = amber.
function PaymentBadge({
  method,
  status,
}: {
  method?: string | null;
  status?: string | null;
}) {
  const m = (method ?? "").toLowerCase();
  const s = (status ?? "").toLowerCase();

  let label: string;
  let color: string;
  let bg: string;
  if (s === "paid") {
    label = "Paid";
    color = "rgb(251,243,212)";
    bg = "rgba(251,243,212,0.12)";
  } else if (s === "failed") {
    label = "Failed";
    color = "#EF4444";
    bg = "rgba(239,68,68,0.12)";
  } else if (m === "cod") {
    label = "COD";
    color = "rgba(251,243,212,0.85)";
    bg = "rgba(251,243,212,0.1)";
  } else if (!m && !s) {
    label = "—";
    color = "rgba(251,243,212,0.5)";
    bg = "transparent";
  } else {
    label = "Awaiting";
    color = "rgb(251,243,212)";
    bg = "rgba(251,243,212,0.12)";
  }

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        background: bg,
        color,
        fontFamily: "var(--font-body)",
        fontSize: "0.875rem",
        fontWeight: 500,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(239,68,68,0.45)",
        background: "rgba(239,68,68,0.06)",
        padding: "0.8rem 1rem",
        marginBottom: "1rem",
        color: "#EF4444",
        fontFamily: "var(--font-body)",
        fontSize: "1rem",
        display: "flex",
        gap: "1rem",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span>{message}</span>
      <button type="button" onClick={onRetry} style={buttonSm}>
        Retry
      </button>
    </div>
  );
}

const statusSelect: React.CSSProperties = {
  padding: "0.3rem 0.5rem",
  background: "transparent",
  border: "1px solid rgba(251,243,212,0.45)",
  color: "#FBF3D4",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  cursor: "pointer",
  maxWidth: 140,
  minHeight: 0,
  borderRadius: 6,
};

const chipBase: React.CSSProperties = {
  padding: "0.35rem 0.85rem",
  border: "1px solid rgba(251,243,212,0.4)",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  background: "transparent",
  cursor: "pointer",
};

const chipPrimary: React.CSSProperties = {
  ...chipBase,
  color: "#FBF3D4",
  borderColor: "rgba(251,243,212,0.55)",
  display: "inline-block",
  textDecoration: "none",
};

const chipNeutral: React.CSSProperties = {
  ...chipBase,
  color: "rgba(251,243,212,0.85)",
};

const tableHeadRow: React.CSSProperties = {
  background: "rgba(251,243,212,0.08)",
  color: "rgba(251,243,212,0.9)",
  textTransform: "uppercase",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.7rem 1rem",
  fontFamily: "var(--font-body)",
  fontWeight: 400,
  borderBottom: "1px solid rgba(251,243,212,0.15)",
};

const td: React.CSSProperties = {
  padding: "0.7rem 1rem",
  fontFamily: "var(--font-body)",
  verticalAlign: "top",
  borderBottom: "1px solid rgba(251,243,212,0.06)",
};

const buttonSm: React.CSSProperties = {
  padding: "0.3rem 0.7rem",
  background: "transparent",
  border: "1px solid rgba(251,243,212,0.45)",
  color: "#FBF3D4",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(29,29,31,0.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
  padding: "1rem",
};

const modalCard: React.CSSProperties = {
  width: "100%",
  maxWidth: 460,
  background: "rgb(29,29,31)",
  border: "1px solid rgba(251,243,212,0.4)",
  borderRadius: 6,
  // 3-zone scrollable layout: sticky header + scrollable body + sticky footer
  display: "flex",
  flexDirection: "column",
  maxHeight: "min(90vh, calc(100dvh - 2rem))",
  minHeight: 0,
  overflow: "hidden",
};

const modalHeader: React.CSSProperties = {
  flexShrink: 0,
  padding: "1.1rem 1.4rem 0.9rem",
  background: "rgb(29,29,31)",
  borderBottom: "1px solid rgba(251,243,212,0.18)",
};

const modalScrollBody: React.CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  padding: "1.1rem 1.4rem",
};

const modalFooter: React.CSSProperties = {
  flexShrink: 0,
  padding: "0.9rem 1.4rem",
  background: "rgb(29,29,31)",
  borderTop: "1px solid rgba(251,243,212,0.18)",
};

const modalTitle: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: "1.05rem",
  color: "#FBF3D4",
  margin: 0,
  letterSpacing: "0.04em",
};

const modalBody: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
  color: "rgba(251,243,212,0.85)",
  lineHeight: 1.5,
  margin: 0,
};

const modalActions: React.CSSProperties = {
  display: "flex",
  gap: "0.6rem",
  justifyContent: "flex-end",
};
