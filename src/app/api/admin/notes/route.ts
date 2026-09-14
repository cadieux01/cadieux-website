// /api/admin/notes — internal-note timeline for an order or subscription.
//
// GET  /api/admin/notes?order_id=<uuid>          — list, newest-first
// GET  /api/admin/notes?subscription_id=<uuid>   — list, newest-first
// POST /api/admin/notes                          — append one row
//     body: { order_id? | subscription_id?, kind?: 'note'|'call', body, author? }
//
// Append-only. There is NO PATCH and NO DELETE — the admin surface never
// mutates a note after it's written. Reads/writes bypass RLS via the
// service-role client; the row-level policy list on public.order_notes is
// EMPTY (RLS enabled with no policies), so nothing else can touch this
// table. Every call is gated by the same isAdmin() bearer/cookie the rest
// of /api/admin/* uses.
//
// Exactly one of order_id / subscription_id is accepted per request;
// supplying both, or neither, is a 400.

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

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const owner = readOwner(req.nextUrl.searchParams);
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
