"use client";

// /mkt — marketing workspace, first screen is the CRM.
//
// Three panes on desktop, stacked on phone:
//   LEFT   — segment rail with live counts.
//   MIDDLE — the people in that segment. Each row carries a "last
//            touch" line (most recent of their latest order_note body
//            or latest WhatsApp message). The list is SORTED by that
//            touch, newest first; the whole point is "who went quiet".
//   RIGHT  — the selected person's merged timeline: orders, notes,
//            WhatsApp and reviews, one stream, newest first, kind-coded
//            with icon + accent colour.
//
// REUSE, NOT REWRITE. The data flows through /api/admin/customers
// (with ?with_touch=1) for the list and /api/admin/customers/[id] for
// the detail. Both routes shipped in 730c784 and are gated, tested,
// and already projecting the fields this page needs. The two things
// added since: the list route now accepts with_touch so a caller can
// opt into last_touch_at/body/kind without paying for it elsewhere.
//
// Every pane carries its own error state separate from its empty
// state — a 500 on reviews must not read as "no reviews", a failed
// customer fetch must not look like "no match for this segment".
//
// Quick actions in the right-pane header are DISABLED (not hidden,
// not broken links) when the customer has no phone on file — the
// operator must still see that the number is absent, not merely feel
// that the buttons are missing.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AdminShell } from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/admin/StatusBadge";
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
  KIND_STYLE,
  matchesSegment,
  parseSegment,
  SEGMENT_LABEL,
  SEGMENTS,
  type Segment,
  type TimelineItem,
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

