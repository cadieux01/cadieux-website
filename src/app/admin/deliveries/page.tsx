"use client";

// Online / Deliveries — the routing view.
//
// The question this board answers is the one /admin/orders cannot: "what
// does ONE person drive, in what order". Orders and subscriptions are two
// tables to a bookkeeper and one list to a rider, so this screen reads both
// and reduces them to stops.
//
// PHONE FIRST. It is used standing up, one-handed, outside a building. One
// screen, vertical scroll only — nothing here may scroll sideways at phone
// width. The seven-column table is therefore a real <table> from `md` up and
// a stack of labelled rows below it: same cells, same order, same component,
// switched by `md:table-cell` / `block`. A 7-column grid cannot be made to
// fit 360px honestly, and a horizontally-scrolling table on a phone hides
// the Total and the Note off the right edge — which are two of the three
// things a rider actually reads.
//
// ZONES ARE NOT DERIVED HERE. Every row goes through
// `resolveZoneWithSource` in lib/partner-deliveries, with the same arguments
// /admin/orders and /admin/subscriptions pass, against the same learned
// ruleset fetched from /api/admin/zone-rules. If this screen resolved zones
// its own way the two boards would disagree and the partner would drive the
// wrong list.
//
// AREAS come from ZONE_AREAS — the 36 locality names in ZONE_DEFS, read off
// the same map the resolver matches against. NOT from `service_areas`, which
// is a different catalogue of 118 rows and would offer areas this resolver
// can never match.
//
// STAGE 2 (zone assignment) is live: long-press or double-tap a row to pin
// it to a zone. STAGE 3a (text notes) is live: tap the Note cell to write
// one.
//
// NOTES ARE PER STOP, AND THAT IS THE WHOLE DESIGN. They are written to
// public.order_notes — the store the orders and subscriptions boards
// already use, which carries the XOR parent (order_id or subscription_id)
// this board needs to keep ONE code path across its two row kinds — with a
// `stop_date` naming the day. An order is one stop on one day, so its note
// is unambiguous. A subscription is many stops, so a note with no date
// would render on every future drop for that customer: yesterday's "nobody
// home, left with the guard" greeting the partner for the rest of the
// plan. Writing is therefore refused unless the current filter resolves the
// row to exactly ONE day (see rowStopDate); the cell says so rather than
// guessing a date.
//
// subscription_deliveries.admin_notes was NOT reused. Both customer
// self-edit routes append to it, it is returned to the customer verbatim
// by a select("*"), the admin subscriptions board greps it for the literal
// "[user edit" to raise a badge, and the admin PATCH overwrites it whole.
// A partner's field note in there would be published to the customer, able
// to forge that badge, and one admin save away from destroying the
// customer's reschedule history.
//
// TWO GESTURES, TWO DIFFERENT WRITES. Keep them straight.
//
//   Long-press / zone pill  -> `delivery_zone_row_overrides`. Step 2 of the
//     resolver. Pins ONE order or subscription. Teaches nothing. Use it when
//     the address is unusable and only this stop is wrong.
//
//   "Add to List" on the address -> `delivery_zone_rules` (key_type
//     'locality'). Step 4. Names an AREA and points every future address
//     containing that name at this stop's zone. The far more powerful
//     gesture, which is why the dialog shows the match count before saving.
//
// Add to List used to be impossible, and the reason is worth keeping: step 4
// iterated the BUILT-IN locality tokens in ZONE_DEFS and then asked whether a
// rule existed for each hit, so a rule naming a locality outside ZONE_DEFS
// was written, listed in the panel, and never fired. The resolver now drives
// that step from the RULES and tests each rule's name against the address
// (see the step-4 comment in lib/delivery-zones), which is what makes this
// feature real rather than a success message over a no-op.
//
// WHY THIS IS SAFE TO PUT IN A PARTNER'S HANDS: grepping "zone"
// (case-insensitive) in src/lib/order-checkout.ts returns ZERO matches —
// pricing is computed from distance in lib/deliveryFee.ts and never reads a
// zone. Re-zoning therefore cannot change what any customer is charged, on
// this order or any other. It only moves which list the row appears in.
//
// ATTRIBUTION IS NOT AVAILABLE. This admin surface has no per-user
// accounts — audit_log.actor is always null here — so neither an assignment
// nor a note can be attributed to a person. The override row records WHAT
// changed and WHEN (zone + updated_at) and the popover says plainly that
// "who" is not recorded. No `actor` is sent, so the route's own "admin"
// default stands as the placeholder it is; nothing in this file renders it
// as a name. Notes are the same: no `author` is sent, so order_notes.author
// stays NULL, and the cell shows the text and the time and says who wrote
// it is not recorded. An author box here would collect a name nothing
// verifies, which is worse than an honest blank.
//
// NOTES ARE APPEND-ONLY, because /api/admin/notes is: it has no PATCH and
// no DELETE, by design. "Edit" prefills the box with the latest note and
// Save writes a NEW row; the cell renders the newest and says how many
// earlier ones are kept. Nothing this board does can destroy a note.

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
import { DayFilter } from "@/components/admin/DayFilter";
import {
  NUMBERED_ZONES,
  ZoneAssignPopover,
} from "@/components/admin/ZoneAssignPopover";
import { ZoneBadge } from "@/components/admin/ZoneBadge";
import { adminFetch } from "@/lib/admin-client";
import { useUrlWriteback } from "@/lib/admin-url-state";
import { formatINR } from "@/lib/admin-formatting";
import type { AdminOrderRow, AdminSubscriptionRow } from "@/lib/admin-shared";
import {
  ALL_DAYS,
  parseDayParam,
  parseRangeParams,
  type DaySelection,
} from "@/lib/day-filter";
import {
  addressMatchesArea,
  localityNameMatchesAddress,
  normaliseLocalityKey,
  ZONE_AREAS,
  ZONE_LABELS,
  EMPTY_RULE_SET,
  type NumberedZone,
  type ZoneKey,
  type ZoneRuleSet,
} from "@/lib/delivery-zones";
import {
  buildRuleSet,
  isNumberedZone,
  type ZoneRowOverrideRow,
} from "@/lib/zone-rules";
import { mapsLinkFor } from "@/lib/order-share-message";
import { NOTE_BODY_MAX, type OrderNoteRow } from "@/lib/order-notes";
import {
  kitchenDistanceKm,
  orderToDeliveryRow,
  rowMatchesSelection,
  rowStopDate,
  sortByKitchenDistance,
  subscriptionToDeliveryRow,
  totalsForRows,
  type DeliveryRow,
  type DeliverySource,
} from "@/lib/partner-deliveries";
import { productDisplayName, productNameMap } from "@/lib/product-names";
import { fetchAllRules } from "@/lib/zone-rules-client";
import { todayIst } from "@/lib/delivery-slots";
import { telHref, whatsAppHrefWithText } from "@/lib/phone-utils";

const CREAM = "#FBF3D4";
const MUTED = "rgba(251,243,212,0.65)";
const FAINT = "rgba(251,243,212,0.45)";
const BORDER = "rgba(251,243,212,0.25)";

/** The five groups the board offers, in driving order. `pickup` is
 *  deliberately absent — see the pickup note rendered under the totals. */
const PICKABLE_ZONES: readonly ZoneKey[] = [
  "zone1",
  "zone2",
  "zone3",
  "zone4",
  "unzoned",
];

/** A group selection. `area: null` means the whole zone. */
type Pick = { zone: ZoneKey; area: string | null };

/** The sentinel area for "in this zone, but no locality in ZONE_DEFS names
 *  it" — a row zoned by pincode, by a learned rule or by a row override.
 *  Offered explicitly because the alternative is rows that are counted in
 *  the zone badge and then unreachable in every menu under it. */
