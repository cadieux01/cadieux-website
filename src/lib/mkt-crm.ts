// Pure helpers behind /mkt — kept out of the .tsx page so node --test
// can exercise them without a bundler. Segment matching and the
// right-pane timeline merge are both testable in isolation; the
// three-pane React layout imports and uses them.

export const SEGMENTS = [
  "all",
  "never_ordered",
  "lapsed",
  "one_and_done",
  "subscribers",
  "owes_cod",
] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABEL: Record<Segment, string> = {
  all: "All",
  never_ordered: "Never ordered",
  lapsed: "Lapsed >21d",
  one_and_done: "One-and-done",
  subscribers: "Subscribers",
  owes_cod: "Owes COD",
};

const LAPSED_DAYS = 21;
const DAY_MS = 86_400_000;

export function parseSegment(raw: string | null): Segment {
  return (SEGMENTS as readonly string[]).includes(raw ?? "")
    ? (raw as Segment)
    : "all";
}

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / DAY_MS);
}

// Minimal row shape — only the fields segmentation reads, so a UI
// row carrying extra keys can still be fed through matchesSegment()
// without a cast.
export type SegmentableRow = {
  total_orders: number;
  has_subscription: boolean;
  last_order_at: string | null;
  outstanding_cod: number;
};

/** Does this customer match the given segment?
 *
 *  Two invariants worth stating explicitly, because both are easy to
 *  lose in a rewrite:
 *
 *  - never_ordered requires BOTH no orders AND no subscription. A
 *    plan-holder with no ad-hoc orders is not a stranger — the shop
 *    has served them, and win-back messaging that treats them as a
 *    cold lead will insult them. The AND is the whole point.
 *
 *  - lapsed requires a last_order_at. A customer who never ordered
 *    cannot be "lapsed"; that is what never_ordered is for. The two
 *    sets must stay disjoint — a customer must not appear in both.
 */
export function matchesSegment(c: SegmentableRow, seg: Segment): boolean {
  switch (seg) {
    case "all":
      return true;
    case "never_ordered":
      return c.total_orders === 0 && !c.has_subscription;
    case "one_and_done":
      return c.total_orders === 1;
    case "lapsed": {
      const d = daysSince(c.last_order_at);
      return d !== null && d > LAPSED_DAYS;
    }
    case "subscribers":
      return c.has_subscription;
    case "owes_cod":
      return (c.outstanding_cod ?? 0) > 0;
    default:
      return false;
  }
}

// ── Right-pane timeline merge ───────────────────────────────────────

export type TimelineItem = {
  id: string;
  at: string;
  kind:
    | "order"
    | "note"
    | "call"
    | "edit"
    | "whatsapp_in"
    | "whatsapp_out"
    | "review";
  title: string;
  body: string | null;
  meta?: string | null;
};

type OrderIn = {
  id: string;
  order_number?: string | null;
  total_amount: number | null;
  status: string | null;
  payment_method?: string | null;
  delivery_address: string | null;
  created_at: string;
};

type NoteIn = {
  id: string;
  kind: string;
  body: string;
  author: string | null;
  created_at: string;
};

type MessageIn = {
  id: string;
  direction: string | null;
  body: string | null;
  created_at: string;
};

type ReviewIn = {
  id: string;
  product_slug: string | null;
  rating: number | null;
  body: string;
  created_at: string;
  is_deleted: boolean | null;
};

export type TimelineInput = {
  orders: OrderIn[];
  notes: NoteIn[];
  whatsapp: { messages: MessageIn[] };
  reviews: ReviewIn[];
};

function formatRupees(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Build one reverse-chronological stream across the four source
 *  slices. Sort is on the ISO string directly — lexicographic
 *  comparison of ISO 8601 is equivalent to numeric comparison of the
 *  underlying instants without the parse cost per row.
 *
 *  Each row's id is prefixed by source (o-/n-/w-/r-) so that a React
 *  key cannot collide even if a reviews.id and an orders.id ever
 *  share bytes (uuids do not, but the prefix is cheap insurance). */
export function buildTimeline(d: TimelineInput): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const o of d.orders) {
    items.push({
      id: `o-${o.id}`,
      at: o.created_at,
      kind: "order",
      title: (o.order_number ?? "Order").toString(),
      body: [
        o.delivery_address ?? null,
        o.status ? `status: ${o.status}` : null,
        o.payment_method ? `pay: ${o.payment_method}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      meta: formatRupees(o.total_amount),
    });
  }

  for (const n of d.notes) {
    const kind: TimelineItem["kind"] =
      n.kind === "call" ? "call" : n.kind === "edit" ? "edit" : "note";
    items.push({
      id: `n-${n.id}`,
      at: n.created_at,
      kind,
      title: n.author ?? kindName(kind),
      body: n.body,
    });
  }

  for (const m of d.whatsapp.messages) {
    const kind: TimelineItem["kind"] =
      m.direction === "in" ? "whatsapp_in" : "whatsapp_out";
    items.push({
      id: `w-${m.id}`,
      at: m.created_at,
      kind,
      title: m.direction === "in" ? "WhatsApp · in" : "WhatsApp · out",
      body: m.body ?? "",
    });
  }

  for (const r of d.reviews) {
    items.push({
      id: `r-${r.id}`,
      at: r.created_at,
      kind: "review",
      title: `Review · ${r.product_slug ?? "—"}${
        r.is_deleted ? " (deleted)" : ""
      }`,
      body: r.body,
      meta: r.rating == null ? null : `${r.rating}★`,
    });
  }

  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return items;
}

export function kindName(k: TimelineItem["kind"]): string {
  switch (k) {
    case "order":
      return "Order";
    case "note":
      return "Note";
    case "call":
      return "Call";
    case "edit":
      return "Edit";
    case "whatsapp_in":
      return "WhatsApp in";
    case "whatsapp_out":
      return "WhatsApp out";
    case "review":
      return "Review";
  }
}

// Palette + icon per kind. Mirrors src/lib/order-notes.ts
// NOTE_KIND_STYLE so a 'call' reads amber in both the orders board
// and here, and 'edit' teal in both. Declared here in the .ts module
// so the page's own inline map stays in sync with what the test can
// pin.
export const KIND_STYLE: Record<
  TimelineItem["kind"] | "whatsapp",
  { label: string; color: string; icon: string }
> = {
  note: { label: "Note", color: "rgba(251,243,212,0.72)", icon: "✎" },
  call: { label: "Call", color: "#F59E0B", icon: "☎" },
  edit: { label: "Edit", color: "#7FD4C1", icon: "⟲" },
  whatsapp: { label: "WhatsApp", color: "#25D366", icon: "💬" },
  whatsapp_in: { label: "WhatsApp ↓", color: "#25D366", icon: "💬" },
  whatsapp_out: { label: "WhatsApp ↑", color: "#25D366", icon: "💬" },
  order: { label: "Order", color: "#FBF3D4", icon: "◉" },
  review: { label: "Review", color: "#F0C419", icon: "★" },
};
