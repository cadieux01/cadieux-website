// Server-side helpers for public.order_notes.
//
// Shape (migration applied separately — this file assumes it exists):
//   id uuid pk
//   order_id uuid null -> public.orders(id) on delete cascade
//   subscription_id uuid null -> public.subscriptions(id) on delete cascade
//   kind text not null default 'note'  -- 'note' | 'call'
//   body text not null                 -- 1..1000 chars, trimmed
//   author text null
//   created_at timestamptz not null default now()
// Exactly one of order_id/subscription_id is non-null.
// RLS enabled with NO policies — every read/write here goes through
// supabaseAdmin (service role), and every entry point is admin-gated.

import type { SupabaseClient } from "@supabase/supabase-js";

import { formatSlotForDisplay } from "@/lib/delivery-slots";
import { shareDateLabel } from "@/lib/order-share-customer";

// 'edit' rows are written exclusively by the admin_edit_order RPC and
// carry customer_visible=true — they are the record the customer sees
// on their /orders/[id] page. 'note' and 'call' remain internal.
export type NoteKind = "note" | "call" | "edit";

export const NOTE_KINDS: readonly NoteKind[] = ["note", "call", "edit"] as const;

export const NOTE_BODY_MIN = 1;
export const NOTE_BODY_MAX = 1000;

export type OrderNoteRow = {
  id: string;
  order_id: string | null;
  subscription_id: string | null;
  kind: NoteKind;
  body: string;
  author: string | null;
  created_at: string;
  customer_visible?: boolean;
  meta?: unknown;
};

export type OwnerRef =
  | { order_id: string; subscription_id?: never }
  | { subscription_id: string; order_id?: never };

/** Newest-first summary of a call note for inline chips + filter labels. */
export type CallNoteSummary = {
  body: string;
  author: string | null;
  created_at: string;
};

/** The newest note of ANY kind. Carries `kind` because the board chip
 *  colours by it — the operator must be able to tell a phone-call
 *  outcome from an order edit at a glance. */
export type LastNoteSummary = CallNoteSummary & { kind: NoteKind };

/** Per-owner note aggregate returned by aggregateNotesFor(). */
export type NoteAggregate = {
  note_count: number;
  last_call_note: CallNoteSummary | null;
  last_note: LastNoteSummary | null;
};

/** Narrow a stored kind string. Anything unrecognised reads as 'note'. */
export function asNoteKind(raw: unknown): NoteKind {
  return NOTE_KINDS.includes(raw as NoteKind) ? (raw as NoteKind) : "note";
}

/** Label + colours per kind. Shared by the board chip and the note panel
 *  so one kind never reads amber in one place and muted in the other. */
export const NOTE_KIND_STYLE: Record<
  NoteKind,
  { label: string; color: string; border: string }
> = {
  call: { label: "Call", color: "#F59E0B", border: "rgba(245,158,11,0.5)" },
  note: {
    label: "Note",
    color: "rgba(251,243,212,0.72)",
    border: "rgba(251,243,212,0.3)",
  },
  edit: { label: "Edit", color: "#7FD4C1", border: "rgba(127,212,193,0.5)" },
};

/** Chip width budget on the orders board. Longest note in prod is 117
 *  chars, so the chip truncates and the title attr carries the rest. */
export const NOTE_CHIP_MAX_CHARS = 45;

