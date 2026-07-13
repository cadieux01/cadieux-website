// ---------------------------------------------------------------------------
// whatsapp-inbound — Supabase Edge Function (MSG91 inbound webhook + bot loop)
// ---------------------------------------------------------------------------
// MSG91 POSTs here whenever a customer sends our WhatsApp number a message.
// This function is the whole receive→reply loop:
//   1. Verify the request is from MSG91 (shared secret in ?token= or the
//      x-webhook-token header — MSG91 lets you add a custom URL param/header
//      to the callback).
//   2. Parse the payload; IGNORE anything that isn't a genuine inbound text
//      (status callbacks, delivery/read receipts, media-only, etc.).
//   3. Loop guard: ignore messages whose sender is our own integrated number.
//   4. Store the inbound message idempotently (dedupe on wa_message_id) — this
//      also opens the 24h window via the AFTER-INSERT trigger.
//   5. Per-phone rate limit (Upstash, optional): abusive floods are stored but
//      skip the AI call + get flagged, so a spammer can't burn AI credits or
//      trigger reply loops.
//   6. Call whatsapp-ai-reply with the message + recent history.
//   7. Send the reply as free-form text (window is open). On [[HANDOFF]],
//      AI error, or send failure → send the safe fallback and FLAG the
//      conversation needs_human. Never drop silently, never send garbage.
//   8. Store the outbound message.
//
// Always returns 200 for a handled event so MSG91 doesn't retry-storm.
//
// ENV
//   WHATSAPP_WEBHOOK_SECRET   — token MSG91 must present (?token= or header)
//   MSG91_WHATSAPP_AUTHKEY / MSG91_INTEGRATED_NUMBER / MSG91_NAMESPACE
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-injected
//   WHATSAPP_AI_REPLY_URL     — optional; defaults to the sibling function URL
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — optional rate limit
//
// DEPLOY (later — do NOT deploy yet). MUST be --no-verify-jwt because MSG91
// calls it externally with no Supabase JWT:
//   supabase functions deploy whatsapp-inbound --project-ref uejagupcwevadfhfuadv --no-verify-jwt
//
// WEBHOOK URL to paste into MSG91 (append the secret as a query param):
//   https://uejagupcwevadfhfuadv.supabase.co/functions/v1/whatsapp-inbound?token=<WHATSAPP_WEBHOOK_SECRET>
// ---------------------------------------------------------------------------

import { constantTimeEqual, corsHeaders, json } from "../_shared/http.ts";
import { normalizePhone, sendWhatsAppText } from "../_shared/msg91-whatsapp.ts";
import {
  canFreeReply,
  flagNeedsHumanIfNew,
  getOrCreateConversation,
  type HandoffReason,
  insertMessage,
  recentHistory,
  serviceClient,
} from "../_shared/whatsapp-store.ts";
import { sendHandoffAlertEmail } from "../_shared/handoff-email.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// Master reply switch. Default OFF: the webhook receives + logs + stores
// inbound messages but does NOT call the AI or send any reply. Flip to "true"
// (Edge secret, no redeploy) once the real MSG91 payload has been observed and
// the parser confirmed.
const BOT_ENABLED = (Deno.env.get("WHATSAPP_BOT_ENABLED") ?? "false").toLowerCase() === "true";

const WEBHOOK_SECRET = Deno.env.get("WHATSAPP_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const AI_REPLY_URL =
  Deno.env.get("WHATSAPP_AI_REPLY_URL") ?? `${SUPABASE_URL}/functions/v1/whatsapp-ai-reply`;
const INTEGRATED_NUMBER = normalizePhone(Deno.env.get("MSG91_INTEGRATED_NUMBER") ?? "");
const UPSTASH_URL = Deno.env.get("UPSTASH_REDIS_REST_URL") ?? "";
const UPSTASH_TOKEN = Deno.env.get("UPSTASH_REDIS_REST_TOKEN") ?? "";

const INBOUND_LIMIT = 8; // max inbound messages per phone per window
const INBOUND_WINDOW_SEC = 60;
const HISTORY_TURNS = 12;
const FALLBACK_TEXT =
  "Thanks for reaching out to Cadieux! A team member will get back to you shortly.";

type Inbound = { from: string; text: string; waMessageId: string | null };

// Pull a nested string by trying several candidate paths. Tolerant of MSG91's
// exact shape (confirmed against a real inbound payload on 2026-07-13).
function pick(obj: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    let cur: unknown = obj;
    let ok = true;
    for (const key of path) {
      if (cur && typeof cur === "object" && key in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[key];
      } else {
        ok = false;
        break;
      }
    }
    if (ok && typeof cur === "string" && cur.trim()) return cur.trim();
  }
  return null;
}

