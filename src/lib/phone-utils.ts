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
  /** Full name as stored. Only the first token reaches the message. */
  customerName?: string | null;
  /**
   * An OLF/OLS reference and NOTHING else — already formatted by
   * `formatOrderNumber` / `formatSubscriptionNumber`.
   *
   * This used to be `orderInfo`, a free-text phrase ("Protein Bread
   * subscription", "change request for Week 3 of …"), which is why only
   * one of the ten call sites ever carried a real code. The body quotes
   * this verbatim, so a prose phrase here would read as one. Null is the
   * right answer wherever the screen is about a CUSTOMER rather than one
   * order — the clause drops rather than inventing a reference.
   */
  orderCode?: string | null;
};

/** First token of a full name. "Priya Sharma" → "Priya". */
function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * Default prefilled message for outbound WhatsApp / SMS. Admin can
 * always edit before sending — this is just the seed.
 *
 * Both halves of the lead are optional and the separators belong to the
 * parts, not to the template, so the four combinations collapse without
 * ever emitting a dangling "Hi  —" or a leading " — ":
 *
 *   name + code  Hi Priya — OLF470 — I'm messaging from Cadieux. …
 *   name only    Hi Priya — I'm messaging from Cadieux. …
 *   code only    OLF470 — I'm messaging from Cadieux. …
 *   neither      I'm messaging from Cadieux. …
 *
 * First name only: the admin is opening a conversation, and the full
 * legal name a customer typed at checkout ("Priya Sharma Reddy") reads
 * like a bank doing collections.
 */
export function defaultContactMessage(ctx: ContactMessageContext): string {
  const body =
    "I'm messaging from Cadieux. Do you have a minute to help me with your order?";
  const first = firstName(ctx.customerName);
  const code = (ctx.orderCode ?? "").trim();
  const lead = [first ? `Hi ${first}` : "", code].filter(Boolean);
  return lead.length > 0 ? `${lead.join(" — ")} — ${body}` : body;
}
