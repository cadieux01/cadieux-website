"use client";

// Compact row of three icon buttons (Call / WhatsApp / SMS) shown next
// to every phone number in the admin panel. Call opens the dialer
// directly; WhatsApp and SMS first open a small modal so the admin can
// edit the prefilled message before sending.
//
// ─────────────────────────────────────────────────────────────────────
// TWO MODES, AND NINE OF THE TEN CALL SITES ARE THE OLD ONE.
//
// Pass `trackOrderId` and the buttons become the orders-board version:
// RED until somebody on the team has used that channel for that order,
// GREEN afterwards, with the press recorded to public.order_contacts.
// Omit it — as the customers list, the subscriptions screens and the rest
// still do — and this component behaves exactly as it did before: cream
// outlines, no colour, no writes, no network. The same applies to
// `skipMessageModal`, which defaults to today's behaviour.
//
// Both props exist rather than one because they are different decisions.
// A screen could reasonably want the shared colour without losing the
// message modal; the orders board happens to want both.
// ─────────────────────────────────────────────────────────────────────

import { useState } from "react";

import { adminFetch } from "@/lib/admin-client";
import { getAdminFirstName } from "@/lib/admin-first-name";
import type { ContactChannel, ContactPress, OrderContacts } from "@/lib/order-contacts";
import {
  ContactMessageContext,
  defaultContactMessage,
  smsHref,
  telHref,
  whatsAppHrefWithText,
} from "@/lib/phone-utils";

const CREAM = "#FBF3D4";
const FADED = "rgba(251,243,212,0.6)";
const BORDER = "rgba(251,243,212,0.35)";

/**
 * ░░ THE TWO REDS IN THIS ADMIN ARE DELIBERATELY DIFFERENT THINGS. ░░
 *
 * StatusBadge already owns a red — #EF4444 — for `cancelled` and `failed`.
 * This is not that red and must not be unified with it. The difference the
 * eye actually reads is the TREATMENT, not the hex: a status badge is red
 * TEXT on a transparent background, and these buttons are cream on a SOLID
 * red fill. A filled chip and an outlined chip do not get confused with
 * each other at a glance even when the hues are close, which is the whole
 * requirement — the colours exist so an operator can see who has and has
 * not been contacted without reading anything.
 *
 * The hex differs too (#B3261E is darker and less orange than #EF4444) so
 * that the two are distinguishable side by side in the same row, which is
 * where they will in fact appear: a cancelled order still has a customer
 * who may need ringing.
 *
 * If you are here because the inconsistency looks like a mistake: it is
 * not, and making these #EF4444 to "match" would merge a STATE OF THE
 * ORDER with a RECORD OF OUR OWN ACTIONS into one colour.
 */
const CONTACT_RED = "#B3261E";

/**
 * ░░ THE GREEN IS DARK ON PURPOSE. DO NOT BRIGHTEN IT TO #1B6B45. ░░
 *
 * The first version of this used #1B6B45, which looks right and measures
 * badly: against CONTACT_RED its contrast ratio is 1.01. The two fills had
 * effectively IDENTICAL luminance and differed only in hue, so to a
 * red-green colourblind operator — roughly 1 man in 12 — the board was two
 * indistinguishable grey chips, and "see at a glance who has and has not
 * been contacted" is the whole point of the feature.
 *
 * Measured, so the next person does not have to re-derive it:
 *
 *                      vs CONTACT_RED   cream icon   chip vs page bg
 *   #1B6B45 (rejected)     1.01           5.83           2.59
 *   #0F4A2D (this)         1.58           9.26           1.63
 *
 * Darker still separates better (#08301E reaches 2.21) but the fill then
 * sinks into the near-black admin background, so the chip stops reading as
 * a chip. #0F4A2D is the compromise, and GREEN_BORDER below is lighter than
 * the fill specifically to keep the chip's edge crisp at that darkness.
 *
 * Going DARKER rather than lighter is also the right way round for a second
 * reason: the operator is scanning for the orders NOBODY has contacted. If
 * green were the brighter chip, the eye would be pulled to the ones already
 * handled. Red should be the loud one.
 *
 * 1.58 is a real brightness difference but it is not a large one, which is
 * why the colour is NOT the only cue — see ContactedTick below. Do not
 * remove the tick on the grounds that the colours already say it.
 */
const CONTACT_GREEN = "#0F4A2D";
const CONTACT_GREEN_BORDER = "#2F9E68";

type Channel = "whatsapp" | "sms";

