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
  /** Full name as stored. Only the name the customer goes by reaches the
   *  message — see `firstName` for which token that is, why it is not
   *  always the first, and the one case where it is two. */
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

/**
 * Tokens of a stored full name.
 *
 * **A dot separates as surely as a space.** Splitting on whitespace alone
 * is not enough, because the dot is routinely typed without one. On real
 * rows that leaves the initial welded to the name, or picks a title:
 *
 *   "S.kiran"            → "S.kiran"           not "kiran"
 *   "T P.Nalini"         → "P.Nalini"          not "Nalini"
 *   "Dr.Teja Praveen"    → "Dr.Teja"           not "Teja"
 *   "Y.V.V.S.N.MURTHY"   → "Y.v.v.s.n.murthy"  not "Murthy"
 *   "Ramathirtha. B"     → "Ramathirtha."      (trailing dot)
 *
 * It fixes 20 rows and regresses none. "Dr.Teja Praveen" is the row that
 * makes it non-negotiable rather than merely tidy: there is no whitespace
 * anywhere near that dot, so no amount of `/\s+/` ever reaches it.
 */
function nameTokens(full: string | null | undefined): string[] {
  return (full ?? "")
    .trim()
    .split(/[\s.]+/)
    .filter(Boolean);
}

/**
 * Could this token be the name someone goes by?
 *
 * **Longer than two characters.** In South Indian naming the leading token
 * is routinely a family or village initial, not the given name: of 900
 * named customers, 79 have a first token of two characters or fewer and 59
 * have a single letter. "Hi J" and "Hi M" are not greetings. Two-letter
 * prefixes are initials too ("Ch Srinu", "SP Sriram"), which is why the cut
 * sits at two and not at one.
 *
 * This is also the entirety of the honorific handling, deliberately. Every
 * honorific in the table is "Dr" — 9 rows, with no Mr, Mrs, Ms, Smt, Shri,
 * Prof, Capt, Col, Lt or Rev anywhere — and "Dr" is two characters, so the
 * length rule already drops it. A stop-list would be a second rule earning
 * nothing, and one more thing to keep in sync with the data.
 *
 * **At least one letter.** One row stores a phone number in `full_name`.
 * "Hi 7981040614" is worse than no greeting.
 */
function isNameToken(token: string): boolean {
  return token.length > 2 && /[A-Za-z]/.test(token);
}

/**
 * Fix the case of a token the customer typed in a single case, and leave
 * every other token exactly as written.
 *
 * A token that is entirely upper or entirely lower carries no case
 * information — it is a keyboard artefact ("SRINIVAS", "santosh", and the
 * "uma" of "Dr uma sankar") — so title-case it. A token that is already
 * mixed case carries the customer's own spelling and is passed through
 * byte for byte, so "McDonald" and "d'Souza" survive.
 *
 * One rule covering both artefacts, not a second rule bolted on for
 * lowercase. Mixed case is the only thing that means anything.
 */
function normaliseCase(token: string): string {
  const singleCase =
    token === token.toUpperCase() || token === token.toLowerCase();
  if (!singleCase) return token;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/**
 * The name to greet someone by, out of a full name as the customer typed
 * it. Returns "" when no token is usable — the caller then greets without
 * a name rather than greeting with a bad one.
 *
 * ## "Sri" is half of a given name here, not a title
 * All three rows beginning with it are compound given names — "Sri Harsha
 * K", "Sri Harshini", "Sri Lakshmi myluru" — 3 of 3, never an honorific.
 * "Hi Sri" addresses nobody, so when the pick is "Sri" the next usable
 * token comes with it: "Hi Sri Harsha". The opposite of a stop-list.
 *
 * The comparison is made AFTER case normalisation, so "SRI LAKSHMI" and
 * "sri harsha" are caught by the same line.
 */
export function firstName(full: string | null | undefined): string {
  const tokens = nameTokens(full);
  const at = tokens.findIndex(isNameToken);
  if (at < 0) return "";

  const picked = normaliseCase(tokens[at]!);
  if (picked !== "Sri") return picked;

  const next = tokens.slice(at + 1).find(isNameToken);
  return next ? `${picked} ${normaliseCase(next)}` : picked;
}

/**
 * Default prefilled message for outbound WhatsApp / SMS. Admin can always
 * edit before sending — this is just the seed.
 *
 * Both halves of the greeting are optional. They are joined by a space
 * inside one "Hi …," clause, so there is never a dangling separator and
 * never a message that opens without greeting anybody:
 *
 *   name + code  Hi Priya OLF470, I'm messaging from Cadieux. Do you have
 *                a minute to help me out with your order?
 *   name only    Hi Priya, I'm messaging from Cadieux. Do you have a
 *                minute to speak?
 *   code only    Hi OLF470, I'm messaging from Cadieux. Do you have a
 *                minute to help me out with your order?
 *   neither      Hi, I'm messaging from Cadieux. Do you have a minute to
 *                speak?
 *
 * **The closing question follows the code, not the name.** With a code in
 * hand the admin is asking about one specific order, so "help me out with
 * your order" is literal. With no code the screen is about a CUSTOMER —
 * the customers list, a customer detail, a serviceability request — and
 * there is no order to help with, so it is "a minute to speak". Two
 * phrasings, one per case, and the code decides which.
 *
 * One name only, never the full stored name: the admin is opening a
 * conversation, and the legal name typed at checkout ("Priya Sharma
 * Reddy") reads like a bank doing collections. Which token, and when none
 * is usable, is `firstName`'s problem.
 */
export function defaultContactMessage(ctx: ContactMessageContext): string {
  const name = firstName(ctx.customerName);
  const code = (ctx.orderCode ?? "").trim();
  const ask = code
    ? "Do you have a minute to help me out with your order?"
    : "Do you have a minute to speak?";
  const greeting = ["Hi", name, code].filter(Boolean).join(" ");
  return `${greeting}, I'm messaging from Cadieux. ${ask}`;
}
