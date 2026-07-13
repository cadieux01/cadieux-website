import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import {
  adminWhatsappSendRateLimit,
  getClientIP,
} from "@/lib/ratelimit";
import { logLogisticsAudit } from "@/lib/logistics-audit";

// POST /api/admin/whatsapp/conversations/[id]/send
//
// Super-admin sends a free-form WhatsApp reply to the conversation's phone.
// This route is a THIN RELAY to the existing whatsapp-send edge function so
// the MSG91 send code + 24h free-form gate + whatsapp_messages insert
// happen in exactly one place (the same path the bot uses). We add:
//   • admin auth (isAdmin cookie/bearer)
//   • rate-limit (per IP)
//   • audit trail (who, when, what)
//   • surfacing MSG91's real error text back to the UI
//   • ai_generated = false → the row appears as a human/team reply
//
// 24h-window handling: the edge function returns HTTP 409 with
// { window_closed: true } when Meta's customer-service window has expired.
// We propagate that verbatim so the dashboard can disable the reply box.

const WINDOW_HOURS = 24;

export async function POST(
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

  // Rate limit — a compromised admin session should not be able to blast
  // customers from our Business API number.
  const ip = getClientIP(req);
  const { success } = await adminWhatsappSendRateLimit.limit(`ip:${ip}`);
  if (!success) {
    return NextResponse.json(
      { error: "Too many replies — slow down for a moment." },
      { status: 429 },
    );
  }

  let body: { text?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Empty message." }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json(
      { error: "Message too long (max 4000 characters)." },
      { status: 400 },
    );
  }

  // Look up the conversation to get the phone we're sending to.
  const { data: conv, error: cErr } = await supabaseAdmin
    .from("whatsapp_conversations")
    .select("id, phone, last_inbound_at")
    .eq("id", id)
    .maybeSingle();
  if (cErr) {
    console.error("[admin/whatsapp/send lookup]", cErr.message);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if (!conv?.phone) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  // Client-side gate mirrors the edge function's server-side gate — but
  // rejecting here means we never even attempt the MSG91 send when the
  // window is obviously closed, saving a network round-trip.
  const lastInboundMs = conv.last_inbound_at
    ? new Date(conv.last_inbound_at as string).getTime()
    : 0;
  const windowOpen = lastInboundMs > Date.now() - WINDOW_HOURS * 3600 * 1000;
  if (!windowOpen) {
    return NextResponse.json(
      {
        error:
          "Outside WhatsApp's 24-hour reply window — you can't message this customer right now. Call them instead.",
        window_closed: true,
      },
      { status: 409 },
    );
  }

  // Relay to the existing edge function. Same MSG91 path the bot uses.
  // NAME every missing env var in the error so it's obvious what to set
  // (and WHERE — Vercel vs Supabase have separate secret stores). The
  // earlier generic "Server mis-configured" gave zero signal.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const internalSecret = process.env.INTERNAL_API_SECRET ?? "";
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anon) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!internalSecret) missing.push("INTERNAL_API_SECRET");
  if (missing.length > 0) {
    console.error(
      "[admin/whatsapp/send] missing env var(s) on Vercel:",
      missing.join(", "),
    );
    return NextResponse.json(
      {
        error: `WhatsApp send is disabled — set ${missing.join(", ")} in Vercel (Cadieux-Website project) and redeploy.`,
        missing,
      },
      { status: 500 },
    );
  }

  let sendRes: Response;
  try {
    sendRes = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "x-internal-secret": internalSecret,
      },
      body: JSON.stringify({
        to: conv.phone,
        type: "text",
        text,
        ai_generated: false,
      }),
    });
  } catch (err) {
    console.error("[admin/whatsapp/send] edge fetch threw", err);
    return NextResponse.json(
      { error: "Couldn't reach the send service. Try again." },
      { status: 502 },
    );
  }

  const rawText = await sendRes.text().catch(() => "");
  let payload: Record<string, unknown> = {};
  try {
    payload = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    payload = { _nonJsonBody: rawText };
  }

  if (!sendRes.ok) {
    const windowClosed = (payload as { window_closed?: boolean }).window_closed === true;
    const errMsg =
      (payload as { error?: string }).error ??
      `Send failed (HTTP ${sendRes.status})`;
    return NextResponse.json(
      windowClosed
        ? { error: errMsg, window_closed: true }
        : { error: errMsg },
      { status: windowClosed ? 409 : 502 },
    );
  }

  const waMessageId =
    typeof (payload as { wa_message_id?: string | null }).wa_message_id === "string"
      ? (payload as { wa_message_id: string }).wa_message_id
      : null;

  // Fetch the just-inserted outbound row so the UI can render it without
  // having to reload the whole thread. The edge function inserts one
  // outbound row per successful send, so the most recent outbound row for
  // this conversation matching wa_message_id (or newest as a fallback) is
  // what we just wrote.
  let inserted: unknown = null;
  const query = supabaseAdmin
    .from("whatsapp_messages")
    .select("id, direction, body, wa_message_id, status, ai_generated, sent_at, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: false })
    .limit(1);
  if (waMessageId) {
    const { data } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, direction, body, wa_message_id, status, ai_generated, sent_at, created_at")
      .eq("conversation_id", id)
      .eq("wa_message_id", waMessageId)
      .maybeSingle();
    inserted = data ?? null;
  }
  if (!inserted) {
    const { data } = await query;
    inserted = Array.isArray(data) && data[0] ? data[0] : null;
  }

  // Audit trail — who sent what, when. Store the body verbatim (trimmed at
  // the DB layer's 4000-char cap set above). entity_id is a text (not uuid)
  // — logistics.audit_logs requires uuid, so leave it null and put the ids
  // in metadata.
  await logLogisticsAudit({
    actionType: "CREATE",
    entityType: "whatsapp_message",
    entityId: null,
    category: "security",
    description: `Sent WhatsApp reply to ${conv.phone}`,
    newValues: { body: text },
    metadata: {
      conversation_id: id,
      phone: conv.phone,
      wa_message_id: waMessageId,
      ip,
    },
    source: "dashboard",
  });

  return NextResponse.json({
    ok: true,
    wa_message_id: waMessageId,
    message: inserted,
  });
}