// Fallback: MSG91 also embeds a JSON-STRING under `messages` (not an array
// object — a stringified JSON blob). Parse it lazily to pull text/id/from
// when the top-level fields are absent.
type MsgArrayItem = {
  from?: string;
  id?: string;
  text?: { body?: string };
  type?: string;
};
function parseMessagesArray(raw: unknown): MsgArrayItem | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const arr = JSON.parse(raw) as MsgArrayItem[];
    if (Array.isArray(arr) && arr[0] && typeof arr[0] === "object") return arr[0];
    return null;
  } catch {
    return null;
  }
}

// Extract a genuine inbound TEXT message, or null for anything we must ignore
// (status/delivery/read receipts, non-text media/buttons/reactions, malformed).
// Real MSG91 shape (2026-07-13 live capture):
//   { customerNumber, integratedNumber, uuid, messageType: "text",
//     contentType: "text", text: "Hii", messages: "[{...}]" (JSON STRING),
//     ts, requestedAt, customerName, ... }
function parseInbound(body: unknown): Inbound | null {
  const b = (body ?? {}) as Record<string, unknown>;

  // Reject status/receipt callbacks. Those carry a status field and no text.
  const statusHint = pick(b, [
    ["status"],
    ["data", "status"],
    ["event"],
  ]);
  if (statusHint && /deliver|read|sent|failed|status|receipt/i.test(statusHint)) {
    console.log("[whatsapp-inbound] skip: status/receipt callback", statusHint);
    return null;
  }

  // Message type gate. Only process explicit text messages. Everything else
  // (image, video, audio, document, button, interactive, reaction, location,
  // contacts, order, payment, sticker, ...) is logged and safely skipped.
  const nested = parseMessagesArray(b.messages);
  const messageType =
    pick(b, [["messageType"], ["contentType"]]) ??
    (nested?.type ? String(nested.type) : "");
  if (messageType && messageType.toLowerCase() !== "text") {
    console.log("[whatsapp-inbound] skip: non-text messageType", messageType);
    return null;
  }

  // Customer phone. MSG91 real shape uses `customerNumber` (12-digit, no +).
  // Fallback paths kept for defensive re-shape tolerance.
  const from =
    pick(b, [
      ["customerNumber"],
      ["from"],
      ["sender"],
      ["mobile"],
      ["customer_number"],
      ["data", "from"],
      ["data", "sender"],
      ["payload", "from"],
    ]) ??
    (nested?.from ? String(nested.from) : null);

  // Message body. MSG91 real shape puts the string at top-level `text` (NOT
  // `text.body`). Nested `messages[0].text.body` is used as a fallback.
  let text = pick(b, [
    ["text"],
    ["message"],
    ["body"],
    ["content", "text"],
    ["data", "text"],
    ["data", "message", "text"],
    ["data", "content", "text"],
  ]);
  if (!text && nested?.text?.body && String(nested.text.body).trim()) {
    text = String(nested.text.body).trim();
  }

  // Idempotency key. MSG91 real shape: top-level `uuid` (wamid.HBg...).
  const waMessageId =
    pick(b, [
      ["uuid"],
      ["message_id"],
      ["messageId"],
      ["id"],
      ["data", "message_id"],
      ["data", "id"],
      ["payload", "id"],
    ]) ??
    (nested?.id ? String(nested.id) : null);

  // Guard: empty text (e.g. reaction with no body slipped past the type check).
  if (!from || !text || !text.trim()) {
    console.log("[whatsapp-inbound] skip: missing from or text", {
      from,
      hasText: !!text,
    });
    return null;
  }
  return { from, text: text.trim(), waMessageId: waMessageId ?? null };
}

