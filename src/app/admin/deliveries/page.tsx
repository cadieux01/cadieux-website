"use client";

// Online / Deliveries — the routing view. STAGE 1: read-only.
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
// STAGES 2 AND 3 (zone assignment, notes) are not built. Nothing here
// designs them out: the Note column exists and renders empty, zone
// provenance is carried on every row, and the parent ids an override would
// be written against are on DeliveryRow already.

import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { DayFilter } from "@/components/admin/DayFilter";
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
  ZONE_AREAS,
  ZONE_LABELS,
  EMPTY_RULE_SET,
  type NumberedZone,
  type ZoneKey,
  type ZoneRuleSet,
} from "@/lib/delivery-zones";
import { buildRuleSet } from "@/lib/zone-rules";
import { mapsLinkFor } from "@/lib/order-share-message";
import {
  orderToDeliveryRow,
  rowMatchesSelection,
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
  const [catalogue, setCatalogue] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- data ---------------------------------------------------------------

  // Rules first and always: a board that renders before they land shows
  // built-in zones for rows that have an override, which is the one way
  // this screen can silently disagree with /admin/orders.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchAllRules();
        if (!cancelled) {
          setRules(
            res.rules.length + res.overrides.length === 0
              ? EMPTY_RULE_SET
              : buildRuleSet(res.rules, res.overrides),
          );
        }
      } catch {
        // Built-in map only. The board still routes; it just cannot honour
        // learned rules, which is strictly better than not rendering.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const visibleRows = useMemo(() => {
    if (!pick) return [];
    const inZone = inScope.filter((r) => r.zone === pick.zone);
    if (!pick.area) return inZone;
    if (pick.area === NO_AREA) {
      const areas =
        pick.zone === "unzoned"
          ? []
          : ZONE_AREAS[pick.zone as NumberedZone] ?? [];
      return inZone.filter(
        (r) => !areas.some((a) => addressMatchesArea(r.address, a)),
      );
    }
    return inZone.filter((r) => addressMatchesArea(r.address, pick.area!));
  }, [inScope, pick]);

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

  return (
    <AdminShell
      title="Online / Deliveries"
      subtitle="Today's stops, grouped by zone then area. Read-only."
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
            {visibleRows.length === 0 ? (
              <p style={{ ...emptyMenuStyle, padding: "0.75rem 0" }}>
                Nothing here for this date and search.
              </p>
            ) : (
              <DeliveryTable rows={visibleRows} />
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

function DeliveryTable({ rows }: { rows: readonly DeliveryRow[] }) {
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
          <tr
            key={r.key}
            className="block md:table-row"
            style={{ borderTop: `1px solid ${BORDER}` }}
          >
            <Cell label="Order ID">
              <span style={{ letterSpacing: "0.06em" }}>{r.ref}</span>
            </Cell>
            <Cell label="Customer">
              <div style={{ wordBreak: "break-word" }}>
                {r.customerName ?? "—"}
              </div>
              {r.phone ? <PhoneActions row={r} /> : null}
            </Cell>
            <Cell label="Address">
              <div style={{ wordBreak: "break-word", lineHeight: 1.45 }}>
                {r.address || "—"}
              </div>
              {r.address ? <AddressActions row={r} /> : null}
            </Cell>
            <Cell label="Zone">
              <ZoneBadge zone={r.zone} source={r.zoneSource} compact />
            </Cell>
            <Cell label="Payment">{r.paymentMode}</Cell>
            <Cell label="Total">{formatINR(r.totalInr)}</Cell>
            {/* Stage 3. The column is here so the table it lands in is the
                table that shipped, not a seventh column added later. */}
            <Cell label="Note">
              <span style={{ color: FAINT }}>{r.note ?? ""}</span>
            </Cell>
          </tr>
        ))}
      </tbody>
    </table>
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

function AddressActions({ row }: { row: DeliveryRow }) {
  const [shared, setShared] = useState<string | null>(null);
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

  return (
    <div style={{ marginTop: "0.25rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
      <a href={url} target="_blank" rel="noopener noreferrer" style={miniAction}>
        {hasPin ? "Map (pin)" : "Map (search)"}
      </a>
      <button type="button" onClick={share} style={miniAction}>
        {shared ?? "Share"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers + shared styles
// ---------------------------------------------------------------------------

function areaLabel(area: string): string {
  return area === NO_AREA ? "No area named" : area;
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
