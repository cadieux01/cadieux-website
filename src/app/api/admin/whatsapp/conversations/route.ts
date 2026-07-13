import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

// GET /api/admin/whatsapp/conversations?status=needs_human|open|closed|all
//
// Admin queue for WhatsApp conversations. Sorted with flagged (needs_human)
// first, then by most recent message. Returns one row per conversation with
// the last message body/direction and a boolean for the 24h free-reply gate.
//
// Kept lean intentionally: the dashboard hydrates the full message thread
// via the /[id]/messages route only when the admin clicks a row.

const ALLOWED = new Set(["all", "needs_human", "open", "closed"]);
const WINDOW_HOURS = 24;

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filter = (req.nextUrl.searchParams.get("status") ?? "all").toLowerCase();
  if (!ALLOWED.has(filter)) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  let convQuery = supabaseAdmin
    .from("whatsapp_conversations")
    .select(
      "id, phone, customer_id, status, last_inbound_at, last_outbound_at, last_message_at, last_handoff_at, handoff_reason, created_at, updated_at",
    )
    // Sort: needs_human ahead of everything else, then most recent activity.
    // Postgres 'text' sort puts 'closed' < 'needs_human' < 'open', so we sort
    // in JS after the fetch to guarantee needs_human is always first.
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (filter !== "all") {
    convQuery = convQuery.eq("status", filter);
  }

  const { data: conversations, error } = await convQuery;
  if (error) {
    console.error("[admin/whatsapp/conversations list]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!conversations || conversations.length === 0) {
    return NextResponse.json({ conversations: [] });
  }

  // Hydrate customer names when we have them.
  const customerIds = Array.from(
    new Set(conversations.map((c) => c.customer_id).filter(Boolean)),
  );
  const { data: customers } =
    customerIds.length > 0
      ? await supabaseAdmin
          .from("customers")
          .select("id, full_name, phone")
          .in("id", customerIds)
      : { data: [] };
  const cmap = new Map((customers ?? []).map((c) => [c.id, c]));

  // Pull the latest message per conversation for a preview. One round-trip:
  // fetch a bounded window and reduce in JS. Ordering by created_at DESC and
  // taking the first hit per conversation_id gives us the "last message".
  const convIds = conversations.map((c) => c.id);
  const { data: recentMsgs } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("conversation_id, direction, body, created_at, ai_generated")
    .in("conversation_id", convIds)
    .order("created_at", { ascending: false })
    .limit(convIds.length * 4); // small buffer to catch the newest per conv
  const lastByConv = new Map<
    string,
    { direction: string; body: string; created_at: string; ai_generated: boolean }
  >();
  for (const m of recentMsgs ?? []) {
    if (!lastByConv.has(m.conversation_id as string)) {
      lastByConv.set(m.conversation_id as string, {
        direction: m.direction as string,
        body: m.body as string,
        created_at: m.created_at as string,
        ai_generated: (m.ai_generated as boolean) ?? false,
      });
    }
  }

  const now = Date.now();
  const cutoff = now - WINDOW_HOURS * 3600 * 1000;

  const rows = conversations.map((c) => {
    const last = lastByConv.get(c.id as string) ?? null;
    const lastInboundMs = c.last_inbound_at
      ? new Date(c.last_inbound_at as string).getTime()
      : 0;
    return {
      id: c.id,
      phone: c.phone,
      customer: c.customer_id ? cmap.get(c.customer_id) ?? null : null,
      status: c.status,
      last_inbound_at: c.last_inbound_at,
      last_outbound_at: c.last_outbound_at,
      last_message_at: c.last_message_at,
      last_handoff_at: c.last_handoff_at,
      handoff_reason: c.handoff_reason,
      window_open: lastInboundMs > cutoff,
      last_message: last,
    };
  });

  // needs_human first, then last_message_at desc.
  rows.sort((a, b) => {
    const aFlag = a.status === "needs_human" ? 0 : 1;
    const bFlag = b.status === "needs_human" ? 0 : 1;
    if (aFlag !== bFlag) return aFlag - bFlag;
    const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return bt - at;
  });

  return NextResponse.json({ conversations: rows });
}
