"use client";

// /mkt — marketing workspace, first screen is the CRM.
//
// LIGHT SURFACE, NOT THE ADMIN SHELL. /admin is dark + austere; /mkt
// is cream on brand. We use MktShell (cream chrome, DM Sans) rather
// than AdminShell. The GATE is the same — admin session, same POST
// /api/admin/login — so /mkt remains isAdmin-only and the counter PIN
// cannot reach it (same assertion the tests pin).
//
// Three panes on desktop, stacked on phone. The middle column is the
// point: a last-touch line tells the operator who's gone quiet.
//
// INTERACTIONS pinned here so a reviewer does not have to piece them
// together from the component bodies below:
//   - Segment chips filter INSTANTLY (client-side, no fetch).
//   - Search filters as you type, debounced 150ms, matching name +
//     phone. Counts in the chips update with the search.
//   - Rows have visible hover + pressed states.
//   - Keyboard: ArrowUp / ArrowDown walk the list, Enter opens that
//     person in the right pane, Escape clears the search box.
//   - Right pane is sticky inside the three-pane grid — scrolling
//     the people list cannot scroll the file away.
//   - Timeline bodies longer than 3 lines collapse with a "more"
//     toggle (per-row, not a global expand).
//   - COPY shows an inline "Copied" state for ~1.5s on the button
//     itself, never an alert() or toast.
//   - Loading renders skeleton rows shaped like real ones; no spinner.
//   - Empty vs error are visually distinct (cream dashed vs red
//     outline).
//
// REUSE: list data from /api/admin/customers?with_touch=1, detail
// from /api/admin/customers/[id], both already gated and tested.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { MktShell } from "@/components/mkt/MktShell";
import { MKT } from "@/components/mkt/theme";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import {
  formatDate,
  formatDateTime,
  formatINR,
  telHref,
  whatsAppHref,
} from "@/lib/admin-formatting";
import {
  buildTimeline,
  buildWeekBuckets,
  countTimelineLines,
  KIND_STYLE,
  matchesSegment,
  parseSegment,
  SEGMENT_LABEL,
  SEGMENTS,
  WEEKS,
  type Segment,
  type TimelineItem,
  type WeekBucket,
} from "@/lib/mkt-crm";

// ── Types the two admin routes already return ───────────────────────

type ListRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  created_at: string;
  total_orders: number;
  total_spent: number;
  outstanding_cod: number;
  last_order_at: string | null;
  has_subscription: boolean;
  // cancelled_orders drives the tried_cancelled segment (and the
  // "N cancelled" badge on the row when there are no live orders).
  // The timestamp beside it is the LAST status_updated_at on a
  // cancelled order for this customer — orders.cancelled_at is
  // dead in prod, so the status-change time is the honest signal.
  cancelled_orders: number;
  last_cancelled_status_at: string | null;
  last_touch_at: string | null;
  last_touch_body: string | null;
  last_touch_kind: "note" | "call" | "edit" | "whatsapp" | null;
};

type ListResponse = {
  customers: ListRow[];
  touch_error?: string | null;
};

type OrderRow = {
  id: string;
  order_number?: string | null;
  total_amount: number | null;
  status: string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  delivery_address: string | null;
  created_at: string;
};

type SubRow = {
  id: string;
  product_name: string;
  total_weeks: number;
  status: string;
  payment_status: string;
  total_amount: number;
  created_at: string;
  frequency: string;
};

type NoteRow = {
  id: string;
  kind: string;
  body: string;
  author: string | null;
  created_at: string;
  order_id: string | null;
  subscription_id: string | null;
};

type WaMessage = {
  id: string;
  conversation_id: string;
  direction: string | null;
  body: string | null;
  created_at: string;
};

type WaConversation = {
  id: string;
  phone: string | null;
  status: string | null;
  last_message_at: string | null;
};

