// Pre-order schedule notification orchestrator.
//
// When an admin sets a delivery_date on an is_preorder=true order, this fires
// SMS + WhatsApp via MSG91 using APPROVED DLT/Meta templates. Both channels
// are env-gated:
//   PREORDER_SCHEDULE_SMS_TEMPLATE_ID  - DLT-approved SMS flow template
//   PREORDER_SCHEDULE_WA_TEMPLATE_ID   - MSG91/Meta-approved WhatsApp template
// Missing env → clear console warn + skip THAT channel, save NEVER fails.
//
// Every attempt (sent / failed / skipped) is written to audit_log so admin
// can see what actually happened without needing to trawl server logs.
//
// Templates MUST expose these variables (Sunny approves the exact names on
// the DLT + Meta side; adjust the payload keys here to match):
//   SMS   ##order_number## + ##date##
//   WA    body[1]=order_number, body[2]=date  (MSG91 to_and_components format)

import type { NextRequest } from "next/server";
import { sendMsg91FlowTemplate } from "@/lib/msg91";
import { sendWhatsAppTemplate } from "@/lib/msg91-whatsapp";
import { recordAuditEvent } from "@/lib/audit-log";
import { formatOrderNumber } from "@/lib/order-number";

const SMS_TEMPLATE_ENV = "PREORDER_SCHEDULE_SMS_TEMPLATE_ID";
const WA_TEMPLATE_ENV = "PREORDER_SCHEDULE_WA_TEMPLATE_ID";

export type PreorderNotifyInput = {
  req?: NextRequest;
  orderId: string;
  orderNumber: string | null;
  customerPhone: string | null; // 10-digit local OR normalised — helper handles both
  deliveryDate: string; // ISO YYYY-MM-DD
};

/** Fires SMS + WhatsApp notifications for a scheduled pre-order delivery
 *  date. Never throws; every outcome is logged to audit_log. */
export async function notifyPreorderScheduled(
  input: PreorderNotifyInput,
): Promise<{ sms: Outcome; whatsapp: Outcome }> {
  const displayOrderNumber = formatOrderNumber({
    id: input.orderId,
    order_number: input.orderNumber,
  });
  const phone = (input.customerPhone ?? "").trim();

  if (!phone) {
    const skipped: Outcome = { status: "skipped", reason: "customer_phone_missing" };
    await logAttempt(input.req, input.orderId, displayOrderNumber, "sms", skipped);
    await logAttempt(input.req, input.orderId, displayOrderNumber, "whatsapp", skipped);
    return { sms: skipped, whatsapp: skipped };
  }

  const [smsOutcome, waOutcome] = await Promise.all([
    sendSms(phone, displayOrderNumber, input.deliveryDate),
    sendWhatsApp(phone, displayOrderNumber, input.deliveryDate),
  ]);

  await Promise.all([
    logAttempt(input.req, input.orderId, displayOrderNumber, "sms", smsOutcome),
    logAttempt(input.req, input.orderId, displayOrderNumber, "whatsapp", waOutcome),
  ]);

  return { sms: smsOutcome, whatsapp: waOutcome };
}

type Outcome =
  | { status: "sent"; providerId?: string | null }
  | { status: "failed"; reason: string }
  | { status: "skipped"; reason: "template_not_configured" | "customer_phone_missing" };

async function sendSms(
  phone: string,
  orderNumber: string,
  date: string,
): Promise<Outcome> {
  const templateId = process.env[SMS_TEMPLATE_ENV] ?? "";
  if (!templateId) {
    console.warn(
      `[preorder-notify] SMS template not configured (env ${SMS_TEMPLATE_ENV}) — skipping SMS`,
    );
    return { status: "skipped", reason: "template_not_configured" };
  }
  const result = await sendMsg91FlowTemplate(phone, templateId, {
    order_number: orderNumber,
    date,
  });
  if (result.ok) return { status: "sent" };
  return { status: "failed", reason: result.error };
}

async function sendWhatsApp(
  phone: string,
  orderNumber: string,
  date: string,
): Promise<Outcome> {
  const templateName = process.env[WA_TEMPLATE_ENV] ?? "";
  if (!templateName) {
    console.warn(
      `[preorder-notify] WhatsApp template not configured (env ${WA_TEMPLATE_ENV}) — skipping WhatsApp`,
    );
    return { status: "skipped", reason: "template_not_configured" };
  }
  // MSG91's to_and_components accepts a body with positional variables. The
  // exact shape depends on the approved Meta template; this is the common
  // pattern (body components with { type:"text", text:<value> }). Sunny will
  // tweak once the template is approved and the placeholder order is known.
  const components = {
    body_1: { type: "text", value: orderNumber },
    body_2: { type: "text", value: date },
  };
  const result = await sendWhatsAppTemplate(phone, templateName, { components });
  if (result.ok) return { status: "sent", providerId: result.waMessageId };
  return { status: "failed", reason: result.error };
}

async function logAttempt(
  req: NextRequest | undefined,
  orderId: string,
  orderNumber: string,
  channel: "sms" | "whatsapp",
  outcome: Outcome,
): Promise<void> {
  const contextByStatus: Record<Outcome["status"], string> = {
    sent: `Pre-order schedule ${channel.toUpperCase()} sent for ${orderNumber}`,
    failed: `Pre-order schedule ${channel.toUpperCase()} FAILED for ${orderNumber}`,
    skipped: `Pre-order schedule ${channel.toUpperCase()} SKIPPED for ${orderNumber} (template not configured)`,
  };
  await recordAuditEvent({
    req,
    entity: "order",
    action: "other",
    targetId: orderId,
    targetLabel: orderNumber,
    context: contextByStatus[outcome.status],
    meta: {
      channel,
      outcome: outcome.status,
      ...("reason" in outcome ? { reason: outcome.reason } : {}),
      ...("providerId" in outcome && outcome.providerId
        ? { provider_id: outcome.providerId }
        : {}),
    },
  });
}
