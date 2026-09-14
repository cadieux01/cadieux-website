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

export type NoteKind = "note" | "call";

export const NOTE_KINDS: readonly NoteKind[] = ["note", "call"] as const;

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

/** Per-owner note aggregate returned by aggregateNotesFor(). */
export type NoteAggregate = {
  note_count: number;
  last_call_note: CallNoteSummary | null;
};

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
  return raw === "call" ? "call" : "note";
}

/**
 * Batch-hydrate every order id with { note_count, last_call_note }.
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
    // Newest first so the first call row we see per owner IS the latest.
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
    };
    curr.note_count += 1;
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
