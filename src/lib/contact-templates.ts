// The eight outbound WhatsApp/SMS templates the team actually sends.
//
// ░░ THESE WERE NOT IN THE CODEBASE. THEY WERE IN PEOPLE'S PHONES. ░░
//
// Until now the only message this app could seed was
// `defaultContactMessage` — one line opening a conversation. Everything
// else the team sends (confirmations, postponements, "send your current
// location") was pasted by hand from a note, which is why three of the
// eight reached customers reading "Team Cadiuex", why the confirmation
// promised "between 4PM - 9PM" to morning-slot customers, and why #7 was
// missing a word ("pick your at the designated location"). A template
// kept outside the product cannot be corrected once, and cannot
// interpolate anything.
//
// ── WHY THIS IS CODE AND NOT A `message_templates` TABLE ──
// The two things that were wrong with the pasted copy are both things a
// text column cannot fix:
//
//   • (SLOT) has to come from THIS ORDER's delivery_slot. 188 of the 312
//     orders since 1 Oct are on 10:00-14:00 and 79 on 16:00-21:00, so a
//     stored sentence naming one window is wrong for most recipients.
//   • (Name) has to come from THIS customer, which is what makes a bulk
//     send one message per recipient rather than one message to a list.
//
// A row in a table is a string with holes in it; the holes are the
// feature. Editing the words still means a deploy, and that is the
// honest trade — the alternative is an admin screen for editing copy
// that nobody asked for, in front of a table whose rows must agree with
// the interpolation code anyway.
//
// ── WHAT IS DELIBERATELY NOT HERE ──
// No line wraps. The source these came from was wrapped at ~78 columns
// for reading; WhatsApp and SMS rewrap on the recipient's screen, so
// baked-in newlines mid-sentence produce ragged text on a phone. Only
// paragraph breaks survive.
//
// No sending. Every template is a SEED for the modal textarea — the
// operator reads it, edits it if the situation needs it, and the channel
// opens with the text prefilled but UNSENT. Nothing here talks to
// MSG91 or the WhatsApp API.

import { formatSlotWindow } from "@/lib/delivery-slots";
import { shareDateLabel } from "@/lib/order-share-customer";
import { firstName } from "@/lib/phone-utils";

export type ContactTemplateId =
  | "call_unanswered"
  | "postponed"
  | "confirmation"
  | "subscription"
  | "incomplete"
  | "location"
  | "pickup"
  | "rescheduled";

export type ContactTemplateContext = {
  /** Full name as stored. `firstName` picks the token to greet by. */
  customerName?: string | null;
  /** An OLF/OLS reference and nothing else, already formatted. */
  orderCode?: string | null;
  /** The order's stored slot ("16:00-21:00"), NOT a display label. */
  deliverySlot?: string | null;
  /** The order's IST calendar date ("2026-10-16"). */
  deliveryDate?: string | null;
};

const SIGN_OFF = "Regards,\nTeam Cadieux (The Protein Brand)";

/**
 * "If you have any other requests, please respond to this text."
 *
 * Present in four of the eight and absent from four — that is the
 * team's own copy, not an oversight to be tidied up. The four without it
 * (postponed, incomplete, location, pickup) either already ask for a
 * reply in their own words or are apologising, where inviting "any other
 * requests" reads badly.
 */
const REPLY_INVITE =
  "If you have any other requests, please respond to this text.";

/**
 * ░░ "Cadieux", NEVER "Cadiuex". ░░
 *
 * The misspelling was live in three of the eight templates (call
 * unanswered, confirmation, subscription) and went to customers. It is
 * spelled exactly once in this file, in SIGN_OFF, so it cannot drift
 * again — if you are adding a ninth template, use SIGN_OFF rather than
 * typing the brand name.
 */
function compose(lines: Array<string | null>): string {
  return [...lines.filter((l): l is string => Boolean(l)), SIGN_OFF].join("\n");
}

/**
 * "Hi Madhu!" / "Hello Madhu!", and "Hi!" when no stored token is usable.
 *
 * `firstName` returns "" for the 74 nameless rows and for the ones
 * holding initials or a phone number, so the exclamation mark has to
 * attach to the greeting word and not to the name — "Hi !" is the shape
 * this avoids.
 */