/**
 * Icon button label, plus who/when if we know it.
 *
 * Only called for a GREEN button, so the "contacted" clause is
 * unconditional. The press object can still be missing on a green button —
 * that is the optimistic case, pressed a second ago and not yet read back
 * from the server — and the honest answer there is "contacted" with no
 * attribution rather than no clause at all. The aria-label and the title
 * have to agree; they did not in the first cut of this.
 */
function pressTitle(label: string, press: ContactPress | undefined): string {
  if (!press) return `${label} — contacted`;
  // NaN means the stamp is ABSENT, never epoch 0 — a junk date must not
  // render as "1 Jan 1970" next to a customer's name.
  const when = new Date(press.last_contacted_at);
  const stamp = Number.isNaN(when.getTime())
    ? null
    : when.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });
  const bits = [stamp, press.last_author].filter(Boolean).join(" · ");
  return bits.length > 0 ? `${label} — contacted ${bits}` : `${label} — contacted`;
}

export function ContactActions({
  phone,
  customerName,
  orderCode,
  size = 28,
  stopPropagation = true,
  trackOrderId,
  contacts,
  skipMessageModal = false,
}: {
  phone: string | null | undefined;
  customerName?: string | null;
  /** OLF/OLS reference only. Omit on screens that are about a customer
   *  rather than one order — the message drops the clause. */
  orderCode?: string | null;
  size?: number;
  /**
   * When the buttons sit inside a clickable row (e.g. the customers
   * list links each row to the detail page), we swallow the click so
   * tapping a button doesn't also navigate.
   */
  stopPropagation?: boolean;
  /**
   * orders.id. Supplying it turns on the shared red/green state and the
   * write to public.order_contacts. This is the orders board only — it is
   * the UUID, NOT the OLF code in `orderCode`, which is a display string.
   */
  trackOrderId?: string | null;
  /** Server-side contact state for this order, from /api/admin/orders. */
  contacts?: OrderContacts;
  /**
   * Open WhatsApp/SMS straight away instead of showing the edit-first
   * modal. Default false = every existing screen is untouched.
   *
   * Safe to skip because the modal was never a send confirmation: both
   * wa.me?text= and sms:?body= hand the message to the target app
   * UNSENT and still editable there. The modal is a confirmation in front
   * of a confirmation, and on the board — where the point is that a press
   * acts immediately — it is one tap in the way.
   */
  skipMessageModal?: boolean;
}) {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [message, setMessage] = useState("");
  // Optimistically-green channels. Merged with the server's view below, so
  // a press lights up on the same frame it fires rather than after a round
  // trip the operator would see as lag.
  const [justPressed, setJustPressed] = useState<ContactChannel[]>([]);

  if (!phone) return null;

  const ctx: ContactMessageContext = { customerName, orderCode };
  const tracked = typeof trackOrderId === "string" && trackOrderId.length > 0;

  function isGreen(c: ContactChannel): boolean {
    return justPressed.includes(c) || Boolean(contacts?.[c]);
  }

  /**
   * Record the press. ALWAYS CALLED AFTER THE CHANNEL HAS ALREADY OPENED.
   *
   * Nothing here is awaited by the caller and nothing here can fail in a
   * way the operator sees, by design: window.open() has to run
   * synchronously inside the click handler or the browser blocks the popup
   * outright, so there is no ordering in which this write could usefully
   * come first. Errors are swallowed to the console — a lost write means
   * the button is red again on the next load and somebody rings twice,
   * which is the direction this feature is supposed to fail in.
   */
  function record(c: ContactChannel) {
    if (!tracked) return;
    // Optimistic green lives HERE and nowhere else. OrderRow is memoised on
    // the row object, so a background refetch re-renders this component
    // rather than remounting it and this state survives — by which time the
    // server's own `contacts` has usually caught up anyway. There is
    // deliberately no callback up to the board: nothing else on that page
    // reads contact state, and a prop threaded through a memoised row
    // purely to mirror a value would be a second copy to keep in step.
    setJustPressed((prev) => (prev.includes(c) ? prev : [...prev, c]));
    // getAdminFirstName, NOT ensureAdminFirstName. The `ensure` variant
    // window.prompt()s when no name is stored, which would put a modal
    // dialog in front of an action whose entire specification is that it
    // happens immediately — and it would do it mid-dial. A null author is
    // a valid row; a prompt here is not.
    void adminFetch("/api/admin/contacts", {
      method: "POST",
      body: JSON.stringify({
        order_id: trackOrderId,
        channel: c,
        author: getAdminFirstName(),
      }),
    }).catch((err) => {
      console.error("[ContactActions record]", err);
    });
  }

  function openChannel(c: Channel) {
    // The modal path. The press is recorded in send(), not here — until
    // the operator confirms, no channel has been opened and nothing has
    // happened that a green button should be claiming.
    setMessage(defaultContactMessage(ctx));
    setChannel(c);
  }

  function hrefFor(c: Channel, text: string): string {
    return c === "whatsapp"
      ? whatsAppHrefWithText(phone, text)
      : smsHref(phone, text);
  }

  /** The no-modal path: open now, inside the click handler, then record. */
  function openDirect(c: Channel) {
    const url = hrefFor(c, defaultContactMessage(ctx));
    if (typeof window !== "undefined" && url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    record(c);
  }

  function send() {
    if (!channel) return;
    const url = hrefFor(channel, message);
    if (typeof window !== "undefined" && url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    record(channel);
    setChannel(null);
  }

  const guard = (e: React.MouseEvent) => {
    if (stopPropagation) {
      e.stopPropagation();
    }
  };

  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
    // Anchor for ContactedTick. Costs the untracked screens nothing —
    // position:relative on an element with no positioned children does not
    // move it or change its box.
    position: "relative",
  };

  // Untracked screens keep the original cream outline exactly. Only a
  // tracked order gets the filled red/green pair.
  function styleFor(c: ContactChannel): React.CSSProperties {
    if (!tracked) {
      return {
        ...baseStyle,
        border: `1px solid ${BORDER}`,
        background: "transparent",
        color: CREAM,
      };
    }
    const green = isGreen(c);
    return {
      ...baseStyle,
      // Red borders itself; green borders LIGHTER than its fill, because the
      // green fill is dark enough to blend into the page without an edge.
      border: `1px solid ${green ? CONTACT_GREEN_BORDER : CONTACT_RED}`,
      background: green ? CONTACT_GREEN : CONTACT_RED,
      color: CREAM,
    };
  }

  const iconSize = Math.max(14, Math.round(size * 0.55));

  // Icons stay, per the width measurement: "CALL WHATSAPP MESSAGE" is
  // ~189px of text before padding and gaps, and the CUSTOMER column on a
  // 375px viewport is 161px wide. Labelled buttons would wrap to three
  // lines on every row. The channel is still NAMED for anyone who needs it
  // — aria-label for a screen reader, title on hover — and when the button
  // is green the title says who contacted them and when.
  function labelFor(c: ContactChannel, word: string) {
    const green = tracked && isGreen(c);
    return {
      title: green ? pressTitle(word, contacts?.[c]) : word,
      "aria-label": `${word} ${phone}${green ? " — already contacted" : ""}`,
    };
  }

  function tickFor(c: ContactChannel) {
    return tracked && isGreen(c) ? <ContactedTick /> : null;
  }

  return (
    <>
      <span
        className="inline-flex items-center gap-1.5"
        onClick={guard}
        onMouseDown={guard}
      >
        {/* Stays an <a href="tel:">. The dial is the browser's own default
            action on the anchor, which is the most reliable way to open a
            dialer there is — no window.open, nothing to block, and it
            still works if our JS throws. record() rides alongside it and
            deliberately does not preventDefault. */}
        <a
          href={telHref(phone)}
          {...labelFor("call", "Call")}
          style={styleFor("call")}
          onClick={(e) => {
            guard(e);
            record("call");
          }}
        >
          <PhoneIcon size={iconSize} />
          {tickFor("call")}
        </a>
        <button
          type="button"
          {...labelFor("whatsapp", "WhatsApp")}
          style={styleFor("whatsapp")}
          onClick={(e) => {
            guard(e);
            if (skipMessageModal) openDirect("whatsapp");
            else openChannel("whatsapp");
          }}
        >
          <WhatsAppIcon size={iconSize} />
          {tickFor("whatsapp")}
        </button>
        <button
          type="button"
          {...labelFor("sms", "Message")}
          style={styleFor("sms")}
          onClick={(e) => {
            guard(e);
            if (skipMessageModal) openDirect("sms");
            else openChannel("sms");
          }}
        >
          <SmsIcon size={iconSize} />
          {tickFor("sms")}
        </button>
      </span>

      {channel ? (
        <MessageModal
          channel={channel}
          phone={phone}
          message={message}
          onMessage={setMessage}
          onCancel={() => setChannel(null)}
          onSend={send}
        />
      ) : null}
    </>
  );
}

function MessageModal({
  channel,
  phone,
  message,
  onMessage,
  onCancel,
  onSend,
}: {
  channel: Channel;
  phone: string;
  message: string;
  onMessage: (s: string) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(29,29,31,0.7)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md"
        style={{
          background: "rgb(29,29,31)",
          border: `1px solid ${BORDER}`,
          // 3-zone scrollable layout
          display: "flex",
          flexDirection: "column",
          maxHeight: "min(90vh, calc(100dvh - 2rem))",
          minHeight: 0,
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            flexShrink: 0,
            padding: "1.25rem 1.5rem 0.85rem",
            background: "rgb(29,29,31)",
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <h4
            className="uppercase"
            style={{
              margin: 0,
              fontFamily: "var(--font-heading)",
              color: CREAM,
              fontSize: "1.1rem",
              letterSpacing: "0.2em",
              fontWeight: 300,
            }}
          >
            {channel === "whatsapp" ? "Send WhatsApp" : "Send SMS"}
          </h4>
          <p
            style={{
              margin: "4px 0 0",
              fontFamily: "var(--font-body)",
              color: FADED,
              fontSize: "0.875rem",
              letterSpacing: "0.1em",
            }}
          >
            To {phone}
          </p>
        </div>

        <div
          data-lenis-prevent
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            padding: "1rem 1.5rem",
          }}
        >
          <textarea
            value={message}
            onChange={(e) => onMessage(e.target.value)}
            rows={8}
            className="w-full px-3 py-2"
            style={{
              border: `1px solid ${BORDER}`,
              background: "transparent",
              color: CREAM,
              fontFamily: "var(--font-body)",
              fontSize: "1rem",
              lineHeight: 1.5,
              resize: "vertical",
            }}
          />
        </div>

        <div
          style={{
            flexShrink: 0,
            padding: "1rem 1.5rem 1.25rem",
            background: "rgb(29,29,31)",
            borderTop: `1px solid ${BORDER}`,
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.875rem",
              letterSpacing: "0.25em",
              color: FADED,
              border: `1px solid ${BORDER}`,
              padding: "0.45rem 0.9rem",
              background: "transparent",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSend}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.875rem",
              letterSpacing: "0.25em",
              color: CREAM,
              border: `1px solid ${CREAM}`,
              padding: "0.45rem 0.9rem",
              background: "transparent",
            }}
          >
            {channel === "whatsapp" ? "Open WhatsApp" : "Open SMS"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ░░ THE CONTACTED STATE IS CARRIED BY SHAPE AS WELL AS COLOUR. ░░
 *
 * A cream disc with a dark tick, sat on the bottom-right corner of a green
 * button. It exists because colour alone is not a safe channel for this:
 * the two fills measure 1.58 contrast against each other (see CONTACT_GREEN
 * above), which separates for most people and barely separates for a
 * red-green colourblind operator. A tick is unambiguous at any ratio, to
 * anyone, including on a phone screen in direct sun — which is where this
 * board is actually read, standing next to a delivery van.
 *
 * So this is not decoration and not redundancy. DO NOT REMOVE IT on the
 * grounds that the button is already green; green is the fast cue and the
 * tick is the one that still works when green does not.
 *
 * Details that matter:
 *  • pointerEvents: "none" — the Call button is an <a href="tel:"> whose
 *    whole reliability argument is that dialling is the browser's own
 *    default action. An overlay that could become the click target would
 *    quietly take that away.
 *  • The disc is CREAM on the green fill (9.26:1) and sits on the corner
 *    rather than centred, so it reads as a badge ON the icon instead of
 *    obscuring which channel the button is.
 *  • Sized off a constant, not the button: at the board's size=28 this is
 *    12px, large enough to resolve a tick and small enough to leave the
 *    phone/WhatsApp/SMS glyph recognisable.
 */
function ContactedTick() {
  const S = 12;
  return (
    <span
      style={{
        position: "absolute",
        right: -2,
        bottom: -2,
        width: S,
        height: S,
        pointerEvents: "none",
        display: "block",
      }}
      aria-hidden
    >
      <svg width={S} height={S} viewBox="0 0 12 12">
        <circle cx="6" cy="6" r="6" fill={CREAM} />
        <path
          d="M3 6.2 5.1 8.3 9 4.4"
          fill="none"
          stroke={CONTACT_GREEN}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function PhoneIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.94.37 1.85.72 2.71a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.37-1.29a2 2 0 0 1 2.11-.45c.86.35 1.77.59 2.71.72A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function WhatsAppIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 0 1 8.413 3.488 11.82 11.82 0 0 1 3.48 8.414c-.003 6.555-5.338 11.89-11.893 11.89a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.518 5.276l-.999 3.648 3.97-1.218zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.149-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
    </svg>
  );
}

function SmsIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
