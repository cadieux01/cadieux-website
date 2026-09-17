// /api/admin/reactions — one emoji reaction per admin per order/subscription.
//
// GET  /api/admin/reactions?order_id=<uuid>         — tallies for one row
// GET  /api/admin/reactions?subscription_id=<uuid>
// POST /api/admin/reactions                         — toggle
//     body: { order_id? | subscription_id?, emoji, author }
//
// POST is a TOGGLE, not an append:
//   no reaction from this author        -> insert
//   same emoji from this author         -> delete  (tap the same one to undo)
//   different emoji from this author    -> update  (one per admin per row)
// It is therefore idempotent in pairs — two identical POSTs leave the row
// exactly as it started, which is what a double-tap on a phone produces.
//
// There is no DELETE verb because the toggle covers removal and a separate
// endpoint would be a second way to reach the same state.
//
// Reads/writes bypass RLS via the service-role client; public.order_reactions
// has RLS enabled with an EMPTY policy list, so nothing else can touch it.
// Every call is gated by the same isAdmin() bearer/cookie as the rest of
// /api/admin/*.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import {
  aggregateReactionsFor,
  validateAuthor,
  validateEmoji,
} from "@/lib/order-reactions";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readOwner(
  params: URLSearchParams | Record<string, unknown>,
):
  | { kind: "order"; id: string }
  | { kind: "subscription"; id: string }
  | { error: string } {
  const get = (k: string): string | null => {
    if (params instanceof URLSearchParams) return params.get(k);
    const v = (params as Record<string, unknown>)[k];
    return typeof v === "string" ? v : null;
  };
  const orderId = get("order_id");
  const subId = get("subscription_id");
  if (orderId && subId) {
    return { error: "Pass exactly one of order_id / subscription_id." };
  }
  if (orderId) {
    if (!UUID_RE.test(orderId)) return { error: "Invalid order_id." };
    return { kind: "order", id: orderId };
  }
  if (subId) {
    if (!UUID_RE.test(subId)) return { error: "Invalid subscription_id." };
    return { kind: "subscription", id: subId };
  }
  return { error: "order_id or subscription_id is required." };
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const owner = readOwner(req.nextUrl.searchParams);
  if ("error" in owner) {
    return NextResponse.json({ error: owner.error }, { status: 400 });
  }
  const map = await aggregateReactionsFor(supabaseAdmin, owner.kind, [owner.id]);
  return NextResponse.json({ reactions: map.get(owner.id) ?? [] });
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const owner = readOwner(body);
  if ("error" in owner) {
    return NextResponse.json({ error: owner.error }, { status: 400 });
  }
  const emojiCheck = validateEmoji(body.emoji);
  if ("error" in emojiCheck) {
    return NextResponse.json({ error: emojiCheck.error }, { status: 400 });
  }
  const authorCheck = validateAuthor(body.author);
  if ("error" in authorCheck) {
    return NextResponse.json({ error: authorCheck.error }, { status: 400 });
  }

  const column = owner.kind === "order" ? "order_id" : "subscription_id";

  // Existing reaction from THIS author on THIS row, if any. The unique index
  // guarantees at most one, so maybeSingle() is safe.
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("order_reactions")
    .select("id, emoji")
    .eq(column, owner.id)
    .eq("author", authorCheck.author)
    .maybeSingle();
  if (readErr) {
    console.error("[admin/reactions POST read]", readErr.message);
    return NextResponse.json(
      { error: "Failed to read reaction." },
      { status: 500 },
    );
  }

  if (existing && existing.emoji === emojiCheck.emoji) {
    // Same emoji again -> remove it.
    const { error } = await supabaseAdmin
      .from("order_reactions")
      .delete()
      .eq("id", existing.id);
    if (error) {
      console.error("[admin/reactions POST delete]", error.message);
      return NextResponse.json(
        { error: "Failed to remove reaction." },
        { status: 500 },
      );
    }
    return NextResponse.json(await tallies(owner));
  }

  if (existing) {
    // Different emoji -> replace, keeping one per admin per row.
    const { error } = await supabaseAdmin
      .from("order_reactions")
      .update({ emoji: emojiCheck.emoji })
      .eq("id", existing.id);
    if (error) {
      console.error("[admin/reactions POST update]", error.message);
      return NextResponse.json(
        { error: "Failed to save reaction." },
        { status: 500 },
      );
    }
    return NextResponse.json(await tallies(owner));
  }

  // First reaction from this author. Confirm the parent exists first — the
  // FK cascade only fires on parent DELETE, so a stale id would otherwise
  // surface as an opaque 23503 instead of a useful 404.
  const parentTable = owner.kind === "order" ? "orders" : "subscriptions";
  const { data: parent, error: parentErr } = await supabaseAdmin
    .from(parentTable)
    .select("id")
    .eq("id", owner.id)
    .maybeSingle();
  if (parentErr) {
    console.error("[admin/reactions POST parent lookup]", parentErr.message);
    return NextResponse.json(
      { error: "Failed to verify parent" },
      { status: 500 },
    );
  }
  if (!parent) {
    return NextResponse.json(
      {
        error:
          owner.kind === "order" ? "Order not found." : "Subscription not found.",
      },
      { status: 404 },
    );
  }

  const { error: insErr } = await supabaseAdmin.from("order_reactions").insert({
    [column]: owner.id,
    author: authorCheck.author,
    emoji: emojiCheck.emoji,
  });
  if (insErr) {
    // 23505 = unique violation: a second tab inserted between our read and
    // our write. The user's intent (this emoji, this row) is already the
    // stored state or one update away, so re-run the toggle rather than
    // showing an error for a race they cannot see.
    if (insErr.code === "23505") {
      const { error: retryErr } = await supabaseAdmin
        .from("order_reactions")
        .update({ emoji: emojiCheck.emoji })
        .eq(column, owner.id)
        .eq("author", authorCheck.author);
      if (!retryErr) return NextResponse.json(await tallies(owner));
    }
    console.error("[admin/reactions POST insert]", insErr.message);
    return NextResponse.json(
      { error: "Failed to save reaction." },
      { status: 500 },
    );
  }

  return NextResponse.json(await tallies(owner));
}

/** Re-read the row's tallies so the client renders server truth, not a guess. */
async function tallies(owner: { kind: "order" | "subscription"; id: string }) {
  const map = await aggregateReactionsFor(supabaseAdmin, owner.kind, [owner.id]);
  return { reactions: map.get(owner.id) ?? [] };
}
