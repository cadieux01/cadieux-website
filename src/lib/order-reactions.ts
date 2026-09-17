// Server-side helpers for public.order_reactions.
//
// Shape (see supabase/migrations/20260917060000_create_order_reactions.sql):
//   id uuid pk
//   order_id uuid null -> public.orders(id) on delete cascade
//   subscription_id uuid null -> public.subscriptions(id) on delete cascade
//   author text not null      -- 1..60 chars
//   emoji text not null       -- 1..32 chars
//   created_at timestamptz not null default now()
// Exactly one of order_id/subscription_id is non-null, and (parent, author)
// is unique — one reaction per admin per row.
//
// RLS enabled with NO policies; every read/write goes through supabaseAdmin
// (service role) behind isAdmin(). Reactions are internal triage, never
// customer-visible.

import type { SupabaseClient } from "@supabase/supabase-js";

export const REACTION_EMOJI_MAX = 32;
export const REACTION_AUTHOR_MAX = 60;

export type OrderReactionRow = {
  id: string;
  order_id: string | null;
  subscription_id: string | null;
  author: string;
  emoji: string;
  created_at: string;
};

/** One distinct emoji on a row, with who put it there. */
export type ReactionTally = {
  emoji: string;
  count: number;
  /** Authors, so the client can tell whether THIS admin is among them. */
  authors: string[];
};

/**
 * Reject anything that is not a single user-perceived emoji.
 *
 * Length alone is not enough: the column is rendered raw into the board, so
 * "  URGENT  " would pass a 1..32 length check and paint a word into a slot
 * sized for one glyph. Requiring at least one Extended_Pictographic code
 * point and forbidding whitespace/ASCII keeps it to the palette's domain
 * without hard-coding the palette here (the client set can grow).
 */
// Built with `new RegExp(..., "u")` rather than as /…/u literals. tsconfig.json
// sets no `target`, so tsc defaults to ES5 and rejects the `u` flag on a literal
// (TS1501) — while the runtime (Node 18+ / every browser this admin runs on)
// supports it fine. Constructing them sidesteps the compile-time check without
// widening `target` for the whole repo. Both are module-level so the patterns
// are compiled once, not per keystroke.
const PICTOGRAPHIC = new RegExp("\\p{Extended_Pictographic}", "u");
const NOT_EMOJI_CHARS = new RegExp("[\\s\\p{L}\\p{N}]", "u");

export function validateEmoji(raw: unknown): { emoji: string } | { error: string } {
  if (typeof raw !== "string") return { error: "Emoji is required." };
  const emoji = raw.trim();
  if (emoji.length === 0) return { error: "Emoji is required." };
  if (emoji.length > REACTION_EMOJI_MAX) {
    return { error: `Emoji must be ${REACTION_EMOJI_MAX} characters or fewer.` };
  }
  if (!PICTOGRAPHIC.test(emoji)) {
    return { error: "Not an emoji." };
  }
  // No spaces, no letters, no digits — blocks "🔥 URGENT" and "🔥x10", which
  // both satisfy the pictographic test on their own.
  if (NOT_EMOJI_CHARS.test(emoji)) {
    return { error: "Not an emoji." };
  }
  return { emoji };
}

/** Trim + require an author. Unlike notes, null is not a legal value here. */
export function validateAuthor(raw: unknown): { author: string } | { error: string } {
  if (typeof raw !== "string") return { error: "Author is required." };
  const author = raw.trim().slice(0, REACTION_AUTHOR_MAX);
  if (author.length === 0) return { error: "Author is required." };
  return { author };
}

/**
 * Batch-hydrate every id with its reaction tallies, newest emoji last.
 *
 * Never throws — a failure logs and returns an empty map, so a board still
 * renders its orders when the reactions table is unreachable. Reactions are
 * a nicety; the delivery list is not.
 */
export async function aggregateReactionsFor(
  supabase: SupabaseClient,
  which: "order" | "subscription",
  ids: string[],
): Promise<Map<string, ReactionTally[]>> {
  const out = new Map<string, ReactionTally[]>();
  if (ids.length === 0) return out;

  const column = which === "order" ? "order_id" : "subscription_id";

  const { data, error } = await supabase
    .from("order_reactions")
    .select(`${column}, author, emoji, created_at`)
    .in(column, ids)
    // Oldest first, so tallies read left-to-right in the order they were
    // added and a row's badges don't reshuffle when someone reacts.
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`[order-reactions aggregate ${which}]`, error.message);
    return out;
  }

  for (const row of (data ?? []) as Array<{
    order_id?: string | null;
    subscription_id?: string | null;
    author: string;
    emoji: string;
  }>) {
    const ownerId =
      which === "order" ? row.order_id ?? null : row.subscription_id ?? null;
    if (!ownerId) continue;
    const list = out.get(ownerId) ?? [];
    const hit = list.find((t) => t.emoji === row.emoji);
    if (hit) {
      hit.count += 1;
      hit.authors.push(row.author);
    } else {
      list.push({ emoji: row.emoji, count: 1, authors: [row.author] });
    }
    out.set(ownerId, list);
  }

  return out;
}
