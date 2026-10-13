// Server-side helpers for public.order_contacts.
//
// Shape (migration: supabase/migrations/20261013010000_create_order_contacts.sql,
// applied to prod 2026-10-13):
//   order_id uuid not null -> public.orders(id) on delete cascade
//   channel text not null            -- 'call' | 'whatsapp' | 'sms'
//   first_contacted_at timestamptz not null default now()
//   last_contacted_at  timestamptz not null default now()
//   press_count integer not null default 1
//   last_author text null
//   primary key (order_id, channel)
// RLS enabled with NO policies and all grants revoked from anon/authenticated.
// Every read and write goes through supabaseAdmin (service role), and every
// entry point is admin-gated.
//
// WHAT A ROW MEANS: somebody on the team opened this channel for this order.
// It does NOT mean they spoke to anyone, and it is NOT an audit log — a
// repeat press updates the row rather than adding one. The orders board
// paints the button green off the row's existence and nothing else.
//
// ░░ WHY THIS IS NOT order_notes ░░
//
// A call could have been recorded as an order_notes row with kind='call'.
// It must not be. hasNewUpdate() (src/lib/order-new-update.ts) flags an
// order when a note was written strictly after the status was last set, so
// every press of the Call button would light that row up as NEW UPDATE —
// a flag whose meaning is "somebody wrote something you have not read" —
// on the strength of the reader's own click. Within a day the flag is noise
// and the operator stops seeing it, which costs us the real notes too.
//
// A press is not a note. Separate table, separate meaning.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The three buttons, and only these three.
 *
 * 'sms' rather than 'message' because that is what the href scheme and
 * smsHref() already call it; "Message" is the word on the button, not the
 * word in the schema. The CHECK constraint on the column holds the same
 * three strings — adding a fourth here without adding it there produces a
 * write that fails at the database with a constraint violation, which is
 * the correct way round for this to break.
 */
export const CONTACT_CHANNELS = ["call", "whatsapp", "sms"] as const;

export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export function isContactChannel(v: unknown): v is ContactChannel {
  return (
    typeof v === "string" && (CONTACT_CHANNELS as readonly string[]).includes(v)
  );
}

/** One channel's state on one order. Present means green. */
export type ContactPress = {
  first_contacted_at: string;
  last_contacted_at: string;
  press_count: number;
  last_author: string | null;
};

/**
 * Which channels are green on one order.
 *
 * Partial on purpose: an ABSENT key is the "never contacted" case, and it is
 * the same shape whether the order has genuinely never been contacted or the
 * read failed. See aggregateContactsFor — that collapse is deliberate and is
 * the safe direction.
 */
export type OrderContacts = Partial<Record<ContactChannel, ContactPress>>;

/**
 * Batch-hydrate every order id with its per-channel contact state.
 * Empty input → empty map. Never throws.
 *
 * ░░ A FAILURE RETURNS AN EMPTY MAP, SO EVERY BUTTON GOES BACK TO RED. ░░
 *
 * That direction is chosen, not incidental. The two ways this can be wrong
 * are not equal:
 *
 *   red when it should be green — somebody rings a customer who has already
 *                                 been rung. Mildly annoying, self-correcting
 *                                 the moment they speak.
 *   green when it should be red — NOBODY RINGS AT ALL, because the board says
 *                                 it is handled. The order goes quiet and the
 *                                 failure is invisible.
 *
 * The whole feature exists to get customers called, so it must fail towards
 * calling them. Same way aggregateNotesFor() degrades, for the same reason.
 */
export async function aggregateContactsFor(
  supabase: SupabaseClient,
  orderIds: string[],
): Promise<Map<string, OrderContacts>> {
  const out = new Map<string, OrderContacts>();
  if (orderIds.length === 0) return out;

  // Chunked at 200 for the same hard reason as aggregateNotesFor(), and an
  // `.in()` filter has TWO independent ceilings in two different layers.
  // Whichever bites first depends on the rest of the request, so clear both:
  //
  //   1. ~16 kB of RESPONSE HEADER, in Node. PostgREST echoes the whole query
  //      string back in a `content-location` header and undici caps headers
  //      at 16 kB → UND_ERR_HEADERS_OVERFLOW after ~9 s of retries. Bites at
  //      roughly 430 ids.
  //   2. ~25 kB of REQUEST URI, at the Supabase gateway, and it is BYTES not
  //      id count — 400 ids plus 10,200 chars of dummy query string fails
  //      where the same 400 ids alone succeed. Measured on prod 2026-10-13:
  //      674 ids (25,020 chars) → 200, 675 ids (25,057 chars) → 400.
  //
  // Both are documented at greater length on aggregateNotesFor() in
  // order-notes.ts — go there for the measurements rather than keeping two
  // copies of them in step. Deliberately not cited by line number: that
  // comment was rewritten the same day this landed, and a line reference
  // goes stale silently while still pointing at something plausible.
  //
  // A gateway rejection is a bare `Bad Request` in text/plain with no JSON
  // code/message/details/hint, because the request never reached the
  // database. Three windows have now lost time trying to extract more from
  // it. 200 ids is ~7 kB, which clears both ceilings with room to spare.
  //
  // This matters MORE here than it does for notes. Both failures are silent
  // (empty map, board renders on), but a board past ~430 orders losing its
  // note icons looks wrong immediately, whereas losing the contact colours
  // looks exactly like "nobody has been contacted yet" — a plausible,
  // actionable, completely false reading.
  const CHUNK = 200;
  const chunks: string[][] = [];
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    chunks.push(orderIds.slice(i, i + CHUNK));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("order_contacts")
        .select(
          "order_id, channel, first_contacted_at, last_contacted_at, press_count, last_author",
        )
        .in("order_id", chunk),
    ),
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) {
    console.error("[order-contacts aggregate]", failed.error.message);
    return out;
  }

  // No .order() anywhere above, and none is needed: the primary key is
  // (order_id, channel), so there is at most ONE row per pair and the fold
  // below has nothing to choose between. This is the payoff of the composite
  // key — aggregateNotesFor() has to sort newest-first and take the first
  // match per owner precisely because order_notes allows many rows.
  for (const row of (results.flatMap((r) => r.data ?? []) ?? []) as Array<{
    order_id: string | null;
    channel: string;
    first_contacted_at: string;
    last_contacted_at: string;
    press_count: number;
    last_author: string | null;
  }>) {
    if (!row.order_id) continue;
    // Unrecognised channel strings are dropped rather than coerced. The CHECK
    // constraint means one should not exist; if a future channel is added to
    // the database ahead of the UI, dropping it leaves that button red, which
    // is the safe direction above.
    if (!isContactChannel(row.channel)) continue;

    const curr = out.get(row.order_id) ?? {};
    curr[row.channel] = {
      first_contacted_at: row.first_contacted_at,
      last_contacted_at: row.last_contacted_at,
      press_count: row.press_count,
      last_author: row.last_author,
    };
    out.set(row.order_id, curr);
  }

  return out;
}
