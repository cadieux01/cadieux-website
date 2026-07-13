import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

// GET  /api/admin/whatsapp/conversations/[id]      → conversation + all messages
// PATCH /api/admin/whatsapp/conversations/[id]     → { action: "resolve" }
//                                                    clears needs_human back to open.
//
// The dashboard Chat page uses GET for the thread view and PATCH's "resolve"
// action to mark a handoff as handled. Resolving deliberately does NOT clear
// last_handoff_at / handoff_reason — those stay as the audit trail of the
// last escalation. When the customer sends a new message that trips the bot
// again, whatsapp-inbound will re-flag and a NEW email will fire.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const { data: conversation, error: cErr } = await supabaseAdmin
    .from("whatsapp_conversations")
    .select(
      "id, phone, customer_id, status, last_inbound_at, last_outbound_at, last_message_at, last_handoff_at, handoff_reason, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (cErr) {
    console.error("[admin/whatsapp/conversations get]", cErr.message);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let customer = null;
  if (conversation.customer_id) {
    const { data } = await supabaseAdmin
      .from("customers")
      .select("id, full_name, phone")
      .eq("id", conversation.customer_id)
      .maybeSingle();
    customer = data ?? null;
  }

  const { data: messages, error: mErr } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("id, direction, body, wa_message_id, status, ai_generated, sent_at, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });
  if (mErr) {
    console.error("[admin/whatsapp/conversations messages]", mErr.message);
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }

  const lastInboundMs = conversation.last_inbound_at
    ? new Date(conversation.last_inbound_at as string).getTime()
    : 0;
  const window_open = lastInboundMs > Date.now() - 24 * 3600 * 1000;

  return NextResponse.json({
    conversation: { ...conversation, customer, window_open },
    messages: messages ?? [],
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  let body: { action?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  let nextStatus: "open" | "closed" | null = null;
  if (action === "resolve") nextStatus = "open";
  else if (action === "close") nextStatus = "closed";
  else if (action === "reopen") nextStatus = "open";
  else {
    return NextResponse.json(
      { error: "Unknown action. Use resolve, close, or reopen." },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("whatsapp_conversations")
    .update({ status: nextStatus })
    .eq("id", id)
    .select("id, status")
    .maybeSingle();
  if (error) {
    console.error("[admin/whatsapp/conversations patch]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id: data.id, status: data.status });
}
