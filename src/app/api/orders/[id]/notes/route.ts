// /api/orders/[id]/notes
//
// Returns the customer-visible order_notes rows for the order that the
// verified phone owns. Reads-only, no writes.
//
// Auth model (two gates, both required):
//   1. `getVerifiedPhone(req)` must return a valid session — proves the
//      caller has passed OTP for SOME phone.
//   2. That phone must own the requested order — the customer row for
//      the verified phone must equal orders.customer_id.
//
// The second gate is the critical one. A phone-verified session proves
// the caller is *a* customer, not *this* order's customer. Without the
// ownership join, any verified customer could read any order's edit
// notes.
//
// On any failure — bad id, no session, session but wrong owner, no
// row at all — we respond 404 (not 403). No existence disclosure.
//
// Filter: customer_visible = true only. Internal 'note' and 'call'
// rows never leak here. The admin panel has its own endpoint at
// /api/admin/notes for those.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { getVerifiedPhone } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CustomerNoteRow = {
  id: string;
  kind: "note" | "call" | "edit";
  body: string;
  meta: unknown;
  created_at: string;
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = (params.id || "").trim();
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Gate 1: session.
  const verified = getVerifiedPhone(req);
  if (!verified) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Gate 2: ownership. Resolve the caller's customer id from the
  // verified phone, then confirm this order is theirs. Same pattern
  // as GET /api/orders/[id] — a 404 for every failure so an attacker
  // can't distinguish "no such order" from "not yours".
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (!customer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("customer_id")
    .eq("id", id)
    .maybeSingle();
  if (!order || order.customer_id !== customer.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only customer_visible rows. Internal 'note' + 'call' rows are
  // filtered by the DB, not by us — a bug in this handler that
  // dropped the filter would still not leak them past the RLS-less
  // service-role read below unless the flag were also flipped in the
  // DB, but defence in depth: filter here explicitly.
  const { data: rows, error } = await supabaseAdmin
    .from("order_notes")
    .select("id, kind, body, meta, created_at")
    .eq("order_id", id)
    .eq("customer_visible", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[orders/[id]/notes] fetch failed:", error.message);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ notes: (rows ?? []) as CustomerNoteRow[] });
}