type ReviewRow = {
  id: string;
  product_slug: string | null;
  author_name: string | null;
  rating: number | null;
  body: string;
  created_at: string;
  is_deleted: boolean | null;
};

type DetailResponse = {
  customer: ListRow & { email?: string | null };
  orders: OrderRow[];
  subscriptions: SubRow[];
  notes: NoteRow[];
  notes_error: string | null;
  whatsapp: { conversations: WaConversation[]; messages: WaMessage[] };
  whatsapp_error: string | null;
  reviews: ReviewRow[];
  reviews_error: string | null;
};

// ── Page ────────────────────────────────────────────────────────────

export default function MktCrmPage() {
  return (
    <Suspense fallback={null}>
      <MktCrmInner />
    </Suspense>
  );
}

function MktCrmInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [segment, setSegment] = useState<Segment>(() =>
    parseSegment(searchParams.get("segment")),
  );
  // Two query states: `query` is the raw input (rerenders the box
  // every keystroke), `effective` is the debounced version that the
  // filter/search re-run against. Keeping them separate avoids a
  // laggy input on slow laptops.
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [effective, setEffective] = useState(query);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    searchParams.get("c"),
  );

  const [rows, setRows] = useState<ListRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [touchError, setTouchError] = useState<string | null>(null);

  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // ONE fetch of the full list up front. Everything after — the
  // segment chips, the search box, the sort — is in-memory. The
  // list route accepts ?q= but we fetch unfiltered so the segment
  // counts don't jump around while the operator types, and the
  // debounced search can be purely client-side. 1363 rows × a small
  // payload is comfortably under a megabyte.
  const loadList = useCallback(async () => {
    setListError(null);
    setListLoading(true);
    try {
      const res = await adminFetch<ListResponse>(
        "/api/admin/customers?with_touch=1",
      );
      setRows(res.customers ?? []);
      setTouchError(res.touch_error ?? null);
    } catch (e) {
      if (e instanceof AdminFetchError) setListError(e.message);
      else if (e instanceof Error) setListError(e.message);
      else setListError("Could not load customers.");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // 150ms debounce — fast enough to feel instant to a typist, slow
  // enough that every keystroke on a long "9876543210" search does
  // not recompute the segment counts eleven times.
  useEffect(() => {
    const t = setTimeout(() => setEffective(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailError(null);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await adminFetch<DetailResponse>(
        `/api/admin/customers/${id}`,
      );
      setDetail(res);
    } catch (e) {
      if (e instanceof AdminFetchError) setDetailError(e.message);
      else if (e instanceof Error) setDetailError(e.message);
      else setDetailError("Could not load customer.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (segment !== "all") params.set("segment", segment);
    if (query.trim()) params.set("q", query.trim());
    if (selectedId) params.set("c", selectedId);
    const qs = params.toString();
    const next = qs ? `/mkt?${qs}` : "/mkt";
    router.replace(next, { scroll: false });
  }, [segment, query, selectedId, router]);

  // Search filter — matches name + phone, case-insensitive. Applied
  // BEFORE segment counts so the chip tallies reflect what the
  // operator will see when they click a chip.
  const searched = useMemo(() => {
    const q = effective.trim().toLowerCase();
    if (!q) return rows;
    const digits = q.replace(/\D/g, "");
    return rows.filter((c) => {
      const name = (c.full_name ?? "").toLowerCase();
      const phone = c.phone ?? "";
      if (digits.length > 0 && phone.includes(digits)) return true;
      return name.includes(q);
    });
  }, [rows, effective]);

  const counts = useMemo(() => {
    const out: Record<Segment, number> = {
      all: 0,
      never_ordered: 0,
      tried_cancelled: 0,
      lapsed: 0,
      one_and_done: 0,
      subscribers: 0,
      owes_cod: 0,
    };
    for (const c of searched) {
      for (const s of SEGMENTS) if (matchesSegment(c, s)) out[s] += 1;
    }
    return out;
  }, [searched]);

  const visible = useMemo(() => {
    const filtered = searched.filter((c) => matchesSegment(c, segment));
    return filtered.sort((a, b) => {
      const ta = a.last_touch_at ?? "";
      const tb = b.last_touch_at ?? "";
      if (ta && tb) return tb.localeCompare(ta);
      if (ta) return -1;
      if (tb) return 1;
      const oa = a.last_order_at ?? "";
      const ob = b.last_order_at ?? "";
      return ob.localeCompare(oa);
    });
  }, [searched, segment]);

  // Auto-select first row if nothing selected. Switching segments or
  // typing a query can make the current selection drop out of view;
  // we do NOT yank the user elsewhere in that case — the detail pane
  // keeps showing whoever they picked, even if that person isn't in
  // the current slice.
  useEffect(() => {
    if (selectedId) return;
    if (visible.length === 0) return;
    setSelectedId(visible[0].id);
  }, [visible, selectedId]);

  // ── Keyboard navigation. Up/Down move the selection through the
  // currently-visible slice; Enter re-opens the right pane (harmless
  // since the row is already selected, but kept for accessibility
  // parity with click); Escape clears the search box. All three
  // short-circuit when focus is in a text input that is NOT the
  // search box, so typing in a note body elsewhere on the page can't
  // accidentally scroll the list.
  const searchRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Allow ↑/↓ when focus is in the search box — moving away from
      // the list while typing is useful. Escape anywhere clears.
      const inSearch = t === searchRef.current;
      const inForm =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);
      if (e.key === "Escape") {
        if (query) {
          e.preventDefault();
          setQuery("");
          searchRef.current?.focus();
        }
        return;
      }
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Enter") {
        return;
      }
      if (inForm && !inSearch) return;
      if (visible.length === 0) return;

      const idx = visible.findIndex((r) => r.id === selectedId);
      if (e.key === "Enter") {
        if (idx >= 0) {
          e.preventDefault();
          // Idempotent — re-select to force a scroll into view.
          setSelectedId(visible[idx].id);
          rowRefs.current.get(visible[idx].id)?.scrollIntoView({
            block: "nearest",
          });
        }
        return;
      }
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next =
        idx < 0 ? 0 : Math.max(0, Math.min(visible.length - 1, idx + step));
      const nextRow = visible[next];
      if (nextRow) {
        setSelectedId(nextRow.id);
        rowRefs.current.get(nextRow.id)?.scrollIntoView({
          block: "nearest",
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId, query]);

  return (
    <MktShell title="CRM" subtitle="Customer activity across all channels">
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(0, 200px) minmax(0, 1fr) minmax(0, 1.5fr)",
          gap: "1rem",
          alignItems: "start",
        }}
        className="mkt-grid"
      >
        <SegmentRail
          segment={segment}
          counts={counts}
          onChange={(s) => setSegment(s)}
        />

        <section>
          <SearchBox
            innerRef={searchRef}
            value={query}
            onChange={setQuery}
            countShown={visible.length}
          />

          {touchError ? (
            <PaneError>Touch merge failed: {touchError}</PaneError>
          ) : null}

          {listError ? (
            <PaneError>Could not load list: {listError}</PaneError>
          ) : listLoading ? (
            <SkeletonList />
          ) : visible.length === 0 ? (
            <Placeholder>No people in this segment.</Placeholder>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                gap: "0.5rem",
              }}
            >
              {visible.map((c) => (
                <PersonRow
                  key={c.id}
                  row={c}
                  selected={c.id === selectedId}
                  onSelect={() => setSelectedId(c.id)}
                  liRef={(el) => {
                    if (el) rowRefs.current.set(c.id, el);
                    else rowRefs.current.delete(c.id);
                  }}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="mkt-right">
          <div className="mkt-right-sticky">
            {detailLoading ? (
              <SkeletonFile />
            ) : detailError ? (
              <PaneError>Could not load customer: {detailError}</PaneError>
            ) : detail ? (
              <CustomerFile data={detail} />
            ) : (
              <Placeholder>Select a person on the left.</Placeholder>
            )}
          </div>
        </section>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            /* Right pane sticks to viewport while the people list
               scrolls past. 'start' alignment on the grid lets this
               work; without it the grid stretches every column to
               the tallest row and sticky stops working. */
            .mkt-right-sticky {
              position: sticky;
              top: 1rem;
              max-height: calc(100vh - 2rem);
              overflow: auto;
            }

            @media (max-width: 960px) {
              .mkt-grid {
                grid-template-columns: 1fr !important;
              }
              /* Mobile: stacked. Sticky would stick the file to the
                 top of the viewport while the user is still scanning
                 the list below it — annoying. Fall back to natural
                 flow. */
              .mkt-right-sticky {
                position: static;
                max-height: none;
                overflow: visible;
              }
            }
          `,
        }}
      />
    </MktShell>
  );
}

// ── Search box ──────────────────────────────────────────────────────

function SearchBox({
  innerRef,
  value,
  onChange,
  countShown,
}: {
  innerRef: React.RefObject<HTMLInputElement>;
  value: string;
  onChange: (s: string) => void;
  countShown: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "0.6rem",
        alignItems: "center",
        marginBottom: "0.9rem",
        flexWrap: "wrap",
      }}
    >
      <input
        ref={innerRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search name or phone"
        aria-label="Search customers by name or phone"
        style={{ minWidth: 220, flex: "1 1 240px", fontSize: "0.98rem" }}
      />
      <span
        style={{
          color: MKT.mute,
          fontSize: "0.9rem",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {countShown} {countShown === 1 ? "person" : "people"}
      </span>
    </div>
  );
}

// ── Left rail ───────────────────────────────────────────────────────

function SegmentRail({
  segment,
  counts,
  onChange,
}: {
  segment: Segment;
  counts: Record<Segment, number>;
  onChange: (s: Segment) => void;
}) {
  return (
    <aside
      style={{
        background: "#FFFFFF",
        border: `1px solid ${MKT.ash}`,
        borderRadius: 10,
        padding: "0.4rem",
        boxShadow: MKT.cardShadow,
      }}
    >
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {SEGMENTS.map((s) => {
          const on = s === segment;
          return (
            <li key={s} style={{ margin: 0 }}>
              <button
                type="button"
                onClick={() => onChange(s)}
                aria-pressed={on}
                style={{
                  width: "100%",
                  textAlign: "left",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.55rem 0.75rem",
                  margin: "0.15rem 0",
                  borderRadius: 6,
                  border: 0,
                  color: on ? MKT.activeFg : MKT.ink,
                  background: on ? MKT.activeBg : "transparent",
                  fontSize: "0.95rem",
                  cursor: "pointer",
                  transition:
                    "background 140ms ease, color 140ms ease",
                }}
                onMouseEnter={(e) => {
                  if (!on)
                    (e.currentTarget as HTMLButtonElement).style.background =
                      MKT.hover;
                }}
                onMouseLeave={(e) => {
                  if (!on)
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "transparent";
                }}
                onMouseDown={(e) => {
                  if (!on)
                    (e.currentTarget as HTMLButtonElement).style.background =
                      MKT.pressed;
                }}
                onMouseUp={(e) => {
                  if (!on)
                    (e.currentTarget as HTMLButtonElement).style.background =
                      MKT.hover;
                }}
              >
                <span>{SEGMENT_LABEL[s]}</span>
                <span
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    color: on ? MKT.activeFg : MKT.mute,
                    fontSize: "0.88rem",
                  }}
                >
                  {counts[s]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// ── Middle: one person row ──────────────────────────────────────────

function PersonRow({
  row,
  selected,
  onSelect,
  liRef,
}: {
  row: ListRow;
  selected: boolean;
  onSelect: () => void;
  liRef: (el: HTMLLIElement | null) => void;
}) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const background = selected
    ? "#FFFFFF"
    : pressed
    ? MKT.pressed
    : hover
    ? MKT.hover
    : "#FFFFFF";
  return (
    <li ref={liRef}>
      <button
        type="button"
        onClick={onSelect}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => {
          setHover(false);
          setPressed(false);
        }}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
        aria-pressed={selected}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "0.75rem 0.95rem",
          background,
          border: `1px solid ${MKT.ash}`,
          borderLeft: selected
            ? `3px solid ${MKT.green}`
            : `3px solid ${MKT.ash}`,
          borderRadius: 8,
          color: MKT.ink,
          cursor: "pointer",
          display: "grid",
          gap: "0.4rem",
          boxShadow: selected ? MKT.cardShadow : "none",
          transition:
            "background 140ms ease, border-color 140ms ease, box-shadow 140ms ease",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "0.6rem",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "1rem" }}>
            {row.full_name ?? "Unnamed"}
          </span>
          <span
            style={{
              color: MKT.mute,
              fontSize: "0.86rem",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {row.phone ?? "no phone"}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: "0.55rem",
            flexWrap: "wrap",
            color: MKT.mute,
            fontSize: "0.88rem",
          }}
        >
          <span>Last order: {formatDate(row.last_order_at)}</span>
          <span style={{ color: MKT.ash }}>·</span>
          <span>Spent: {formatINR(row.total_spent)}</span>
          {row.has_subscription ? (
            <>
              <span style={{ color: MKT.ash }}>·</span>
              <span style={{ color: MKT.green, fontWeight: 600 }}>Subscriber</span>
            </>
          ) : null}
          {row.outstanding_cod > 0 ? (
            <>
              <span style={{ color: MKT.ash }}>·</span>
              <span style={{ color: MKT.error, fontWeight: 600 }}>
                Owes {formatINR(row.outstanding_cod)}
              </span>
            </>
          ) : null}
          {row.total_orders === 0 && row.cancelled_orders > 0 ? (
            // Surfaces the "Tried, cancelled" signal on the ROW, not
            // just as a chip filter — so a tried_cancelled customer
            // is visible for what they are in any segment view. The
            // date reads "status changed {date}" rather than "cancelled
            // {date}" because the source is status_updated_at, not
            // the dead cancelled_at column; the operator needs to
            // trust the number, so the label names its source.
            <>
              <span style={{ color: MKT.ash }}>·</span>
              <span style={{ color: MKT.error, fontWeight: 600 }}>
                Cancelled {row.cancelled_orders} · status changed{" "}
                {formatDate(row.last_cancelled_status_at)}
              </span>
            </>
          ) : null}
        </div>
        <LastTouch row={row} />
      </button>
    </li>
  );
}

function LastTouch({ row }: { row: ListRow }) {
  if (!row.last_touch_at) {
    return (
      <span style={{ color: MKT.mute, fontSize: "0.88rem" }}>
        No notes or WhatsApp yet.
      </span>
    );
  }
  const kindStyle = KIND_STYLE[row.last_touch_kind ?? "note"];
  return (
    <span
      style={{
        display: "flex",
        gap: "0.5rem",
        alignItems: "baseline",
        color: MKT.ink,
        fontSize: "0.9rem",
      }}
    >
      <span
        style={{
          color: kindStyle.color,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          fontSize: "0.7rem",
          fontWeight: 700,
          minWidth: 58,
        }}
      >
        {kindStyle.label}
      </span>
      <span
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          flex: 1,
          color: MKT.ink,
        }}
      >
        {(row.last_touch_body ?? "").replace(/\s+/g, " ").trim() || "—"}
      </span>
      <span style={{ color: MKT.mute, fontSize: "0.8rem" }}>
        {formatDate(row.last_touch_at)}
      </span>
    </span>
  );
}

// ── Right pane: customer file ──────────────────────────────────────

function CustomerFile({ data }: { data: DetailResponse }) {
  const c = data.customer;
  const items = useMemo(() => buildTimeline(data), [data]);
  const buckets = useMemo(() => buildWeekBuckets(data.orders), [data.orders]);

  return (
    <article
      style={{
        background: "#FFFFFF",
        border: `1px solid ${MKT.ash}`,
        borderRadius: 10,
        boxShadow: MKT.cardShadow,
        padding: "1rem 1.1rem",
        color: MKT.ink,
      }}
    >
      <header
        style={{
          display: "grid",
          gap: "0.6rem",
          borderBottom: `1px solid ${MKT.ash}`,
          paddingBottom: "0.9rem",
          marginBottom: "0.9rem",
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
              color: MKT.green,
              fontSize: "1.3rem",
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            {c.full_name ?? "Unnamed customer"}
          </h2>
          <QuickActions phone={c.phone} />
        </div>
        <div
          style={{
            display: "flex",
            gap: "1.2rem",
            flexWrap: "wrap",
            color: MKT.mute,
            fontSize: "0.92rem",
          }}
        >
          <span>
            Spent{" "}
            <span style={{ color: MKT.ink, fontWeight: 600 }}>
              {formatINR(c.total_spent ?? 0)}
            </span>
          </span>
          <span>
            Orders{" "}
            <span style={{ color: MKT.ink, fontWeight: 600 }}>
              {c.total_orders ?? 0}
            </span>
          </span>
          {c.has_subscription ? (
            <span style={{ color: MKT.green, fontWeight: 600 }}>Subscriber</span>
          ) : null}
          {(c.outstanding_cod ?? 0) > 0 ? (
            <span style={{ color: MKT.error, fontWeight: 600 }}>
              Owes {formatINR(c.outstanding_cod)}
            </span>
          ) : null}
          <span>
            {c.phone ?? (
              <span style={{ color: MKT.mute }}>no phone</span>
            )}
          </span>
        </div>
        <ActivityStrip buckets={buckets} />
      </header>

      {data.notes_error ? (
        <PaneError>Notes failed: {data.notes_error}</PaneError>
      ) : null}
      {data.whatsapp_error ? (
        <PaneError>WhatsApp failed: {data.whatsapp_error}</PaneError>
      ) : null}
      {data.reviews_error ? (
        <PaneError>Reviews failed: {data.reviews_error}</PaneError>
      ) : null}

      {items.length === 0 ? (
        <Placeholder>No activity yet.</Placeholder>
      ) : (
        <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {items.map((it) => (
            <TimelineRow key={it.id} item={it} />
          ))}
        </ol>
      )}
    </article>
  );
}

// ── 12-week activity strip ─────────────────────────────────────────

function ActivityStrip({ buckets }: { buckets: WeekBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const BAR = 10;
  const GAP = 4;
  const WIDTH = WEEKS * BAR + (WEEKS - 1) * GAP;
  const HEIGHT = 34;
  const MIN_H = 2;
  return (
    <div
      aria-label="Last 12 weeks of orders"
      role="img"
      style={{
        display: "flex",
        gap: "0.7rem",
        alignItems: "flex-end",
        color: MKT.mute,
        fontSize: "0.8rem",
      }}
    >
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-hidden
      >
        {buckets.map((b, i) => {
          const h = b.count === 0 ? MIN_H : Math.max(MIN_H, (b.count / max) * HEIGHT);
          const x = i * (BAR + GAP);
          const y = HEIGHT - h;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={BAR}
              height={h}
              rx={2}
              fill={b.count === 0 ? MKT.ash : MKT.green}
            >
              <title>
                {`Week ${i + 1}: ${b.count} order${b.count === 1 ? "" : "s"}`}
              </title>
            </rect>
          );
        })}
      </svg>
      <span style={{ lineHeight: `${HEIGHT}px` }}>12-week activity</span>
    </div>
  );
}

// ── Quick actions ──────────────────────────────────────────────────

function QuickActions({ phone }: { phone: string | null | undefined }) {
  const hasPhone =
    typeof phone === "string" && phone.replace(/\D/g, "").length >= 10;
  const tel = hasPhone ? telHref(phone) : "";
  const wa = hasPhone ? whatsAppHref(phone) : "";

  return (
    <div style={{ display: "flex", gap: "0.4rem" }}>
      <QuickAction
        label="WhatsApp"
        href={wa}
        disabled={!hasPhone}
        external
      />
      <QuickAction label="Call" href={tel} disabled={!hasPhone} />
      <CopyAction phone={hasPhone ? String(phone) : null} />
    </div>
  );
}

function QuickAction({
  label,
  href,
  disabled,
  external,
}: {
  label: string;
  href?: string;
  disabled: boolean;
  external?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  const bg = disabled ? "#FFFFFF" : pressed ? MKT.pressed : "#FFFFFF";
  const style: React.CSSProperties = {
    padding: "0.4rem 0.8rem",
    border: `1px solid ${disabled ? MKT.ash : MKT.green}`,
    color: disabled ? MKT.mute : MKT.green,
    background: bg,
    fontSize: "0.82rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontWeight: 600,
    textDecoration: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    borderRadius: 6,
    transition: "background 140ms ease, color 140ms ease",
    display: "inline-block",
  };
  if (disabled || !href) {
    return (
      <button
        type="button"
        aria-disabled={disabled ? "true" : undefined}
        disabled={disabled}
        style={style}
      >
        {label}
      </button>
    );
  }
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={style}
    >
      {label}
    </a>
  );
}

function CopyAction({ phone }: { phone: string | null }) {
  const [copied, setCopied] = useState(false);
  const disabled = !phone;
  const label = copied ? "Copied" : "Copy";

  const copy = () => {
    if (!phone) return;
    void navigator.clipboard
      ?.writeText(phone)
      .then(() => setCopied(true))
      .catch(() => {
        // Clipboard permission denied — show a different inline hint
        // rather than an alert. "Copy" reverts after the timer below.
        setCopied(true);
      });
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={disabled ? undefined : copy}
      disabled={disabled}
      aria-disabled={disabled ? "true" : undefined}
      style={{
        padding: "0.4rem 0.8rem",
        border: `1px solid ${copied ? MKT.green : disabled ? MKT.ash : MKT.green}`,
        color: copied ? MKT.cream : disabled ? MKT.mute : MKT.green,
        background: copied ? MKT.green : "#FFFFFF",
        fontSize: "0.82rem",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        borderRadius: 6,
        transition:
          "background 140ms ease, color 140ms ease, border-color 140ms ease",
      }}
    >
      {label}
    </button>
  );
}

// ── Timeline row (with per-row "more" toggle) ──────────────────────

function TimelineRow({ item }: { item: TimelineItem }) {
  const style = KIND_STYLE[item.kind];
  const body = item.body ?? "";
  const overflows = countTimelineLines(body) > 3;
  const [expanded, setExpanded] = useState(false);
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "28px minmax(0, 1fr) auto",
        gap: "0.6rem",
        padding: "0.65rem 0",
        borderBottom: `1px solid ${MKT.ash}`,
        color: MKT.ink,
      }}
    >
      <span
        aria-hidden
        style={{
          color: style.color,
          fontSize: "1.05rem",
          lineHeight: 1,
          textAlign: "center",
          paddingTop: 2,
        }}
      >
        {style.icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            gap: "0.6rem",
            alignItems: "baseline",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              color: style.color,
              fontSize: "0.72rem",
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              fontWeight: 700,
            }}
          >
            {style.label}
          </span>
          <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>
            {item.title}
          </span>
          {item.meta ? (
            <span style={{ color: MKT.mute, fontSize: "0.88rem" }}>
              {item.meta}
            </span>
          ) : null}
        </div>
        {body ? (
          <>
            <p
              style={{
                margin: "0.25rem 0 0",
                color: MKT.ink,
                fontSize: "0.94rem",
                whiteSpace: "pre-wrap",
                display: overflows && !expanded ? "-webkit-box" : "block",
                WebkitLineClamp:
                  overflows && !expanded ? (3 as unknown as string) : undefined,
                WebkitBoxOrient:
                  overflows && !expanded ? "vertical" : undefined,
                overflow: overflows && !expanded ? "hidden" : "visible",
              }}
            >
              {body}
            </p>
            {overflows ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                style={{
                  marginTop: "0.25rem",
                  border: 0,
                  background: "transparent",
                  color: MKT.blue,
                  padding: 0,
                  fontSize: "0.86rem",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {expanded ? "less" : "more"}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      <span
        style={{
          color: MKT.mute,
          fontSize: "0.82rem",
          whiteSpace: "nowrap",
          paddingTop: 2,
        }}
      >
        {formatDateTime(item.at)}
      </span>
    </li>
  );
}

// ── Skeletons ─────────────────────────────────────────────────────

function SkeletonList() {
  return (
    <ul
      aria-label="Loading customers"
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "grid",
        gap: "0.5rem",
      }}
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <li
          key={i}
          style={{
            border: `1px solid ${MKT.ash}`,
            borderRadius: 8,
            padding: "0.75rem 0.95rem",
            background: "#FFFFFF",
            display: "grid",
            gap: "0.4rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <ShimmerBar width="35%" />
            <ShimmerBar width="25%" />
          </div>
          <ShimmerBar width="60%" />
          <ShimmerBar width="80%" />
        </li>
      ))}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes mktShimmer {
              0% { background-position: -400px 0; }
              100% { background-position: 400px 0; }
            }
          `,
        }}
      />
    </ul>
  );
}

function SkeletonFile() {
  return (
    <article
      aria-label="Loading customer"
      style={{
        background: "#FFFFFF",
        border: `1px solid ${MKT.ash}`,
        borderRadius: 10,
        padding: "1rem 1.1rem",
        boxShadow: MKT.cardShadow,
        display: "grid",
        gap: "0.65rem",
      }}
    >
      <ShimmerBar width="40%" height={20} />
      <ShimmerBar width="80%" height={12} />
      <ShimmerBar width="55%" height={12} />
      <div style={{ height: 8 }} />
      <ShimmerBar width="100%" height={14} />
      <ShimmerBar width="94%" height={14} />
      <ShimmerBar width="88%" height={14} />
    </article>
  );
}

function ShimmerBar({
  width,
  height = 10,
}: {
  width: string;
  height?: number;
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 4,
        background:
          "linear-gradient(90deg, rgba(192,200,206,0.25) 0%, rgba(192,200,206,0.55) 50%, rgba(192,200,206,0.25) 100%)",
        backgroundSize: "800px 100%",
        animation: "mktShimmer 1.2s linear infinite",
      }}
    />
  );
}

// ── Shared tiny UI ────────────────────────────────────────────────

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: `1px dashed ${MKT.ash}`,
        borderRadius: 8,
        padding: "1.6rem 1rem",
        textAlign: "center",
        color: MKT.mute,
        fontSize: "0.95rem",
        background: "#FFFFFF",
      }}
    >
      {children}
    </div>
  );
}

function PaneError({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        border: `1px solid ${MKT.error}`,
        background: MKT.errorBg,
        padding: "0.7rem 0.9rem",
        color: MKT.error,
        fontSize: "0.92rem",
        marginBottom: "0.9rem",
        borderRadius: 8,
      }}
    >
      {children}
    </div>
  );
}