const NO_AREA = "\u0000none";

/** What "Add to List" needs, threaded from the page down to the button. */
type AreaNaming = {
  /** Every locality rule that already exists, normalised key → the zone it
   *  currently points at.
   *
   *  THE ZONE, not just the key. `delivery_zone_rules` is UNIQUE on
   *  (key_type, key_value) and the POST route upserts, so writing a name
   *  that is already on the list REPLACES its zone. The form has to be able
   *  to say which zone it would be replacing, by name, before it does it —
   *  a set of keys can only say "taken", which is not enough to decide
   *  with. Keys, not raw inputs: "P.M. Palem" and "pm palem" normalise to
   *  the same rule and only one of them can exist. */
  localityZones: ReadonlyMap<string, NumberedZone>;
  /** Every row loaded for this source — the population the match count is
   *  measured against. */
  stops: readonly DeliveryRow[];
  onSaved: () => void;
};

/** The id cap /api/admin/notes enforces on a batched *_ids query. */
const NOTES_BATCH = 250;

export default function DeliveriesPage() {
  return (
    <Suspense fallback={<AdminLoading />}>
      <DeliveriesPageInner />
    </Suspense>
  );
}

function AdminLoading() {
  return (
    <div
      style={{
        padding: "2rem",
        color: MUTED,
        fontFamily: "var(--font-body)",
        fontSize: "1rem",
        letterSpacing: "0.05em",
      }}
    >
      Loading…
    </div>
  );
}

function parseUrlInitial(sp: URLSearchParams) {
  const src: DeliverySource =
    sp.get("src") === "subscriptions" ? "subscriptions" : "orders";
  const isRange = sp.get("mode") === "range";
  const { from, to } = parseRangeParams(sp.get("from"), sp.get("to"));
  // A link that carries no date at all opens on TODAY, not on everything.
  // This is a routing board: the default question is "what am I driving
  // now". `Clear` is how the operator asks for everything, and once they
  // have, `date=` is written as the empty string so the link round-trips.
  const rawDate = sp.get("date");
  const day = rawDate === null ? todayIst() : parseDayParam(rawDate);
  const sel: DaySelection = isRange
    ? { mode: "range", from, to }
    : { mode: "day", day };
  const zoneRaw = sp.get("zone");
  const zone = (PICKABLE_ZONES as readonly string[]).includes(zoneRaw ?? "")
    ? (zoneRaw as ZoneKey)
    : null;
  return {
    src,
    sel,
    q: sp.get("q") ?? "",
    pick: zone ? ({ zone, area: sp.get("area") || null } as Pick) : null,
  };
}

function DeliveriesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Parse ONCE. useSearchParams subscribes, and the writeback below would
  // otherwise re-seed initial state on the next tick — the same trap the
  // orders board documents.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const urlInit = useMemo(
    () => parseUrlInitial(new URLSearchParams(searchParams?.toString() ?? "")),
    [],
  );

  const [source, setSource] = useState<DeliverySource>(urlInit.src);
  // `applied` is what the board filters on. `draft` is what the date
  // control shows. They differ only between an edit and Confirm — see the
  // Confirm button for why the date is the one control that does not apply
  // as you type.
  const [applied, setApplied] = useState<DaySelection>(urlInit.sel);
  const [draft, setDraft] = useState<DaySelection>(urlInit.sel);
  const [query, setQuery] = useState(urlInit.q);
  const [pick, setPick] = useState<Pick | null>(urlInit.pick);
  const [openZone, setOpenZone] = useState<ZoneKey | null>(
    urlInit.pick?.zone ?? null,
  );

  const [orders, setOrders] = useState<AdminOrderRow[] | null>(null);
  const [subs, setSubs] = useState<AdminSubscriptionRow[] | null>(null);
  const [rules, setRules] = useState<ZoneRuleSet>(EMPTY_RULE_SET);
  // The raw override rows are kept alongside the derived rule set purely so
  // an already-pinned row can offer "Remove pin" — that needs the override's
  // id, and the ZoneRuleSet only carries id -> zone.
  const [overrideRows, setOverrideRows] = useState<ZoneRowOverrideRow[]>([]);
  const [catalogue, setCatalogue] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- data ---------------------------------------------------------------

  // Rules first and always: a board that renders before they land shows
  // built-in zones for rows that have an override, which is the one way
  // this screen can silently disagree with /admin/orders.
  // Also re-run after an assignment: the popover's onChanged calls this, so
  // the new override is read back from the server rather than patched into
  // local state. A local patch is a second implementation of step 2 of the
  // resolver, and the whole point of this board is that there is only one.
  const loadRules = useCallback(async () => {
    try {
      const res = await fetchAllRules();
      setOverrideRows(res.overrides ?? []);
      setRules(
        res.rules.length + res.overrides.length === 0
          ? EMPTY_RULE_SET
          : buildRuleSet(res.rules, res.overrides),
      );
    } catch {
      // Built-in map only. The board still routes; it just cannot honour
      // learned rules, which is strictly better than not rendering.
    }
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  // The product list for the totals strip. Read from the products table
  // (this feed is `select id, name from products`), never hardcoded — a
  // hardcoded list means a new product silently vanishes from the count.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await adminFetch<{
          products: { id: string; name: string }[];
        }>("/api/admin/products/availability");
        if (!cancelled) setCatalogue(res.products ?? []);
      } catch {
        // productDisplayName falls back to the bundled names.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Each source is fetched the first time it is selected and then kept, so
  // flipping the toggle back and forth is free.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (source === "orders" && orders !== null) return;
      if (source === "subscriptions" && subs !== null) return;
      setLoading(true);
      setError(null);
      try {
        if (source === "orders") {
          const res = await adminFetch<{ orders: AdminOrderRow[] }>(
            "/api/admin/orders",
          );
          if (!cancelled) setOrders(res.orders ?? []);
        } else {
          // ?enrich=1 is what attaches delivery_dates and
          // loaf_counts_by_date — the two server-built fields this board
          // reads instead of re-deriving scheduled_date ?? delivery_date.
          const res = await adminFetch<{
            subscriptions: AdminSubscriptionRow[];
          }>("/api/admin/subscriptions?enrich=1");
          if (!cancelled) setSubs(res.subscriptions ?? []);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, orders, subs]);

  // ---- derivation ---------------------------------------------------------

  const allRows = useMemo<DeliveryRow[]>(() => {
    if (source === "orders") {
      return (orders ?? []).map((o) => orderToDeliveryRow(o, rules));
    }
    return (subs ?? []).map((s) => subscriptionToDeliveryRow(s, rules));
  }, [source, orders, subs, rules]);

  // Date + search. Everything below — the totals, the zone counts and the
  // table — is computed from THIS set, so the numbers on the screen are all
  // answering the same question.
  const inScope = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter(
      (r) =>
        rowMatchesSelection(r, applied) && (!q || r.haystack.includes(q)),
    );
  }, [allRows, applied, query]);

  const pickupCount = useMemo(
    () => inScope.filter((r) => r.zone === "pickup").length,
    [inScope],
  );

  const zoneCounts = useMemo(() => {
    const out = new Map<ZoneKey, number>();
    for (const r of inScope) out.set(r.zone, (out.get(r.zone) ?? 0) + 1);
    return out;
  }, [inScope]);

  /** Rows of one zone, bucketed by area name. A row can name more than one
   *  area in its address; it is listed under each, because a menu that
   *  hides a stop from one of its own names is worse than one that shows it
   *  twice. The table de-duplicates by key, so a stop is never driven twice. */
  const areaCountsByZone = useMemo(() => {
    const out = new Map<ZoneKey, Map<string, number>>();
    for (const zone of PICKABLE_ZONES) {
      const counts = new Map<string, number>();
      const areas =
        zone === "unzoned" ? [] : ZONE_AREAS[zone as NumberedZone] ?? [];
      for (const r of inScope) {
        if (r.zone !== zone) continue;
        let named = false;
        for (const area of areas) {
          if (addressMatchesArea(r.address, area)) {
            counts.set(area, (counts.get(area) ?? 0) + 1);
            named = true;
          }
        }
        if (!named) counts.set(NO_AREA, (counts.get(NO_AREA) ?? 0) + 1);
      }
      out.set(zone, counts);
    }
    return out;
  }, [inScope]);

  // Nearest the kitchen first, unpinned stops last, ties on ref. The sort is
  // applied here — once, over the picked group — so the table renders in
  // driving order and every count below it still counts the same rows.
  const visibleRows = useMemo(() => {
    if (!pick) return [];
    const inZone = inScope.filter((r) => r.zone === pick.zone);
    if (!pick.area) return sortByKitchenDistance(inZone);
    if (pick.area === NO_AREA) {
      const areas =
        pick.zone === "unzoned"
          ? []
          : ZONE_AREAS[pick.zone as NumberedZone] ?? [];
      return sortByKitchenDistance(
        inZone.filter(
          (r) => !areas.some((a) => addressMatchesArea(r.address, a)),
        ),
      );
    }
    return sortByKitchenDistance(
      inZone.filter((r) => addressMatchesArea(r.address, pick.area!)),
    );
  }, [inScope, pick]);

  /** How many of the stops on screen can actually be ordered. Stated rather
   *  than hidden: most addresses are free text with no pin, so the tail of
   *  every list is unsorted and the rider needs to know that the ordering
   *  stops being meaningful partway down. */
  const pinnedCount = useMemo(
    () => visibleRows.filter((r) => kitchenDistanceKm(r) !== null).length,
    [visibleRows],
  );

  /** Everything "Add to List" needs, bundled so the three components between
   *  here and the button pass one prop instead of four.
   *
   *  `stops` is EVERY row loaded for this source, not the filtered set. The
   *  count in the dialog is the only warning an operator gets before a name
   *  like "nagar" takes half the city, and counting it against one day's
   *  stops would make the broadest names look the safest. */
  const naming = useMemo<AreaNaming>(
    () => ({
      localityZones: rules.locality,
      stops: allRows,
      onSaved: () => void loadRules(),
    }),
    [rules, allRows, loadRules],
  );

  // The strip counts exactly what is on screen: the whole filtered set
  // until a group is picked, that group once one is.
  const stripRows = pick ? visibleRows : inScope;
  const totals = useMemo(
    () => totalsForRows(stripRows, applied),
    [stripRows, applied],
  );

  const liveNames = useMemo(() => productNameMap(catalogue), [catalogue]);

  /** Every product in the catalogue, in catalogue order, plus any slug that
   *  turned up in the data without being in it. Zeros are rendered: a
   *  product the baker sees as "0" is information; one that has vanished
   *  from the strip is indistinguishable from one nobody sells. */
  const stripEntries = useMemo(() => {
    const seen = new Set<string>();
    const out: { slug: string; name: string; n: number }[] = [];
    for (const p of catalogue) {
      const slug = String(p.id ?? "").trim().toLowerCase();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push({
        slug,
        name: productDisplayName(slug, liveNames, p.name),
        n: totals[slug] ?? 0,
      });
    }
    for (const slug of Object.keys(totals)) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push({ slug, name: productDisplayName(slug, liveNames), n: totals[slug] });
    }
    return out;
  }, [catalogue, liveNames, totals]);

  // ---- url ----------------------------------------------------------------

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    if (source !== "orders") sp.set("src", source);
    if (applied.mode === "range") {
      sp.set("mode", "range");
      if (applied.from) sp.set("from", applied.from);
      if (applied.to) sp.set("to", applied.to);
    } else {
      // Written even when empty — absent means "no date was chosen", which
      // opens on today, and that is NOT what Clear asked for.
      sp.set("date", applied.day ?? "");
    }
    if (query.trim()) sp.set("q", query.trim());
    if (pick) {
      sp.set("zone", pick.zone);
      if (pick.area) sp.set("area", pick.area);
    }
    return sp.toString();
  }, [source, applied, query, pick]);

  useUrlWriteback("/admin/deliveries", qs);

  // ---- actions ------------------------------------------------------------

  const clearDates = useCallback(() => {
    setDraft(ALL_DAYS);
    setApplied(ALL_DAYS);
  }, []);

  const confirmDates = useCallback(() => setApplied(draft), [draft]);

  const pendingDate = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(applied),
    [draft, applied],
  );

  const choose = useCallback((zone: ZoneKey, area: string | null) => {
    setPick({ zone, area });
  }, []);

  // ---- assignment ---------------------------------------------------------

  // Keyed by DeliveryRow.key, not by the row object: the row is rebuilt from
  // scratch every time the rules refetch, so holding the object would leave
  // the popover describing the zone the row had BEFORE the write it just made.
  const [assignKey, setAssignKey] = useState<string | null>(null);
  const [assignRect, setAssignRect] = useState<DOMRect | null>(null);

  const openAssign = useCallback((row: DeliveryRow, rect: DOMRect) => {
    // Pickups are siphoned at step 1 of the resolver, ahead of the override
    // step, so an override written against one could never fire — the
    // popover would report a success that changes nothing.
    if (row.zone === "pickup") return;
    setAssignKey(row.key);
    setAssignRect(rect);
  }, []);

  const assignRow = useMemo(
    () => (assignKey ? allRows.find((r) => r.key === assignKey) ?? null : null),
    [assignKey, allRows],
  );

  const assignOverride = useMemo(() => {
    if (!assignRow || assignRow.zoneSource !== "row_override") return null;
    return (
      overrideRows.find((o) =>
        assignRow.orderId
          ? o.order_id === assignRow.orderId
          : o.subscription_id === assignRow.subscriptionId,
      ) ?? null
    );
  }, [assignRow, overrideRows]);

  // ---- notes --------------------------------------------------------------

  // Keyed by PARENT id (order or subscription), holding every note that
  // parent has. The per-stop narrowing happens at render, against
  // rowStopDate — keeping the raw rows here means the same fetch serves a
  // subscription whichever of its days the board is showing.
  const [notesByParent, setNotesByParent] = useState<
    Record<string, OrderNoteRow[]>
  >({});

  // Only the rows on screen. The board can hold a few thousand rows across
  // all zones and none of their notes matter until a group is picked.
  // Joined into a string so the effect below re-runs on the CONTENT of the
  // list rather than on the array identity, which changes every render.
  const visibleParentKey = useMemo(
    () =>
      visibleRows
        .map((r) => r.orderId ?? r.subscriptionId ?? "")
        .filter(Boolean)
        .join(","),
    [visibleRows],
  );

  useEffect(() => {
    const ids = visibleParentKey ? visibleParentKey.split(",") : [];
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      const param = source === "orders" ? "order_ids" : "subscription_ids";
      const merged: Record<string, OrderNoteRow[]> = {};
      // /api/admin/notes caps a batch at 250 ids and 400s above it, so a
      // big zone is chunked rather than silently returning no notes.
      for (let i = 0; i < ids.length; i += NOTES_BATCH) {
        const chunk = ids.slice(i, i + NOTES_BATCH);
        try {
          const res = await adminFetch<{
            notesByOwnerId: Record<string, OrderNoteRow[]>;
          }>(`/api/admin/notes?${param}=${chunk.join(",")}`);
          Object.assign(merged, res.notesByOwnerId ?? {});
        } catch {
          // Notes are an overlay on a routing list. A failure here leaves
          // the cells empty; it must not take the stops down with it.
        }
      }
      if (!cancelled) setNotesByParent((prev) => ({ ...prev, ...merged }));
    })();
    return () => {
      cancelled = true;
    };
  }, [visibleParentKey, source]);

  // Append one note. No `author` — see the attribution note in the header.
  // The row returned by the POST is merged in rather than refetched: the
  // endpoint returns the inserted row, so a refetch would be a second round
  // trip to learn what we were just told.
  const saveNote = useCallback(
    async (row: DeliveryRow, stopDate: string, body: string) => {
      const parentId = row.orderId ?? row.subscriptionId;
      if (!parentId) return;
      const res = await adminFetch<{ note: OrderNoteRow }>(
        "/api/admin/notes",
        {
          method: "POST",
          body: JSON.stringify({
            ...(row.orderId
              ? { order_id: row.orderId }
              : { subscription_id: row.subscriptionId }),
            body,
            stop_date: stopDate,
          }),
        },
      );
      setNotesByParent((prev) => ({
        ...prev,
        [parentId]: [...(prev[parentId] ?? []), res.note],
      }));
    },
    [],
  );

  return (
    <AdminShell
      title="Online / Deliveries"
      subtitle="Today's stops, grouped by zone then area. Long-press a stop to pin its zone."
    >
      <div
        style={{
          padding: "0.75rem",
          maxWidth: "72rem",
          margin: "0 auto",
          // The board's phone-width contract in one line: nothing inside
          // may widen the page. Every child that could (the table, the
          // address text) also carries its own minWidth: 0 / word-break.
          overflowX: "hidden",
        }}
      >
        {/* ── Controls ──────────────────────────────────────────────── */}
        <section style={panelStyle}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
              alignItems: "flex-end",
            }}
          >
            <DayFilter
              idPrefix="deliveries"
              // No basis selector: a subscription's days come from its
              // delivery stops and there is no order-date axis to offer.
              day={draft.mode === "day" ? draft.day : null}
              onDayChange={(day) => setDraft({ mode: "day", day })}
              mode={draft.mode}
              onModeChange={(mode) =>
                setDraft(
                  mode === "range"
                    ? { mode: "range", from: null, to: null }
                    : { mode: "day", day: null },
                )
              }
              range={
                draft.mode === "range"
                  ? { from: draft.from, to: draft.to }
                  : { from: null, to: null }
              }
              onRangeChange={(r) => setDraft({ mode: "range", ...r })}
              // This board owns Clear, next to Confirm, because here
              // clearing is an APPLY — see the pair below.
              showClear={false}
            />
          </div>

          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              marginTop: "0.75rem",
              flexWrap: "wrap",
            }}
          >
            <button type="button" onClick={clearDates} style={ghostButton}>
              Clear
            </button>
            {/* The date is the only control that waits for a confirm. It is
                the one an operator edits in two or three steps (mode, then
                From, then To), and re-filtering between those steps shows
                lists nobody asked for. */}
            <button
              type="button"
              onClick={confirmDates}
              style={{
                ...ghostButton,
                borderColor: pendingDate ? CREAM : BORDER,
                color: pendingDate ? CREAM : MUTED,
              }}
            >
              Confirm
            </button>
            <span
              style={{
                alignSelf: "center",
                fontFamily: "var(--font-body)",
                fontSize: "0.72rem",
                letterSpacing: "0.08em",
                color: pendingDate ? CREAM : MUTED,
              }}
            >
              {pendingDate ? "Not applied yet" : describeSelection(applied)}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              marginTop: "0.75rem",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, phone, address, OLF/OLS"
              aria-label="Search deliveries"
              style={{
                flex: "1 1 180px",
                minWidth: 0,
                padding: "0.5rem 0.6rem",
                border: `1px solid ${BORDER}`,
                background: "transparent",
                color: CREAM,
                fontFamily: "var(--font-body)",
                fontSize: "0.85rem",
              }}
            />
            <div style={{ display: "inline-flex", flex: "0 0 auto" }}>
              {(["orders", "subscriptions"] as DeliverySource[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  aria-pressed={source === s}
                  className="uppercase"
                  style={{
                    padding: "0.5rem 0.7rem",
                    border: `1px solid ${source === s ? CREAM : BORDER}`,
                    marginLeft: s === "subscriptions" ? "-1px" : 0,
                    background: "transparent",
                    color: source === s ? CREAM : MUTED,
                    fontFamily: "var(--font-body)",
                    fontSize: "0.7rem",
                    letterSpacing: "0.12em",
                    cursor: "pointer",
                  }}
                >
                  {s === "orders" ? "Orders" : "Subs"}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── Product totals ────────────────────────────────────────── */}
        <section style={{ ...panelStyle, marginTop: "0.75rem" }}>
          <div style={sectionLabel}>
            {pick
              ? `Loaves — ${ZONE_LABELS[pick.zone]}${
                  pick.area ? ` · ${areaLabel(pick.area)}` : ""
                }`
              : "Loaves — all zones + pickup"}
          </div>
          {loading && allRows.length === 0 ? (
            <div style={{ color: MUTED, fontSize: "0.85rem" }}>Loading…</div>
          ) : (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.5rem",
                marginTop: "0.5rem",
              }}
            >
              {stripEntries.map((e) => (
                <span
                  key={e.slug}
                  style={{
                    border: `1px solid ${BORDER}`,
                    padding: "0.3rem 0.55rem",
                    color: e.n > 0 ? CREAM : MUTED,
                    fontFamily: "var(--font-body)",
                    fontSize: "0.78rem",
                    letterSpacing: "0.04em",
                  }}
                >
                  {e.name} · <strong>{e.n}</strong>
                </span>
              ))}
              {/* Only when nothing is picked. Once a group is chosen the
                  table header states the same count as "stops", and one
                  number under two words on one screen reads as two facts.
                  "rows" is the right word HERE because this set still
                  includes the pickups, which are baked but not driven. */}
              {pick ? null : (
                <span
                  style={{
                    alignSelf: "center",
                    color: MUTED,
                    fontFamily: "var(--font-body)",
                    fontSize: "0.72rem",
                    letterSpacing: "0.06em",
                  }}
                >
                  {stripRows.length} row{stripRows.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
          {/* Requirement: the partner must never wonder where the pickups
              went. resolveZoneWithSource siphons them at step 1, before any
              rule or map, so they cannot appear under a zone. Stated here
              with a live count rather than left to be noticed. */}
          <p
            style={{
              margin: "0.6rem 0 0",
              color: MUTED,
              fontFamily: "var(--font-body)",
              fontSize: "0.72rem",
              lineHeight: 1.5,
              letterSpacing: "0.04em",
            }}
          >
            Pickup · {pickupCount} — collected at the counter, not driven.
            Pickups are taken out at the first step of zone resolution, so
            they never appear under Zones 1–4 or Unzoned.
          </p>
        </section>

        {error ? (
          <p
            style={{
              ...panelStyle,
              marginTop: "0.75rem",
              color: "#EF4444",
              fontFamily: "var(--font-body)",
              fontSize: "0.85rem",
            }}
          >
            {error}
          </p>
        ) : null}

        {/* ── Zones ─────────────────────────────────────────────────── */}
        <section style={{ ...panelStyle, marginTop: "0.75rem" }}>
          <div style={sectionLabel}>Zones</div>
          <div style={{ marginTop: "0.5rem" }}>
            {PICKABLE_ZONES.map((zone) => {
              const total = zoneCounts.get(zone) ?? 0;
              const counts = areaCountsByZone.get(zone) ?? new Map();
              const areas =
                zone === "unzoned"
                  ? []
                  : ZONE_AREAS[zone as NumberedZone] ?? [];
              const open = openZone === zone;
              return (
                <div key={zone} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenZone(open ? null : zone);
                      // Tapping the zone header selects the whole zone, so
                      // one tap already yields a list. Choosing an area
                      // narrows it; there is no state in which the operator
                      // has opened something and sees nothing.
                      choose(zone, null);
                    }}
                    aria-expanded={open}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                      padding: "0.7rem 0.1rem",
                      background: "transparent",
                      border: "none",
                      color: CREAM,
                      cursor: "pointer",
                      fontFamily: "var(--font-body)",
                      fontSize: "0.9rem",
                      letterSpacing: "0.1em",
                      textAlign: "left",
                    }}
                  >
                    <span className="uppercase">{ZONE_LABELS[zone]}</span>
                    <span style={{ color: MUTED, fontSize: "0.8rem" }}>
                      {total} · {open ? "▲" : "▼"}
                    </span>
                  </button>
                  {open ? (
                    <div
                      data-lenis-prevent
                      style={{
                        // Sized for a phone: about six rows, then it
                        // scrolls inside itself rather than pushing the
                        // table off the bottom of the screen.
                        maxHeight: "14rem",
                        overflowY: "auto",
                        WebkitOverflowScrolling: "touch",
                        paddingBottom: "0.5rem",
                      }}
                    >
                      {zone === "unzoned" ? (
                        <p style={emptyMenuStyle}>
                          Unzoned rows are unzoned precisely because no area
                          name matched them, so there is nothing to pick.
                          Showing all {total}.
                        </p>
                      ) : null}
                      {zone !== "unzoned"
                        ? [
                            ...areas.map((a) => ({
                              value: a,
                              label: a,
                              n: counts.get(a) ?? 0,
                            })),
                            {
                              value: NO_AREA,
                              label: areaLabel(NO_AREA),
                              n: counts.get(NO_AREA) ?? 0,
                            },
                          ]
                            .filter((o) => o.value !== NO_AREA || o.n > 0)
                            .map((o) => {
                              const active =
                                pick?.zone === zone && pick.area === o.value;
                              return (
                                <button
                                  key={o.value}
                                  type="button"
                                  onClick={() => choose(zone, o.value)}
                                  style={{
                                    width: "100%",
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: "0.5rem",
                                    padding: "0.55rem 0.5rem",
                                    background: "transparent",
                                    border: `1px solid ${
                                      active ? CREAM : "transparent"
                                    }`,
                                    color: o.n > 0 ? CREAM : FAINT,
                                    cursor: "pointer",
                                    fontFamily: "var(--font-body)",
                                    fontSize: "0.85rem",
                                    textAlign: "left",
                                  }}
                                >
                                  <span>{o.label}</span>
                                  <span style={{ color: MUTED }}>{o.n}</span>
                                </button>
                              );
                            })
                        : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Table ─────────────────────────────────────────────────── */}
        {pick ? (
          <section style={{ ...panelStyle, marginTop: "0.75rem" }}>
            <div style={sectionLabel}>
              {ZONE_LABELS[pick.zone]}
              {pick.area ? ` · ${areaLabel(pick.area)}` : ""} —{" "}
              {visibleRows.length} stop{visibleRows.length === 1 ? "" : "s"}
            </div>
            {/* The gesture is invisible otherwise. The zone pill is the
                keyboard/assistive route to the same popover. */}
            <p
              style={{
                margin: "0.35rem 0 0",
                color: FAINT,
                fontFamily: "var(--font-body)",
                fontSize: "0.7rem",
                letterSpacing: "0.04em",
              }}
            >
              Long-press or double-tap a stop — or tap its zone pill — to pin
              it to a zone. Pins apply to that stop only. Tap a Note to write
              one; notes are kept against that day&apos;s stop.
              {visibleRows.length > 0 ? (
                <>
                  {" "}
                  Ordered nearest the kitchen first, straight-line —{" "}
                  {pinnedCount} of {visibleRows.length} stop
                  {visibleRows.length === 1 ? " has" : "s have"} a map pin; the
                  rest have no location and are listed last, by order ID.
                </>
              ) : null}
            </p>
            {visibleRows.length === 0 ? (
              <p style={{ ...emptyMenuStyle, padding: "0.75rem 0" }}>
                Nothing here for this date and search.
              </p>
            ) : (
              <DeliveryTable
                rows={visibleRows}
                sel={applied}
                notesByParent={notesByParent}
                onAssign={openAssign}
                naming={naming}
                onSaveNote={saveNote}
              />
            )}
          </section>
        ) : (
          <p
            style={{
              ...panelStyle,
              marginTop: "0.75rem",
              color: MUTED,
              fontFamily: "var(--font-body)",
              fontSize: "0.82rem",
              lineHeight: 1.5,
            }}
          >
            Pick a zone, then an area, to see the stops.
          </p>
        )}
      </div>

      {/* ruleKey is hardcoded null, which forces the popover into ROW-PIN
          mode. Still deliberate: this gesture must stay per-stop. Pinning
          one address cannot re-zone another that merely looks similar, and
          an operator long-pressing a row is fixing THAT row. Naming an area
          is now possible and is a separate, explicit gesture on the address
          with its own match count — see "Add to List". */}
      {assignRow ? (
        <ZoneAssignPopover
          open
          onClose={() => setAssignKey(null)}
          currentZone={assignRow.zone}
          resolution={{ zone: assignRow.zone, source: assignRow.zoneSource }}
          target={
            assignRow.orderId
              ? { kind: "order", id: assignRow.orderId }
              : { kind: "subscription", id: assignRow.subscriptionId! }
          }
          ruleKey={null}
          existingOverrideId={assignOverride?.id ?? null}
          onChanged={() => void loadRules()}
          anchorRect={assignRect}
          rowPinNote={
            <>
              Pins {assignRow.ref} to a zone. This stop only — no other
              address moves, and nothing is learned for future orders.
              {assignOverride ? (
                <>
                  {" "}
                  Currently pinned, last changed{" "}
                  {formatStamp(assignOverride.updated_at)}. Who made that
                  change is not recorded — this admin has no per-user
                  accounts.
                </>
              ) : null}
            </>
          }
        />
      ) : null}
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

const COLUMNS = [
  "Order ID",
  "Customer",
  "Address",
  "Zone",
  "Payment",
  "Total",
  "Note",
] as const;

type SaveNote = (
  row: DeliveryRow,
  stopDate: string,
  body: string,
) => Promise<void>;

function DeliveryTable({
  rows,
  sel,
  notesByParent,
  onAssign,
  naming,
  onSaveNote,
}: {
  rows: readonly DeliveryRow[];
  sel: DaySelection;
  notesByParent: Record<string, OrderNoteRow[]>;
  onAssign: (row: DeliveryRow, rect: DOMRect) => void;
  naming: AreaNaming;
  onSaveNote: SaveNote;
}) {
  return (
    <table
      style={{
        width: "100%",
        tableLayout: "fixed",
        borderCollapse: "collapse",
        marginTop: "0.5rem",
      }}
    >
      {/* `table-layout: fixed` + these widths is what keeps seven columns
          inside the viewport instead of letting a long address push the
          table wider than the page. */}
      <colgroup className="hidden md:table-column-group">
        <col style={{ width: "9%" }} />
        <col style={{ width: "17%" }} />
        <col style={{ width: "28%" }} />
        <col style={{ width: "10%" }} />
        <col style={{ width: "10%" }} />
        <col style={{ width: "10%" }} />
        <col style={{ width: "16%" }} />
      </colgroup>
      <thead className="hidden md:table-header-group">
        <tr>
          {COLUMNS.map((c) => (
            <th
              key={c}
              scope="col"
              className="uppercase"
              style={{
                textAlign: "left",
                padding: "0.4rem 0.35rem",
                borderBottom: `1px solid ${BORDER}`,
                color: MUTED,
                fontFamily: "var(--font-body)",
                fontSize: "0.68rem",
                letterSpacing: "0.14em",
                fontWeight: 400,
              }}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="block md:table-row-group">
        {rows.map((r) => (
          <DeliveryTableRow
            key={r.key}
            row={r}
            stopDate={rowStopDate(r, sel)}
            notes={notesByParent[r.orderId ?? r.subscriptionId ?? ""] ?? EMPTY_NOTES}
            onAssign={onAssign}
            naming={naming}
            onSaveNote={onSaveNote}
          />
        ))}
      </tbody>
    </table>
  );
}

/** Long-press delay. 500ms is the platform convention for a context press
 *  on both iOS and Android; shorter fires while the rider is still scrolling. */
const LONG_PRESS_MS = 500;
/** A press that travels further than this is a scroll, not a press. */
const LONG_PRESS_SLOP_PX = 10;

/** Shared empty array — a fresh `[]` per render would change the prop
 *  identity on every row that has no notes yet. */
const EMPTY_NOTES: readonly OrderNoteRow[] = [];

function DeliveryTableRow({
  row: r,
  stopDate,
  notes,
  onAssign,
  naming,
  onSaveNote,
}: {
  row: DeliveryRow;
  stopDate: string | null;
  notes: readonly OrderNoteRow[];
  onAssign: (row: DeliveryRow, rect: DOMRect) => void;
  naming: AreaNaming;
  onSaveNote: SaveNote;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  // The row already contains real links and buttons — the phone number,
  // WhatsApp, Map, Share, the Add-to-List box and the note box. A press that
  // lands on one of those belongs to it.
  //
  // The list is a UNION and every entry earns its place, because each text
  // field on this row is a different element type and neither is an <a> or a
  // <button>. `input`/`form`/`label` keep a long press while typing an area
  // name from opening the zone popover over the dialog; `textarea` does the
  // same for the note box, where resting a finger for half a second — or
  // double-clicking to select a word — would otherwise pop the zone menu over
  // the words being typed. Dropping either half silently breaks that half's
  // text entry, so this selector must only ever grow.
  const onInteractiveTarget = (e: { target: EventTarget | null }) =>
    e.target instanceof Element &&
    e.target.closest("a,button,input,form,label,textarea") !== null;

  return (
    <tr
      className="block md:table-row"
      style={{
        borderTop: `1px solid ${BORDER}`,
        // Suppresses the iOS "copy / look up" callout that a long press
        // would otherwise raise on top of the popover.
        WebkitTouchCallout: "none",
      }}
      onPointerDown={(e) => {
        if (onInteractiveTarget(e)) return;
        fired.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        const rect = e.currentTarget.getBoundingClientRect();
        timer.current = setTimeout(() => {
          fired.current = true;
          onAssign(r, rect);
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        if (
          Math.abs(e.clientX - s.x) > LONG_PRESS_SLOP_PX ||
          Math.abs(e.clientY - s.y) > LONG_PRESS_SLOP_PX
        ) {
          cancel();
        }
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => {
        // Android raises the native context menu at the same moment the
        // long press completes; without this it covers the popover.
        if (fired.current) e.preventDefault();
      }}
      onDoubleClick={(e) => {
        if (onInteractiveTarget(e)) return;
        onAssign(r, e.currentTarget.getBoundingClientRect());
      }}
    >
      <Cell label="Order ID">
        <span style={{ letterSpacing: "0.06em" }}>{r.ref}</span>
      </Cell>
      <Cell label="Customer">
        <div style={{ wordBreak: "break-word" }}>{r.customerName ?? "—"}</div>
        {r.phone ? <PhoneActions row={r} /> : null}
      </Cell>
      <Cell label="Address">
        <div style={{ wordBreak: "break-word", lineHeight: 1.45 }}>
          {r.address || "—"}
        </div>
        {r.address ? <AddressActions row={r} naming={naming} /> : null}
      </Cell>
      <Cell label="Zone">
        {/* Same popover, reachable by a plain tap and by the keyboard. The
            gesture is the phone affordance; this is the accessible one, and
            it is how /admin/orders already opens it. */}
        <ZoneBadge
          zone={r.zone}
          source={r.zoneSource}
          compact
          onClick={(e) => {
            e.stopPropagation();
            onAssign(r, (e.currentTarget as HTMLElement).getBoundingClientRect());
          }}
        />
      </Cell>
      <Cell label="Payment">{r.paymentMode}</Cell>
      <Cell label="Total">{formatINR(r.totalInr)}</Cell>
      <Cell label="Note">
        <NoteCell
          row={r}
          stopDate={stopDate}
          notes={notes}
          onSaveNote={onSaveNote}
        />
      </Cell>
    </tr>
  );
}

/**
 * The Note cell: what is written about THIS stop, and the box to write more.
 *
 * `stopDate` is the day the note binds to, from rowStopDate — null when the
 * current filter spans more than one of a subscription's stops. In that
 * state the cell reads and writes NOTHING and says why: showing a note
 * without knowing which stop it is about is how a plan-level note ends up
 * greeting the partner on every future drop.
 */
function NoteCell({
  row,
  stopDate,
  notes,
  onSaveNote,
}: {
  row: DeliveryRow;
  stopDate: string | null;
  notes: readonly OrderNoteRow[];
  onSaveNote: SaveNote;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An order is one stop on one day, so a note carrying NO stop_date — which
  // is every note /admin/orders has ever written about it — is still a note
  // about this stop, and is shown. A subscription's is not: a plan-level
  // note belongs to the plan, and rendering it here would put it on all
  // eight stops, which is precisely what stop_date exists to prevent.
  const stopNotes = useMemo(() => {
    if (!stopDate) return EMPTY_NOTES;
    return notes.filter((n) =>
      row.source === "orders"
        ? n.stop_date === stopDate || n.stop_date == null
        : n.stop_date === stopDate,
    );
  }, [notes, row.source, stopDate]);

  // Oldest-first from the batch endpoint, and the POST appends, so the last
  // entry is the newest.
  const latest = stopNotes.length > 0 ? stopNotes[stopNotes.length - 1] : null;

  if (!stopDate) {
    return (
      <span style={{ color: FAINT, fontSize: "0.7rem", lineHeight: 1.45 }}>
        {row.dates.length === 0
          ? "No delivery day yet — nothing to note against."
          : `${row.dates.length} stops in view — pick one day to read or write its note.`}
      </span>
    );
  }
  // Re-bound so the closures below carry the narrowed type.
  const day = stopDate;

  const save = async () => {
    const body = draft.trim();
    if (!body) {
      setError("Write something first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSaveNote(row, day, body);
      setEditing(false);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, NOTE_BODY_MAX))}
          rows={3}
          autoFocus
          aria-label={`Note for ${row.ref} on ${day}`}
          style={{
            width: "100%",
            minWidth: 0,
            resize: "vertical",
            padding: "0.4rem",
            border: `1px solid ${BORDER}`,
            background: "transparent",
            color: CREAM,
            fontFamily: "var(--font-body)",
            fontSize: "0.8rem",
            lineHeight: 1.4,
          }}
        />
        <div
          style={{
            display: "flex",
            gap: "0.35rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            style={{ ...miniAction, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            style={miniAction}
          >
            Cancel
          </button>
          <span style={{ color: FAINT, fontSize: "0.65rem" }}>
            {draft.trim().length}/{NOTE_BODY_MAX}
          </span>
        </div>
        {error ? (
          <span style={{ color: "#EF4444", fontSize: "0.68rem", lineHeight: 1.4 }}>
            {error}
          </span>
        ) : null}
        {/* Both facts an operator needs before pressing Save: which day this
            lands on, and that Save adds rather than overwrites. */}
        <span style={{ color: FAINT, fontSize: "0.65rem", lineHeight: 1.45 }}>
          Kept against {day}. Saving adds to the trail — earlier notes are
          never replaced.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
      {latest ? (
        <>
          <span style={{ wordBreak: "break-word", lineHeight: 1.45 }}>
            {latest.body}
          </span>
          {/* WHAT and WHEN only. There is no per-user account behind this
              board, so `author` is written NULL and there is nothing
              truthful to put in a "by" slot. */}
          <span style={{ color: FAINT, fontSize: "0.65rem", lineHeight: 1.45 }}>
            {formatStamp(latest.created_at)} · who wrote it is not recorded
            {stopNotes.length > 1
              ? ` · ${stopNotes.length - 1} earlier kept`
              : ""}
          </span>
        </>
      ) : null}
      <button
        type="button"
        onClick={() => {
          // Prefilled with the latest note so a correction is a small edit,
          // not a retype. It still SAVES AS A NEW ROW — the endpoint has no
          // PATCH — which is why the edit view says so.
          setDraft(latest?.body ?? "");
          setError(null);
          setEditing(true);
        }}
        style={{ ...miniAction, alignSelf: "flex-start" }}
      >
        {latest ? "Edit" : "Add note"}
      </button>
    </div>
  );
}

/** One cell. Below `md` it is a block with its own visible label, which is
 *  what lets the same markup be a stacked card on a phone and a real table
 *  row on a laptop. */
function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <td
      className="block md:table-cell"
      style={{
        padding: "0.35rem",
        verticalAlign: "top",
        color: CREAM,
        fontFamily: "var(--font-body)",
        fontSize: "0.82rem",
        minWidth: 0,
      }}
    >
      <span
        className="md:hidden uppercase"
        style={{
          display: "block",
          color: MUTED,
          fontSize: "0.62rem",
          letterSpacing: "0.14em",
          marginBottom: "0.1rem",
        }}
      >
        {label}
      </span>
      {children}
    </td>
  );
}

function PhoneActions({ row }: { row: DeliveryRow }) {
  const phone = row.phone ?? "";
  // One number, two uses — the phone column doubles as the WhatsApp number.
  const wa = whatsAppHrefWithText(
    phone,
    `Cadieux delivery for ${row.ref}. On the way.`,
  );
  return (
    <div style={{ marginTop: "0.25rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
      <a href={telHref(phone)} style={miniAction}>
        {phone}
      </a>
      {wa ? (
        <a href={wa} target="_blank" rel="noopener noreferrer" style={miniAction}>
          WhatsApp
        </a>
      ) : null}
    </div>
  );
}

function AddressActions({
  row,
  naming,
}: {
  row: DeliveryRow;
  naming: AreaNaming;
}) {
  const [shared, setShared] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const hasPin =
    typeof row.latitude === "number" &&
    typeof row.longitude === "number" &&
    Number.isFinite(row.latitude) &&
    Number.isFinite(row.longitude) &&
    !(row.latitude === 0 && row.longitude === 0);
  // mapsLinkFor gives a pinned link when coords exist and a Maps SEARCH for
  // the address text when they do not. Most rows are the second case:
  // orders.delivery_address is free text and carries no lat/lng. The label
  // says which one this row is getting — "Map" on a search result that lands
  // three streets away is how a rider ends up trusting the wrong thing.
  const url = mapsLinkFor(row.address, row.latitude, row.longitude);

  async function share(e: React.MouseEvent) {
    e.preventDefault();
    const text = `${row.ref} — ${row.address}`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: row.ref, text });
        return;
      }
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setShared("Copied");
        setTimeout(() => setShared(null), 1500);
      }
    } catch {
      // A dismissed share sheet rejects. Nothing to report.
    }
  }

  // `pickup` is siphoned off at step 1, before any rule is consulted, so a
  // locality rule for a pickup address would be written and never read. The
  // action is still offered and refuses with the reason, rather than
  // disappearing from some rows with no explanation.
  //
  // UNZONED IS NOW ALLOWED. It used to be refused alongside pickup, on the
  // grounds that the form inherited the row's zone and an unzoned row has
  // none to inherit. That was a property of the old form, not of the data:
  // the zone is now chosen, and an unzoned stop is precisely the one whose
  // area most needs naming — refusing it sent the operator to pin the row
  // first, which teaches the resolver nothing about the next order on that
  // street.
  const nameable = row.zone !== "pickup";

  return (
    <>
      <div style={{ marginTop: "0.25rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
        <a href={url} target="_blank" rel="noopener noreferrer" style={miniAction}>
          {hasPin ? "Map (pin)" : "Map (search)"}
        </a>
        <button type="button" onClick={share} style={miniAction}>
          {shared ?? "Share"}
        </button>
        <button
          type="button"
          onClick={() => setListOpen((v) => !v)}
          style={miniAction}
          aria-expanded={listOpen}
        >
          Add to List
        </button>
      </div>
      {listOpen ? (
        nameable ? (
          <AddToListForm
            rowZone={row.zone}
            naming={naming}
            onClose={() => setListOpen(false)}
          />
        ) : (
          <p style={addToListNote}>
            This is a pickup — it never goes through a zone, so naming its
            area would change nothing.{" "}
            <button
              type="button"
              onClick={() => setListOpen(false)}
              style={miniAction}
            >
              Close
            </button>
          </p>
        )
      ) : null}
    </>
  );
}

/** Name an area and point it at a zone.
 *
 *  Writes a LOCALITY RULE — `delivery_zone_rules`, step 4 of the resolver —
 *  not a row override. That is the difference between this and the
 *  long-press: the override pins one stop, this teaches every future order
 *  whose address contains the name. It is the more powerful gesture and the
 *  harder one to undo, which is what the count below the box is for.
 *
 *  THE ZONE IS CHOSEN, NOT INHERITED. It used to be whatever zone the row
 *  under the button happened to be in, which meant naming an area from a
 *  stop that was itself sitting in the wrong zone taught the resolver that
 *  wrong zone — with nothing on screen ever having said which zone was
 *  being written. The row's zone is still the SEED, because it is the best
 *  guess and usually right; the difference is that it is now a visible
 *  starting point the operator can change rather than a value smuggled in
 *  from the row. */
function AddToListForm({
  rowZone,
  naming,
  onClose,
}: {
  /** The stop's own zone. Seeds the chooser and marks which button is this
   *  row's current answer. May be `unzoned`, in which case there is nothing
   *  to seed and Save stays locked until a zone is picked. */
  rowZone: ZoneKey;
  naming: AreaNaming;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [zone, setZone] = useState<NumberedZone | null>(
    isNumberedZone(rowZone) ? rowZone : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const key = normaliseLocalityKey(trimmed);

  // Length is checked on the NORMALISED key, not the raw box: "a.b" is three
  // characters typed and two of substance, and it is the key that does the
  // matching. Three is the floor because two-letter fragments match inside
  // most Telugu place names.
  const tooShort = trimmed.length > 0 && key.length < 3;

  /** The rule this save would REPLACE, if one exists. `delivery_zone_rules`
   *  is UNIQUE on (key_type, key_value) and the POST upserts, so a name
   *  already on the list does not fail and does not create a second rule —
   *  it overwrites the zone of the first. */
  const existingZone =
    key.length >= 3 ? naming.localityZones.get(key) ?? null : null;

  /** The one case that has to be interrupted: the name already exists and
   *  points at a DIFFERENT zone. Saving would re-route every address
   *  containing it, and — without this — would do so with nothing on screen
   *  having said a rule was there at all. The operator would be looking at
   *  one Zone 3 stop while every Vishalakshi order left Zone 1.
   *
   *  An existing rule pointing at the SAME zone is not interrupted: the
   *  write is a no-op on the only column anyone would notice, and a prompt
   *  there would be a prompt with no decision in it. */
  const conflict =
    existingZone !== null && zone !== null && existingZone !== zone;

  /** The confirmation is bound to the exact (name, zone) pair it was given
   *  for, so changing either lapses it. Otherwise a tick meant for "move
   *  Vishalakshi to Zone 3" would still be sitting there authorising
   *  whatever the boxes said by the time Save was pressed. */
  const confirmToken = `${key}\u0000${zone ?? ""}`;
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const confirmed = confirmedFor === confirmToken;

  /** How many loaded stops this name would take, and how many of those are
   *  somewhere else today. The second number is the alarm: a name that only
   *  matches stops already in this zone changes nothing, while one that
   *  matches stops in other zones MOVES them the moment it is saved.
   *
   *  Counted with localityNameMatchesAddress — the resolver's own predicate.
   *  A substring test would be wrong in the direction that matters: it would
   *  count "Nagarampalem" as a hit for "nagar" and so overstate the very
   *  number the operator is reading to decide whether to stop. */
  const preview = useMemo(() => {
    if (key.length < 3) return null;
    let matched = 0;
    let elsewhere = 0;
    for (const s of naming.stops) {
      if (!localityNameMatchesAddress(trimmed, s.address)) continue;
      matched++;
      if (zone !== null && s.zone !== zone) elsewhere++;
    }
    return { matched, elsewhere, total: naming.stops.length };
  }, [key, trimmed, naming.stops, zone]);

  const blocked =
    zone === null || key.length < 3 || saving || (conflict && !confirmed);

  async function save() {
    if (blocked || zone === null) return;
    setSaving(true);
    setError(null);
    try {
      // key_input only — the server normalises it into key_value with the
      // same function this preview used, so the rule that gets written is
      // the rule that was counted.
      await adminFetch("/api/admin/zone-rules", {
        method: "POST",
        body: JSON.stringify({
          key_type: "locality",
          key_input: trimmed,
          zone,
        }),
      });
      naming.onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      style={{
        marginTop: "0.4rem",
        padding: "0.5rem",
        border: `1px solid ${BORDER}`,
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
      }}
    >
      <label style={{ ...sectionLabel, fontSize: "0.62rem" }}>
        Area name
      </label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        autoFocus
        placeholder="e.g. Kapuluppada"
        style={{
          padding: "0.35rem 0.4rem",
          border: `1px solid ${BORDER}`,
          background: "transparent",
          color: CREAM,
          fontFamily: "var(--font-body)",
          fontSize: "0.8rem",
          minWidth: 0,
        }}
      />
      {/* The zone this name will point at. Same four buttons, same array
          and the same two-column shape as ZoneAssignPopover, because they
          are the same decision reached by a different route — an operator
          who has learned one should not have to learn the other. */}
      <div
        role="group"
        aria-label="Zone this area belongs to"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.3rem",
        }}
      >
        {NUMBERED_ZONES.map((z) => {
          const isRowZone = z === rowZone;
          const isChosen = z === zone;
          return (
            <button
              key={z}
              type="button"
              onClick={() => setZone(z)}
              aria-pressed={isChosen}
              style={{
                ...miniAction,
                justifyContent: "space-between",
                padding: "0.25rem 0.4rem",
                border: `1px solid ${isChosen ? CREAM : BORDER}`,
                background: isRowZone ? "rgba(251,243,212,0.06)" : "transparent",
              }}
            >
              {ZONE_LABELS[z]}
              {isRowZone ? " · this stop" : ""}
            </button>
          );
        })}
      </div>
      <p style={addToListNote}>
        {tooShort
          ? "Too short — use at least 3 letters."
          : zone === null
            ? "This stop has no zone yet, so there is nothing to start from — pick the zone this area belongs to."
            : preview
              ? preview.matched === 0
                ? `Matches none of the ${preview.total} loaded stop${
                    preview.total === 1 ? "" : "s"
                  }. Nothing on screen moves — the rule only applies to future addresses containing this name.`
                : `Matches ${preview.matched} of ${preview.total} loaded stop${
                    preview.total === 1 ? "" : "s"
                  }${
                    preview.elsewhere > 0
                      ? ` — ${preview.elsewhere} of them ${
                          preview.elsewhere === 1 ? "is" : "are"
                        } in another zone today and will move to ${ZONE_LABELS[zone]}.`
                      : `, all already in ${ZONE_LABELS[zone]}.`
                  }`
              : "Every future address containing this name goes to the zone above."}
      </p>
      {conflict && existingZone && zone ? (
        <label
          style={{
            ...addToListNote,
            display: "flex",
            gap: "0.4rem",
            alignItems: "flex-start",
            color: "#F59E0B",
          }}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) =>
              setConfirmedFor(e.target.checked ? confirmToken : null)
            }
            style={{ marginTop: "0.15rem" }}
          />
          <span>
            &ldquo;{trimmed}&rdquo; is already on the list, pointing at{" "}
            {ZONE_LABELS[existingZone]}. Saving REPLACES that — every address
            containing this name moves to {ZONE_LABELS[zone]}, not just the
            stops loaded here. Tick to confirm you mean to move it.
          </span>
        </label>
      ) : null}
      {error ? (
        <p style={{ ...addToListNote, color: "#EF4444" }}>{error}</p>
      ) : null}
      <div style={{ display: "flex", gap: "0.35rem" }}>
        <button
          type="submit"
          disabled={blocked}
          style={{ ...miniAction, opacity: blocked ? 0.4 : 1 }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onClose} style={miniAction}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const addToListNote: React.CSSProperties = {
  margin: 0,
  color: MUTED,
  fontFamily: "var(--font-body)",
  fontSize: "0.68rem",
  lineHeight: 1.45,
};

// ---------------------------------------------------------------------------
// Small helpers + shared styles
// ---------------------------------------------------------------------------

function areaLabel(area: string): string {
  // "No area named" read as a statement about the WORLD — as though these
  // stops were somewhere nameless. They are not: the board simply has no
  // name on file for them, which is a gap in the list and the thing "Add to
  // List" exists to close.
  return area === NO_AREA ? "No name given" : area;
}

/** WHEN a pin was last changed, in IST. Deliberately the only provenance
 *  this board shows: the override row's `created_by` is a placeholder the
 *  API route writes, not a person, and rendering it would imply an
 *  attribution that does not exist on this admin surface. */
function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "at an unknown time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "at an unknown time";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function describeSelection(sel: DaySelection): string {
  if (sel.mode === "day") return sel.day ? sel.day : "All dates";
  if (!sel.from && !sel.to) return "All dates";
  return `${sel.from ?? "any"} → ${sel.to ?? "any"}`;
}

const panelStyle: React.CSSProperties = {
  border: `1px solid ${BORDER}`,
  padding: "0.75rem",
  minWidth: 0,
};

const sectionLabel: React.CSSProperties = {
  color: MUTED,
  fontFamily: "var(--font-body)",
  fontSize: "0.7rem",
  letterSpacing: "0.15em",
  textTransform: "uppercase",
};

const ghostButton: React.CSSProperties = {
  padding: "0.45rem 0.9rem",
  border: `1px solid ${BORDER}`,
  background: "transparent",
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: "0.72rem",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const emptyMenuStyle: React.CSSProperties = {
  margin: 0,
  padding: "0.5rem",
  color: MUTED,
  fontFamily: "var(--font-body)",
  fontSize: "0.78rem",
  lineHeight: 1.5,
};

const miniAction: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.15rem 0.4rem",
  border: `1px solid ${BORDER}`,
  background: "transparent",
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: "0.7rem",
  letterSpacing: "0.04em",
  textDecoration: "none",
  cursor: "pointer",
};