export function truncateNoteBody(body: string, max = NOTE_CHIP_MAX_CHARS): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1).trimEnd()}…`;
}

/** Trim + length-check a body. Returns null when valid. */
export function validateBody(raw: unknown): { body: string } | { error: string } {
  if (typeof raw !== "string") return { error: "Body is required." };
  const body = raw.trim();
  if (body.length < NOTE_BODY_MIN) return { error: "Body is required." };
  if (body.length > NOTE_BODY_MAX) {
    return { error: `Body must be ${NOTE_BODY_MAX} characters or fewer.` };
  }
  return { body };
}

/** Trim an author label. Empty → null. Caps at 60 chars so nothing exotic
 *  can be stashed here (author column is nullable + free-form). */
export function normalizeAuthor(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, 60);
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeKind(raw: unknown): NoteKind {
  // 'edit' is deliberately NOT reachable from the public POST endpoint —
  // edit rows only originate from the admin_edit_order RPC, which
  // writes them directly. So the POST body can only produce 'call' or
  // 'note'; a hostile 'edit' payload silently coerces to 'note'.
  return raw === "call" ? "call" : "note";
}

/** "Midday (10 AM – 2 PM)" from a stored slot value.
 *
 *  `formatSlotForDisplay` renders the canonical windows as
 *  "Midday · 10 AM – 2 PM". The middot reads fine in a table cell with a
 *  label column beside it and badly inside a sentence, so the period name
 *  is bracketed here instead. Legacy values (a bare "07:30" from the old
 *  30-minute grid) come back from `formatSlotForDisplay` with no middot at
 *  all and are passed through untouched — there is no period name to
 *  bracket, and inventing one would be a lie about what was booked. */
function noteSlotLabel(slot: string | null): string | null {
  if (!slot || slot.length === 0) return null;
  const display = formatSlotForDisplay(slot);
  if (!display) return null;
  const parts = display.split(" · ");
  return parts.length === 2 ? `${parts[0]} (${parts[1]})` : display;
}

/**
 * Wording for a customer-visible delivery-schedule edit note.
 *
 *   "Delivery moved from Sun 14 Sep, Morning (6 – 10 AM)
 *    to Mon 21 Sep, Midday (10 AM – 2 PM)."
 *
 * Takes RAW stored values — an ISO date and a slot value — and does every
 * bit of formatting itself. It used to take pre-formatted strings, which
 * is how a raw "2026-09-21" reached a customer's timeline: the one caller
 * formatted the slot and forgot the date, and nothing in the signature
 * said it had to. Raw in, sentence out, one place to change the wording.
 *
 * Dates go through `shareDateLabel`, which parses an IST calendar date as
 * UTC deliberately — see the note on that function. Running this through a
 * timezone is the one way to land a day early.
 *
 * Signature intentionally accepts nulls — a subscription delivery can
 * carry `scheduled_date` without a slot on legacy rows.
 */
export function formatDeliveryEditNote(before: {
  date: string | null;
  slot: string | null;
}, after: {
  date: string | null;
  slot: string | null;
}): string {
  const side = (part: { date: string | null; slot: string | null }) => {
    const date = part.date ? shareDateLabel(part.date) : "";
    const slot = noteSlotLabel(part.slot);
    const bits = [date.length > 0 ? date : "—", slot].filter(
      (x): x is string => Boolean(x),
    );
    return bits.join(", ");
  };
  return `Delivery moved from ${side(before)} to ${side(after)}.`;
}

/**
 * Batch-hydrate every order id with { note_count, last_call_note, last_note }.
 * Empty input → empty map. Never throws — a failure logs and returns
 * an empty map so the list endpoint stays online without notes.
 *
 * Fetches ALL note rows for the passed ids in one round trip and folds
 * them in memory; this keeps the shape flat and avoids one query per row.
 */
export async function aggregateNotesFor(
  supabase: SupabaseClient,
  which: "order" | "subscription",
  ids: string[],
): Promise<Map<string, NoteAggregate>> {
  const out = new Map<string, NoteAggregate>();
  if (ids.length === 0) return out;

  const column = which === "order" ? "order_id" : "subscription_id";

  const { data, error } = await supabase
    .from("order_notes")
    .select(`id, ${column}, kind, body, author, created_at`)
    .in(column, ids)
    // Newest first, so the first row we see per owner IS the latest note
    // (any kind), and the first kind='call' row IS the latest call.
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`[order-notes aggregate ${which}]`, error.message);
    return out;
  }

  for (const row of (data ?? []) as Array<{
    order_id?: string | null;
    subscription_id?: string | null;
    kind: string;
    body: string;
    author: string | null;
    created_at: string;
  }>) {
    const ownerId =
      which === "order" ? row.order_id ?? null : row.subscription_id ?? null;
    if (!ownerId) continue;
    const curr = out.get(ownerId) ?? {
      note_count: 0,
      last_call_note: null as CallNoteSummary | null,
      last_note: null as LastNoteSummary | null,
    };
    curr.note_count += 1;
    if (curr.last_note === null) {
      curr.last_note = {
        body: row.body,
        author: row.author,
        created_at: row.created_at,
        kind: asNoteKind(row.kind),
      };
    }
    if (row.kind === "call" && curr.last_call_note === null) {
      curr.last_call_note = {
        body: row.body,
        author: row.author,
        created_at: row.created_at,
      };
    }
    out.set(ownerId, curr);
  }

  return out;
}