// Optional Upstash sliding-ish limiter via REST (no SDK). Returns true if
// allowed. Fails OPEN on transport errors, and is skipped when unconfigured.
async function upstashAllow(key: string, limit: number, windowSec: number): Promise<boolean> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return true;
  try {
    const incr = await fetch(`${UPSTASH_URL}/incr/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const { result } = await incr.json();
    const count = Number(result) || 0;
    if (count === 1) {
      await fetch(`${UPSTASH_URL}/expire/${encodeURIComponent(key)}/${windowSec}`, {
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      });
    }
    return count <= limit;
  } catch (e) {
    console.warn("[whatsapp-inbound] upstash error (failing open):", (e as Error).message);
    return true;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  // MSG91 only POSTs. Anything else is acknowledged and ignored.
  if (req.method !== "POST") return json(200, { ok: true, ignored: "non-POST" });

  // ── 1. Verify caller ─────────────────────────────────────────────────────
  if (WEBHOOK_SECRET) {
    const url = new URL(req.url);
    const tokenQ = url.searchParams.get("token") ?? "";
    const tokenH = req.headers.get("x-webhook-token") ?? "";
    const authed =
      (!!tokenQ && constantTimeEqual(tokenQ, WEBHOOK_SECRET)) ||
      (!!tokenH && constantTimeEqual(tokenH, WEBHOOK_SECRET));
    if (!authed) {
      console.warn("[whatsapp-inbound] rejected: bad/missing webhook token");
      return json(401, { error: "Unauthorized" });
    }
  }

  // ── 2. Parse ─────────────────────────────────────────────────────────────
  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    return json(200, { ok: true, ignored: "non-json" });
  }
  // LOG-ONLY OBSERVABILITY: dump the entire raw MSG91 payload verbatim so we can
  // confirm the real field shape before ever letting the bot reply. Safe to keep
  // on while WHATSAPP_BOT_ENABLED=false; trim once the parser is confirmed.
  console.log("[whatsapp-inbound] RAW", JSON.stringify(raw));
  const inbound = parseInbound(raw);
  if (!inbound) return json(200, { ok: true, ignored: "not-an-inbound-text" });

  const from = normalizePhone(inbound.from);

  // ── 3. Loop guard ────────────────────────────────────────────────────────
  if (!from || from.length !== 12 || from === INTEGRATED_NUMBER) {
    return json(200, { ok: true, ignored: "self-or-invalid-sender" });
  }

  const admin = serviceClient();

  // ── 4. Store inbound (idempotent) — opens the 24h window via trigger ─────
  let conversationId: string;
  try {
    conversationId = await getOrCreateConversation(admin, from);
  } catch (e) {
    console.error("[whatsapp-inbound] conversation error:", (e as Error).message);
    return json(200, { ok: false, error: "store-conversation" });
  }

  const ins = await insertMessage(admin, {
    conversationId,
    phone: from,
    direction: "inbound",
    body: inbound.text,
    waMessageId: inbound.waMessageId,
    status: "received",
    sentAt: new Date().toISOString(),
  }).catch((e: Error) => {
    console.error("[whatsapp-inbound] insert inbound failed:", e.message);
    return { inserted: false as const };
  });
  if (!("inserted" in ins) || !ins.inserted) {
    // Duplicate delivery (same wa_message_id) or insert failure → do not
    // re-process. Idempotency guard.
    console.log("[whatsapp-inbound] inbound not newly inserted; skipping", inbound.waMessageId);
    return json(200, { ok: true, ignored: "duplicate-or-store-fail" });
  }

  // ── LOG-ONLY GATE ────────────────────────────────────────────────────────
  // While the master switch is OFF we STOP here: the inbound message is logged
  // and stored (24h window opened via the trigger), but we do NOT call the AI
  // and do NOT send any reply. Flip WHATSAPP_BOT_ENABLED=true (Edge secret, no
  // redeploy) to turn on the full receive→reply loop below.
  if (!BOT_ENABLED) {
    console.log("[whatsapp-inbound] BOT_ENABLED=false — logged + stored, not replying", {
      from,
      wa_message_id: inbound.waMessageId,
    });
    return json(200, { ok: true, logged: true, stored: true, bot: "disabled" });
  }

  // ── 5. Rate limit (store kept, AI skipped on abuse) ──────────────────────
  const allowed = await upstashAllow(
    `ratelimit:wa:inbound:${from}`,
    INBOUND_LIMIT,
    INBOUND_WINDOW_SEC,
  );
  if (!allowed) {
    console.warn("[whatsapp-inbound] rate limited; flagging", from);
    const flag = await flagNeedsHumanIfNew(admin, conversationId, "rate_limited");
    if (flag.newlyFlagged) {
      // Best-effort email alert — never blocks the reply loop.
      void sendHandoffAlertEmail({
        conversationId,
        phone: from,
        reason: "rate_limited",
        customerMessage: inbound.text,
        botReply: "(no reply — rate limited)",
        timestampIso: new Date().toISOString(),
      }).catch(() => {});
    }
    return json(200, { ok: true, ignored: "rate-limited", flagged: true });
  }

  // ── 6. Ask the AI (with recent history) ──────────────────────────────────
  const history = await recentHistory(admin, conversationId, ins.id, HISTORY_TURNS);

  let replyText = FALLBACK_TEXT;
  let handoff = true;
  let aiSource = "fallback";
  try {
    const aiRes = await fetch(AI_REPLY_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ message: inbound.text, phone: from, history }),
    });
    if (aiRes.ok) {
      const j = (await aiRes.json()) as {
        reply?: unknown;
        handoff?: unknown;
        source?: unknown;
      };
      if (typeof j.reply === "string" && j.reply.trim()) {
        replyText = j.reply.trim();
        handoff = j.handoff === true;
        aiSource = typeof j.source === "string" ? j.source : "ai";
      }
    } else {
      console.error("[whatsapp-inbound] ai http", aiRes.status);
    }
  } catch (e) {
    console.error("[whatsapp-inbound] ai call failed:", (e as Error).message);
  }

  // ── 7. Send reply within the 24h window ──────────────────────────────────
  const open = await canFreeReply(admin, from);
  let sendOk = false;
  let waId: string | null = null;
  if (open) {
    const send = await sendWhatsAppText(from, replyText);
    sendOk = send.ok;
    waId = send.ok ? send.waMessageId : null;
    if (!send.ok) console.error("[whatsapp-inbound] send failed:", send.error);
  } else {
    console.warn("[whatsapp-inbound] window unexpectedly closed for", from);
  }

  // ── 8. Store outbound (recorded even on send failure) ────────────────────
  await insertMessage(admin, {
    conversationId,
    phone: from,
    direction: "outbound",
    body: replyText,
    waMessageId: waId,
    status: sendOk ? "sent" : "failed",
    aiGenerated: aiSource === "ai",
    sentAt: new Date().toISOString(),
  }).catch((e: Error) =>
    console.warn("[whatsapp-inbound] store outbound failed:", e.message)
  );

  // Flag for a human on handoff, fallback, or a failed send — never silent.
  // Email debounce: only alert on transition into needs_human (not on every
  // subsequent inbound while the conversation is already flagged).
  if (handoff || aiSource === "fallback" || !sendOk) {
    const reason: HandoffReason = !sendOk
      ? "send_failed"
      : aiSource === "fallback"
        ? "fallback"
        : "handoff";
    const flag = await flagNeedsHumanIfNew(admin, conversationId, reason);
    if (flag.newlyFlagged) {
      void sendHandoffAlertEmail({
        conversationId,
        phone: from,
        reason,
        customerMessage: inbound.text,
        botReply: replyText,
        timestampIso: new Date().toISOString(),
      }).catch(() => {});
    }
  }

  console.log("[whatsapp-inbound] handled", {
    from,
    source: aiSource,
    handoff,
    sendOk,
  });
  return json(200, { ok: true, source: aiSource, handoff, sent: sendOk });
});