// Segment logic lives in @/lib/mkt-crm so `node --test` can exercise
// it without a bundler. The page imports and renders.

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
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
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

  const loadList = useCallback(async (q: string) => {
    setListError(null);
    setListLoading(true);
    try {
      const url =
        q.trim().length > 0
          ? `/api/admin/customers?q=${encodeURIComponent(q.trim())}&with_touch=1`
          : "/api/admin/customers?with_touch=1";
      const res = await adminFetch<ListResponse>(url);
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

  // Debounced search reload, same shape as /admin/customers.
  useEffect(() => {
    const t = setTimeout(() => void loadList(query), 300);
    return () => clearTimeout(t);
  }, [query, loadList]);

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

  // URL writeback — segment + q + selected id all survive a refresh.
  useEffect(() => {
    const params = new URLSearchParams();
    if (segment !== "all") params.set("segment", segment);
    if (query.trim()) params.set("q", query.trim());
    if (selectedId) params.set("c", selectedId);
    const qs = params.toString();
    const next = qs ? `/mkt?${qs}` : "/mkt";
    router.replace(next, { scroll: false });
  }, [segment, query, selectedId, router]);

  // Live counts per segment, computed off the full fetched set (search
  // narrows the LIST pane but the sidebar counts stay honest to the
  // full pool — a segment count that changed every keystroke would
  // make the rail unreadable).
  const counts = useMemo(() => {
    const out: Record<Segment, number> = {
      all: 0,
      never_ordered: 0,
      lapsed: 0,
      one_and_done: 0,
      subscribers: 0,
      owes_cod: 0,
    };
    for (const c of rows) {
      for (const s of SEGMENTS) if (matchesSegment(c, s)) out[s] += 1;
    }
    return out;
  }, [rows]);

  const visible = useMemo(() => {
    const filtered = rows.filter((c) => matchesSegment(c, segment));
    // Newest touch first — the point of the column. Customers with no
    // touch at all fall to the bottom; within that no-touch group,
    // sort by last_order_at desc so a recent order is still prominent.
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
  }, [rows, segment]);

  // Auto-select the first row when nothing is selected AND we have
  // rows for this segment. Keeps the right pane populated on first
  // load instead of showing a blank slate. Only runs when the user
  // hasn't picked yet — switching segments does NOT yank them away.
  useEffect(() => {
    if (selectedId) return;
    if (visible.length === 0) return;
    setSelectedId(visible[0].id);
  }, [visible, selectedId]);

  return (
    <AdminShell title="Marketing" subtitle="CRM">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 220px) minmax(0, 1fr) minmax(0, 1.4fr)",
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
          <div
            className="flex flex-wrap items-center gap-3"
            style={{ marginBottom: "0.9rem" }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or phone"
              style={{
                border: "1px solid rgba(251,243,212,0.3)",
                background: "transparent",
                color: "#FBF3D4",
                padding: "0.45rem 0.8rem",
                fontFamily: "var(--font-body)",
                fontSize: "1rem",
                minWidth: 240,
                flex: "1 1 240px",
              }}
            />
            <span
              style={{
                color: "rgba(251,243,212,0.55)",
                fontSize: "0.95rem",
                letterSpacing: "0.04em",
              }}
            >
              {visible.length} people
            </span>
          </div>

          {touchError ? (
            <PaneError>Touch merge failed: {touchError}</PaneError>
          ) : null}

          {listError ? (
            <PaneError>Could not load list: {listError}</PaneError>
          ) : listLoading ? (
            <Placeholder>Loading customers…</Placeholder>
          ) : visible.length === 0 ? (
            <Placeholder>No people in this segment.</Placeholder>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {visible.map((c) => (
                <PersonRow
                  key={c.id}
                  row={c}
                  selected={c.id === selectedId}
                  onSelect={() => setSelectedId(c.id)}
                />
              ))}
            </ul>
          )}
        </section>

        <section>
          {detailLoading ? (
            <Placeholder>Loading customer…</Placeholder>
          ) : detailError ? (
            <PaneError>Could not load customer: {detailError}</PaneError>
          ) : detail ? (
            <CustomerFile data={detail} />
          ) : (
            <Placeholder>Select a person on the left.</Placeholder>
          )}
        </section>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media (max-width: 960px) {
              .mkt-grid { grid-template-columns: 1fr !important; }
            }
          `,
        }}
      />
    </AdminShell>
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
        border: "1px solid rgba(251,243,212,0.18)",
        padding: "0.5rem",
        borderRadius: 4,
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
                style={{
                  width: "100%",
                  textAlign: "left",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.55rem 0.8rem",
                  background: on
                    ? "rgba(251,243,212,0.14)"
                    : "transparent",
                  border: 0,
                  color: on ? "#FBF3D4" : "rgba(251,243,212,0.78)",
                  fontFamily: "var(--font-body)",
                  fontSize: "1rem",
                  letterSpacing: "0.03em",
                  cursor: "pointer",
                  borderLeft: on
                    ? "3px solid #FBF3D4"
                    : "3px solid transparent",
                }}
              >
                <span>{SEGMENT_LABEL[s]}</span>
                <span
                  style={{
                    fontFeatureSettings: '"tnum"',
                    color: on ? "#FBF3D4" : "rgba(251,243,212,0.55)",
                    fontSize: "0.9rem",
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
}: {
  row: ListRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "0.75rem 0.9rem",
          background: selected
            ? "rgba(251,243,212,0.1)"
            : "transparent",
          border: "1px solid rgba(251,243,212,0.14)",
          borderLeft: selected
            ? "3px solid #FBF3D4"
            : "3px solid transparent",
          color: "#FBF3D4",
          fontFamily: "var(--font-body)",
          cursor: "pointer",
          marginBottom: "0.4rem",
          display: "grid",
          gap: "0.35rem",
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
          <span style={{ fontSize: "1.02rem" }}>
            {row.full_name ?? "Unnamed"}
          </span>
          <span
            style={{
              color: "rgba(251,243,212,0.6)",
              fontSize: "0.85rem",
              fontFeatureSettings: '"tnum"',
            }}
          >
            {row.phone ?? "no phone"}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: "0.6rem",
            flexWrap: "wrap",
            color: "rgba(251,243,212,0.7)",
            fontSize: "0.9rem",
          }}
        >
          <span>Last order: {formatDate(row.last_order_at)}</span>
          <span>·</span>
          <span>Spent: {formatINR(row.total_spent)}</span>
          {row.has_subscription ? (
            <>
              <span>·</span>
              <span>Subscriber</span>
            </>
          ) : null}
          {row.outstanding_cod > 0 ? (
            <>
              <span>·</span>
              <span style={{ color: "#F59E0B" }}>
                Owes {formatINR(row.outstanding_cod)}
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
      <span style={{ color: "rgba(251,243,212,0.4)", fontSize: "0.9rem" }}>
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
        color: "rgba(251,243,212,0.85)",
        fontSize: "0.92rem",
      }}
    >
      <span
        style={{
          color: kindStyle.color,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontSize: "0.72rem",
          minWidth: 62,
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
        }}
      >
        {(row.last_touch_body ?? "").replace(/\s+/g, " ").trim() || "—"}
      </span>
      <span style={{ color: "rgba(251,243,212,0.5)", fontSize: "0.82rem" }}>
        {formatDate(row.last_touch_at)}
      </span>
    </span>
  );
}

// ── Right: merged timeline ──────────────────────────────────────────

function CustomerFile({ data }: { data: DetailResponse }) {
  const c = data.customer;
  const items = useMemo(() => buildTimeline(data), [data]);

  return (
    <article
      style={{
        border: "1px solid rgba(251,243,212,0.18)",
        padding: "1rem 1.1rem",
        borderRadius: 4,
      }}
    >
      <header
        style={{
          display: "grid",
          gap: "0.6rem",
          borderBottom: "1px solid rgba(251,243,212,0.14)",
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
              fontFamily: "var(--font-heading)",
              fontSize: "1.3rem",
              margin: 0,
              color: "#FBF3D4",
              letterSpacing: "0.02em",
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
            color: "rgba(251,243,212,0.8)",
            fontSize: "0.95rem",
          }}
        >
          <span>Spent: {formatINR(c.total_spent ?? 0)}</span>
          <span>Orders: {c.total_orders ?? 0}</span>
          {c.has_subscription ? (
            <span style={{ color: "#7FD4C1" }}>Subscriber</span>
          ) : null}
          {(c.outstanding_cod ?? 0) > 0 ? (
            <span style={{ color: "#F59E0B" }}>
              Owes {formatINR(c.outstanding_cod)}
            </span>
          ) : null}
          {c.phone ? (
            <span style={{ color: "rgba(251,243,212,0.6)" }}>{c.phone}</span>
          ) : (
            <span style={{ color: "rgba(251,243,212,0.4)" }}>no phone</span>
          )}
        </div>
      </header>

      {/* Per-panel errors from the detail route. Each is distinct from
          the empty state — the merged timeline below hides whichever
          slice failed rather than silently inventing "no notes" over
          a 500. */}
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

function QuickActions({ phone }: { phone: string | null | undefined }) {
  const hasPhone = typeof phone === "string" && phone.replace(/\D/g, "").length >= 10;
  const tel = hasPhone ? telHref(phone) : "";
  const wa = hasPhone ? whatsAppHref(phone) : "";

  // Disabled, NOT hidden. The absence of a phone is itself information
  // for the operator — a hidden set of buttons reads as "this is a
  // customer without quick actions", which is wrong; the correct read
  // is "no phone on file for this customer". Render the three buttons
  // flat and disabled, with aria-disabled so screen readers agree.
  const copyPhone = () => {
    if (!hasPhone) return;
    void navigator.clipboard?.writeText(String(phone));
  };

  return (
    <div style={{ display: "flex", gap: "0.4rem" }}>
      <QuickAction
        label="WhatsApp"
        href={wa}
        disabled={!hasPhone}
        external
      />
      <QuickAction label="Call" href={tel} disabled={!hasPhone} />
      <QuickAction
        label="Copy"
        disabled={!hasPhone}
        onClick={copyPhone}
      />
    </div>
  );
}

function QuickAction({
  label,
  href,
  disabled,
  external,
  onClick,
}: {
  label: string;
  href?: string;
  disabled: boolean;
  external?: boolean;
  onClick?: () => void;
}) {
  const style: React.CSSProperties = {
    padding: "0.35rem 0.7rem",
    border: `1px solid ${disabled ? "rgba(251,243,212,0.18)" : "rgba(251,243,212,0.45)"}`,
    color: disabled ? "rgba(251,243,212,0.35)" : "#FBF3D4",
    background: "transparent",
    fontFamily: "var(--font-body)",
    fontSize: "0.82rem",
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    textDecoration: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
  if (disabled || !href) {
    return (
      <button
        type="button"
        aria-disabled={disabled ? "true" : undefined}
        disabled={disabled}
        onClick={disabled ? undefined : onClick}
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
      style={style}
    >
      {label}
    </a>
  );
}

// ── Timeline merge ──────────────────────────────────────────────────

function TimelineRow({ item }: { item: TimelineItem }) {
  const style = KIND_STYLE[item.kind];
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "28px minmax(0, 1fr) auto",
        gap: "0.6rem",
        padding: "0.6rem 0",
        borderBottom: "1px solid rgba(251,243,212,0.08)",
        fontFamily: "var(--font-body)",
        color: "#FBF3D4",
      }}
    >
      <span
        aria-hidden
        style={{
          color: style.color,
          fontSize: "1.1rem",
          lineHeight: 1,
          textAlign: "center",
          paddingTop: 2,
        }}
      >
        {style.icon}
      </span>
      <div>
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
              fontSize: "0.78rem",
              textTransform: "uppercase",
              letterSpacing: "0.14em",
            }}
          >
            {style.label}
          </span>
          <span style={{ fontSize: "0.96rem" }}>{item.title}</span>
          {item.kind === "order" || item.kind === "note" || item.kind === "call" || item.kind === "edit" ? (
            <StatusBadgeFromTitle title={item.title} />
          ) : null}
        </div>
        {item.body ? (
          <p
            style={{
              margin: "0.25rem 0 0",
              color: "rgba(251,243,212,0.88)",
              fontSize: "0.95rem",
              whiteSpace: "pre-wrap",
            }}
          >
            {item.body}
          </p>
        ) : null}
      </div>
      <span
        style={{
          color: "rgba(251,243,212,0.55)",
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

// Keep StatusBadge imported but only render it on rows whose title is
// a known status word — otherwise the badge box would always show "—".
function StatusBadgeFromTitle({ title }: { title: string }) {
  const known = /cancelled|delivered|paid|unpaid|pending/i.test(title);
  if (!known) return null;
  return <StatusBadge status={title} />;
}

// ── Shared tiny UI ─────────────────────────────────────────────────

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px dashed rgba(251,243,212,0.2)",
        padding: "1.6rem 1rem",
        textAlign: "center",
        color: "rgba(251,243,212,0.5)",
        fontFamily: "var(--font-body)",
        fontSize: "0.95rem",
      }}
    >
      {children}
    </div>
  );
}

function PaneError({ children }: { children: React.ReactNode }) {
  // Distinct from <Placeholder> — a red outline + muted red fill,
  // never cream dashed. A 500 inside one pane must not read like an
  // empty state.
  return (
    <div
      style={{
        border: "1px solid rgba(239,68,68,0.5)",
        background: "rgba(239,68,68,0.08)",
        padding: "0.7rem 0.9rem",
        color: "#EF4444",
        fontFamily: "var(--font-body)",
        fontSize: "0.92rem",
        marginBottom: "0.9rem",
      }}
    >
      {children}
    </div>
  );
}
