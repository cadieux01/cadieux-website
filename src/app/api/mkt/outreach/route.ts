// POST /api/mkt/outreach — write one outreach row.
//
// Body:
//   customer_id: uuid    (required)
//   channel:     whatsapp|call|visit|other
//   outcome:     contacted|no_answer|not_interested|ordered|wrong_number|callback
//   segment:     free-form text (which /mkt chip the operator was working)
//   note:        optional string
//
// GATE: any authenticated profile with status='active'. created_by is
// pinned server-side to the signed-in user — the client cannot forge
// it.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { readMktSession } from "@/lib/mkt-auth";

const CHANNELS = ["whatsapp", "call", "visit", "other"] as const;
const OUTCOMES = [
  "contacted",
  "no_answer",
  "not_interested",
  "ordered",
  "wrong_number",
  "callback",
] as const;

function logisticsService() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { schema: "logistics" },
    },
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const state = await readMktSession();
  if (state.kind !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await req.json().catch(() => ({}));
  const customer_id = typeof raw?.customer_id === "string" ? raw.customer_id : "";
  const channel = typeof raw?.channel === "string" ? raw.channel : "";
  const outcome = typeof raw?.outcome === "string" ? raw.outcome : "";
  const segment = typeof raw?.segment === "string" ? raw.segment : null;
  const note = typeof raw?.note === "string" ? raw.note.trim() : null;

  if (!UUID_RE.test(customer_id)) {
    return NextResponse.json({ error: "customer_id is required" }, { status: 400 });
  }
  if (!(CHANNELS as readonly string[]).includes(channel)) {
    return NextResponse.json({ error: "channel is invalid" }, { status: 400 });
  }
  if (!(OUTCOMES as readonly string[]).includes(outcome)) {
    return NextResponse.json({ error: "outcome is invalid" }, { status: 400 });
  }

  // Note caps — a 400 KB body in a 'note' field is almost certainly an
  // operator paste accident. Reject at the gate rather than let the
  // row land and bloat downstream reads.
  if (note && note.length > 2000) {
    return NextResponse.json({ error: "note is too long" }, { status: 400 });
  }

  const svc = logisticsService();
  const { data, error } = await svc
    .from("outreach")
    .insert({
      customer_id,
      channel,
      outcome,
      segment,
      note: note && note.length > 0 ? note : null,
      created_by: state.profile.id,
    })
    .select("id, created_at")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data?.id, created_at: data?.created_at });
}
