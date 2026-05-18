// Small wrappers around the existing `telHref` / `whatsAppHref` helpers,
// plus an `smsHref` and a couple of message-template builders shared by
// the admin ContactActions popup. Defaults assume Indian numbers (+91)
// — same rule as admin-formatting.ts.

import { telHref, whatsAppHref } from "@/lib/admin-formatting";

export { telHref, whatsAppHref };

/**
 * sms:<number>?body=<encoded message>. SMS scheme uses `?body=` on
 * iOS/Android Chrome — the Android default messaging app also accepts
 * `?body=`. We keep it simple and don't try `&body=` fallbacks.
 */
export function smsHref(
  phone: string | null | undefined,
  body?: string,
): string {
  if (!phone) return "";
  const cleaned = phone.replace(/[^\d+]/g, "");
  const number = cleaned.startsWith("+")
    ? cleaned
    : cleaned.length === 10
      ? `+91${cleaned}`
      : cleaned;
  if (!body) return `sms:${number}`;
  return `sms:${number}?body=${encodeURIComponent(body)}`;
}

/**
 * `https://wa.me/<digits>?text=<encoded>` — extends whatsAppHref with a
 * prefilled message body.
 */
export function whatsAppHrefWithText(
  phone: string | null | undefined,
  body?: string,
): string {
  const base = whatsAppHref(phone);
  if (!base || !body) return base;
  return `${base}?text=${encodeURIComponent(body)}`;
}

export type ContactMessageContext = {
  customerName?: string | null;
  orderInfo?: string | null;
};

/**
 * Default prefilled message for outbound WhatsApp / SMS. Admin can
 * always edit before sending — this is just the seed.
 */
export function defaultContactMessage(ctx: ContactMessageContext): string {
  const name = (ctx.customerName ?? "").trim();
  const order = (ctx.orderInfo ?? "").trim();
  const lines = [
    name ? `Hi ${name},` : "Hi,",
    "",
    "This is Cadieux Bakery.",
    order ? `Regarding ${order}.` : "",
    "Could you please get back to us when you have a moment?",
    "",
    "Thank you!",
  ].filter(Boolean);
  return lines.join("\n");
}
