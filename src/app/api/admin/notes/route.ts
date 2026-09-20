// /api/admin/notes — internal-note timeline for an order or subscription.
//
// GET  /api/admin/notes?order_id=<uuid>              — one owner, newest-first
// GET  /api/admin/notes?subscription_id=<uuid>       — one owner, newest-first
// GET  /api/admin/notes?order_ids=<uuid,uuid,…>      — batch, oldest-first per owner
// GET  /api/admin/notes?subscription_ids=<uuid,…>    — batch, oldest-first per owner
// POST /api/admin/notes                              — append one row
//     body: { order_id? | subscription_id?, kind?: 'note'|'call', body, author? }
//
// Append-only. There is NO PATCH and NO DELETE — the admin surface never
// mutates a note after it's written. Reads/writes bypass RLS via the
// service-role client; the row-level policy list on public.order_notes is
// EMPTY (RLS enabled with no policies), so nothing else can touch this
// table. Every call is gated by the same isAdmin() bearer/cookie the rest
// of /api/admin/* uses.
//
// Exactly one of order_id / subscription_id / order_ids / subscription_ids
// is accepted per GET; supplying more than one, or none, is a 400.
//
// The batch variant is what feeds the packing-list print page — one
// round trip for N orders instead of N. Response shape differs from the
// single-owner variant on purpose: consumers of the batch always want
// the rows grouped by owner and rendered oldest-first (a driver's slip
// reads top→bottom in time order), so the endpoint does the grouping
// and the sort so no two callers do it two different ways.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import {
  normalizeAuthor,
  normalizeKind,
  validateBody,
  type OrderNoteRow,
} from "@/lib/order-notes";

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

// Batch variant: accepts ?order_ids=<comma> or ?subscription_ids=<comma>.
// Returns exactly one kind — mixed passes 400 so the caller never has to
// deal with two column layouts in one response. Cap at 250 ids so a
// runaway URL cannot pull the whole table by accident.
const BATCH_ID_CAP = 250;

function readOwnerBatch(
  params: URLSearchParams,
):
  | { kind: "order"; ids: string[] }
  | { kind: "subscription"; ids: string[] }
  | { error: string }
  | null {
  const orderIdsRaw = params.get("order_ids");
  const subIdsRaw = params.get("subscription_ids");
  if (!orderIdsRaw && !subIdsRaw) return null;
  if (orderIdsRaw && subIdsRaw) {
    return { error: "Pass exactly one of order_ids / subscription_ids." };
  }
  const raw = (orderIdsRaw ?? subIdsRaw)!.trim();
  if (raw.length === 0) return { error: "Batch id list is empty." };
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { error: "Batch id list is empty." };
  if (parts.length > BATCH_ID_CAP) {
    return { error: `Batch is capped at ${BATCH_ID_CAP} ids.` };
  }
  for (const p of parts) {
    if (!UUID_RE.test(p)) return { error: `Invalid id in batch: ${p}` };
  }
  // De-dupe — harmless to the query but keeps the response map tidy.
  const seen = new Set<string>();
  const ids = parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
  return orderIdsRaw
    ? { kind: "order", ids }
    : { kind: "subscription", ids };
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;

  // Batch mode wins when either *_ids param is present. Falls through
  // to the single-owner path when neither is set, so the pre-existing
  // ?order_id=<uuid> callers see identical behaviour.
  const batch = readOwnerBatch(searchParams);
  if (batch !== null) {
    if ("error" in batch) {
      return NextResponse.json({ error: batch.error }, { status: 400 });
    }
    const column = batch.kind === "order" ? "order_id" : "subscription_id";
    const { data, error } = await supabaseAdmin
      .from("order_notes")
      .select("id, order_id, subscription_id, kind, body, author, created_at")
      .in(column, batch.ids)
      // Oldest first so the caller reading top→bottom sees the note
      // trail in the order it was written. The single-owner variant
      // stays newest-first for the notes panel; batch consumers (the
      // packing-list print page) render oldest-first, so the sort lives
      // where the render style lives.
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[admin/notes GET batch]", error.message);
      return NextResponse.json(
        { error: "Failed to load notes." },
        { status: 500 },
      );
    }
    // Group by owner id. Missing owners get an empty array so the caller
    // does not have to `?? []` at every render site.
    const notesByOwnerId: Record<string, OrderNoteRow[]> = {};
    for (const id of batch.ids) notesByOwnerId[id] = [];
    for (const row of (data ?? []) as OrderNoteRow[]) {
      const ownerId =
        batch.kind === "order"
          ? row.order_id ?? null
          : row.subscription_id ?? null;
      if (!ownerId || !(ownerId in notesByOwnerId)) continue;
      notesByOwnerId[ownerId].push(row);
    }
    return NextResponse.json({ notesByOwnerId });
  }

  const owner = readOwner(searchParams);
  if ("error" in owner) {
    return NextResponse.json({ error: owner.error }, { status: 400 });
  }
  const column = owner.kind === "order" ? "order_id" : "subscription_id";
  const { data, error } = await supabaseAdmin
    .from("order_notes")
    .select("id, order_id, subscription_id, kind, body, author, created_at")
    .eq(column, owner.id)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[admin/notes GET]", error.message);
    return NextResponse.json({ error: "Failed to load notes." }, { status: 500 });
  }
  return NextResponse.json({ notes: (data ?? []) as OrderNoteRow[] });
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
  const bodyCheck = validateBody(body.body);
  if ("error" in bodyCheck) {
    return NextResponse.json({ error: bodyCheck.error }, { status: 400 });
  }
  const kind = normalizeKind(body.kind);
  const author = normalizeAuthor(body.author);

  // Confirm the parent row exists before we write — a caller with a
  // stale/typo id would otherwise leave an orphan visible to nothing (the
  // FK cascade only fires when the parent is deleted, not when it never
  // existed). Cheaper than a failed insert on a bad UUID and produces a
  // useful 404.
  const parentTable = owner.kind === "order" ? "orders" : "subscriptions";
  const { data: parent, error: parentErr } = await supabaseAdmin
    .from(parentTable)
    .select("id")
    .eq("id", owner.id)
    .maybeSingle();
  if (parentErr) {
    console.error("[admin/notes POST parent lookup]", parentErr.message);
    return NextResponse.json({ error: "Failed to verify parent" }, { status: 500 });
  }
  if (!parent) {
    return NextResponse.json(
      { error: owner.kind === "order" ? "Order not found." : "Subscription not found." },
      { status: 404 },
    );
  }

  const insertRow = {
    [owner.kind === "order" ? "order_id" : "subscription_id"]: owner.id,
    kind,
    body: bodyCheck.body,
    author,
  };

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("order_notes")
    .insert(insertRow)
    .select("id, order_id, subscription_id, kind, body, author, created_at")
    .single();
  if (insErr || !inserted) {
    console.error("[admin/notes POST insert]", insErr?.message);
    return NextResponse.json({ error: "Failed to save note." }, { status: 500 });
  }

  return NextResponse.json({ note: inserted as OrderNoteRow });
}
