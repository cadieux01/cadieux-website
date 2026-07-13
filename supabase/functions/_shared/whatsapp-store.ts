// Conversation-store helpers shared by whatsapp-send and whatsapp-inbound.
// All access uses the SERVICE ROLE (bypasses the deny-all RLS on the two
// whatsapp_* tables). The AFTER-INSERT trigger on whatsapp_messages keeps the
// conversation rollups (last_inbound_at / last_outbound_at / last_message_at)
// in sync, so callers only insert messages — they never touch those columns.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

declare const Deno: { env: { get(key: string): string | undefined } };

// createClient is loosely typed under Deno's remote import; alias to keep the
// helper signatures readable.
export type Admin = ReturnType<typeof createClient>;

export function serviceClient(): Admin {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Get the conversation id for a phone, creating the row if absent. */
export async function getOrCreateConversation(admin: Admin, phone: string): Promise<string> {
  const { data, error } = await admin
    .from("whatsapp_conversations")
    .upsert({ phone }, { onConflict: "phone", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (data?.id) return data.id as string;
  // On conflict, ignoreDuplicates returns no row — fetch the existing one.
  const { data: existing, error: e2 } = await admin
    .from("whatsapp_conversations")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  throw new Error(error?.message ?? e2?.message ?? "conversation upsert failed");
}

export type InsertMessageArgs = {
  conversationId: string;
  phone: string;
  direction: "inbound" | "outbound";
  body: string;
  waMessageId?: string | null;
  status?: string | null;
  aiGenerated?: boolean;
  sentAt?: string | null;
};

/** Insert a message. Idempotent on wa_message_id: a duplicate provider id
 *  (redelivered webhook) resolves to { inserted: false } instead of throwing. */
export async function insertMessage(
  admin: Admin,
  a: InsertMessageArgs,
): Promise<{ inserted: boolean; id?: string }> {
  const row = {
    conversation_id: a.conversationId,
    phone: a.phone,
    direction: a.direction,
    body: a.body,
    wa_message_id: a.waMessageId ?? null,
    status: a.status ?? null,
    ai_generated: a.aiGenerated ?? false,
    sent_at: a.sentAt ?? null,
  };
  const { data, error } = await admin
    .from("whatsapp_messages")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === "23505") return { inserted: false };
    throw new Error(error.message);
  }
  return { inserted: true, id: data?.id as string | undefined };
}

/** True while the phone is inside Meta's 24h free-form service window. */
export async function canFreeReply(admin: Admin, phone: string): Promise<boolean> {
  const { data, error } = await admin.rpc("whatsapp_can_free_reply", { p_phone: phone });
  if (error) {
    console.error("[wa-store] canFreeReply rpc failed:", error.message);
    return false; // fail closed — better to skip a free-form send than break Meta's rule
  }
  return data === true;
}

/** Flag a conversation for human attention (surfaces in a future dashboard). */
export async function flagNeedsHuman(admin: Admin, conversationId: string): Promise<void> {
  const { error } = await admin
    .from("whatsapp_conversations")
    .update({ status: "needs_human" })
    .eq("id", conversationId);
  if (error) console.warn("[wa-store] flagNeedsHuman failed:", error.message);
}

export type HandoffReason = "handoff" | "fallback" | "send_failed" | "rate_limited";

/** Atomically flag needs_human ONLY if the conversation isn't already flagged.
 *  Returns { newlyFlagged: true, phone } when this call caused the transition
 *  (email/WA alerts should fire); { newlyFlagged: false } when the conversation
 *  was already needs_human (dedupe — no alert). Also stamps last_handoff_at
 *  and handoff_reason so the dashboard can surface why the escalation happened. */
export async function flagNeedsHumanIfNew(
  admin: Admin,
  conversationId: string,
  reason: HandoffReason,
): Promise<{ newlyFlagged: boolean; phone?: string }> {
  const { data, error } = await admin
    .from("whatsapp_conversations")
    .update({
      status: "needs_human",
      last_handoff_at: new Date().toISOString(),
      handoff_reason: reason,
    })
    .eq("id", conversationId)
    .neq("status", "needs_human")
    .select("phone")
    .maybeSingle();
  if (error) {
    console.warn("[wa-store] flagNeedsHumanIfNew failed:", error.message);
    return { newlyFlagged: false };
  }
  if (data?.phone) {
    return { newlyFlagged: true, phone: data.phone as string };
  }
  // No row updated → status was already needs_human. Best-effort: still stamp
  // the reason for the current escalation so operators see the latest cause.
  await admin
    .from("whatsapp_conversations")
    .update({ handoff_reason: reason, last_handoff_at: new Date().toISOString() })
    .eq("id", conversationId);
  return { newlyFlagged: false };
}

/** Recent thread history (oldest→newest) mapped to AI roles, excluding the
 *  message id `excludeId` (the just-inserted inbound). */
export async function recentHistory(
  admin: Admin,
  conversationId: string,
  excludeId: string | undefined,
  limit = 12,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { data, error } = await admin
    .from("whatsapp_messages")
    .select("id, direction, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit + 5);
  if (error) {
    console.warn("[wa-store] recentHistory failed:", error.message);
    return [];
  }
  const rows = (data ?? []) as Array<{ id: string; direction: string; body: string }>;
  return rows
    .filter((r) => r.id !== excludeId)
    .slice(-limit)
    .map((r) => ({
      role: r.direction === "inbound" ? ("user" as const) : ("assistant" as const),
      content: r.body,
    }));
}