function greeting(ctx: ContactTemplateContext, word = "Hi"): string {
  const name = firstName(ctx.customerName);
  return name ? `${word} ${name}!` : `${word}!`;
}

/**
 * The slot as prose, 12-hour: "4 PM and 9 PM" for "16:00-21:00".
 *
 * Ruled by Raja, and it is the right call twice over: his own hand-typed
 * draft said "4PM - 9PM", and Vizag customers read a 12-hour clock. The
 * templates say "between (SLOT)", so the two ends need a word between
 * them — "between 4 - 9 PM" is what a timetable says, not a person.
 *
 * DERIVED from `formatSlotWindow`, which is derived from the canonical
 * slot's `rangeLabel`, so the hours in a customer's message can never
 * disagree with the hours on the checkout page. The only thing added
 * here is the conjunction and the meridiem on the first number:
 *
 *   "6 - 10 AM"    → "6 AM and 10 AM"    (one meridiem, distributed)
 *   "10 AM - 2 PM" → "10 AM and 2 PM"    (both already present)
 *   "4 - 9 PM"     → "4 PM and 9 PM"
 *
 * A legacy or junk value that `formatSlotWindow` cannot split is
 * returned as it formatted it rather than mangled.
 */
export function slotPhrase(slot: string | null | undefined): string {
  const window = formatSlotWindow(slot);
  if (!window) return "";
  const parts = window.split(" - ");
  if (parts.length !== 2) return window;
  const [start, end] = parts as [string, string];
  if (/\b(AM|PM)\b/i.test(start)) return `${start} and ${end}`;
  const meridiem = /\b(AM|PM)$/i.exec(end);
  return meridiem ? `${start} ${meridiem[1]} and ${end}` : `${start} and ${end}`;
}

/**
 * ░░ THE NO-SLOT FALLBACK IS A SENTENCE, NOT A SKIPPED ORDER. ░░
 *
 * 41 of the 312 orders since 1 Oct have no `delivery_slot` at all. They
 * still need confirming, so excluding them from the confirmation
 * template would mean the 41 customers least likely to know when their
 * bread is coming are the ones who hear nothing. Ruled by Raja:
 * fallback, not exclusion.
 *
 * It also has to be honest. "between 10 AM and 2 PM" invented for a row
 * with no slot is a promise nobody made, and the operator pasting it
 * would not know it was invented.
 */
const SLOT_UNKNOWN = "we will confirm the time window shortly";

/** "It will be delivered tomorrow between 4 PM and 9 PM." or, with no
 *  slot stored, "It will be delivered tomorrow; we will confirm the time
 *  window shortly." */
function tomorrowLine(ctx: ContactTemplateContext): string {
  const slot = slotPhrase(ctx.deliverySlot);
  return slot
    ? `It will be delivered tomorrow between ${slot}.`
    : `It will be delivered tomorrow; ${SLOT_UNKNOWN}.`;
}

/**
 * The reschedule sentence: date, and the window if we have one.
 *
 * `deliveryDate` is read from the order, which means the operator is
 * expected to MOVE THE ORDER FIRST and then send the message — the
 * stored date is the new date by the time this renders. That ordering is
 * the point: a message naming a date the order is not actually on is the
 * failure this template exists to prevent (templates 1 and 2 both say
 * "tomorrow", which is wrong the moment an order moves two days out).
 *
 * With no date stored the placeholder "(DATE)" is left in the text
 * DELIBERATELY UNFILLED. The operator reads the message in the modal
 * before anything opens, and an obvious hole is the one thing that
 * cannot be mistaken for a real date — unlike "tomorrow", which would
 * send cleanly and be wrong.
 */
function rescheduleLine(ctx: ContactTemplateContext): string {
  const date = shareDateLabel(ctx.deliveryDate) || "(DATE)";
  const slot = slotPhrase(ctx.deliverySlot);
  return slot
    ? `We are sorry to inform you that your order has been rescheduled to ${date}, between ${slot}. We will ensure it reaches you then.`
    : `We are sorry to inform you that your order has been rescheduled to ${date}. We will ensure it reaches you then, and ${SLOT_UNKNOWN}.`;
}

export type ContactTemplate = {
  id: ContactTemplateId;
  /** Picker label. Short — these sit in a row inside a 28rem modal. */
  label: string;
  body: (ctx: ContactTemplateContext) => string;
};

export const CONTACT_TEMPLATES: ContactTemplate[] = [
  {
    id: "call_unanswered",
    label: "Call unanswered",
    body: (ctx) =>
      compose([
        greeting(ctx),
        "We are sorry to say that the delivery attempt of your order has failed since you have not responded to our call. We will attempt to deliver it tomorrow at the same time.",
        REPLY_INVITE,
      ]),
  },
  {
    id: "postponed",
    label: "Postponed",
    body: (ctx) =>
      compose([
        greeting(ctx),
        // ░░ RAJA SHOULD CONFIRM THIS SENTENCE — IT IS NOT VERBATIM. ░░
        // The stored copy read "has been postponed and I deliver
        // tomorrow", which is garbled rather than merely misspelled, so
        // there was no way to carry it across untouched. Rendered as the
        // passive the rest of the template set uses.
        "We are sorry to inform that your order has been postponed and will be delivered tomorrow due to a delay that we are experiencing at the moment.",
      ]),
  },
  {
    id: "confirmation",
    label: "Confirmation",
    body: (ctx) =>
      compose([
        // The emoji is in the team's copy and stays. It is the only one
        // in the set — a confirmation is the one unambiguously good
        // message here, and the other seven are apologies or requests.
        `${greeting(ctx)}😁`,
        `We are pleased to say that your order has been confirmed. ${tomorrowLine(ctx)}`,
        REPLY_INVITE,
      ]),
  },
  {
    id: "subscription",
    label: "Subscription welcome",
    body: (ctx) =>
      compose([
        greeting(ctx),
        "We are pleased to welcome you to our family as a subscriber. We will ensure your orders will be delivered on time.",
        REPLY_INVITE,
      ]),
  },
  {
    id: "incomplete",
    label: "Incomplete order",
    body: (ctx) =>
      compose([
        greeting(ctx),
        "We are sorry to say that your order has not been fulfilled. We will ensure to deliver the rest of it tomorrow at the same time.",
        "Thank you for understanding.",
      ]),
  },
  {
    id: "location",
    label: "Location + availability",
    body: (ctx) => {
      // The ONLY template that quotes the order reference, and the only
      // one where its absence changes the sentence rather than dropping
      // a clause. Six of the ten ContactActions call sites are about a
      // CUSTOMER and pass no code; "your order ()" is not a thing to
      // send anyone.
      const code = (ctx.orderCode ?? "").trim();
      return compose([
        greeting(ctx),
        code
          ? `We are reaching out to deliver your order ${code}. Kindly send your current location and confirm your availability.`
          : "We are reaching out to deliver your order. Kindly send your current location and confirm your availability.",
      ]);
    },
  },
  {
    id: "pickup",
    label: "Pickup",
    body: (ctx) =>
      compose([
        // "Hello", not "Hi" — the team's own copy for this one. Left
        // alone: a pickup customer is being asked to make a trip, and
        // the slightly more formal opening is theirs to choose.
        greeting(ctx, "Hello"),
        // "pick your order up at", not "pick your at" — the stored copy
        // was missing the noun.
        "We are pleased to inform you that your order has been confirmed. Please ensure to pick your order up at the designated location and time.",
      ]),
  },
  {
    id: "rescheduled",
    label: "Rescheduled to a date",
    body: (ctx) => compose([greeting(ctx), rescheduleLine(ctx), REPLY_INVITE]),
  },
];

export function renderContactTemplate(
  id: ContactTemplateId,
  ctx: ContactTemplateContext,
): string {
  const template = CONTACT_TEMPLATES.find((t) => t.id === id);
  return template ? template.body(ctx) : "";
}
