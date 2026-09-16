// Getting a delivery run OUT of the admin and INTO WhatsApp, without
// losing any of it.
//
// THE BUG THIS EXISTS TO FIX: the run was handed to WhatsApp by stuffing
// the whole message into `https://wa.me/?text=<encoded>`. A 14-stop day is
// ~4,000 characters of text and ~5–6k once percent-encoded. Browsers cap
// URL length, and WhatsApp caps the prefill it will accept, so the tail of
// the run was dropped on the floor. Nothing errored. The operator saw a
// message with the first few orders in it and no indication that the rest
// had ever existed — which is the worst possible failure for a document
// someone drives a scooter around the city following.
//
// So: never put a long run in a URL, and NEVER silently truncate. Three
// paths, tried in this order.
//
//   1. navigator.share({ text })  — the Web Share API takes a string, not
//      a URL, so it has no length limit at all. It opens the native sheet,
//      WhatsApp included. This is the path Safari on macOS and iOS takes,
//      which is what this admin is actually driven from.
//
//   2. wa.me/?text=…  — only when the ENCODED length is comfortably under
//      the limit. Kept because for a one- or two-stop share it is a single
//      tap straight into a chat, and losing that to solve a 14-stop problem
//      would be a bad trade.
//
//   3. Clipboard + open WhatsApp + TELL THE OPERATOR TO PASTE. The honest
//      fallback. It is two actions instead of one, but it moves the whole
//      run, and the UI says so rather than leaving him to wonder why his
//      list looks short.

/**
 * Ceiling for the ENCODED wa.me payload, well under where browsers and
 * WhatsApp start trimming. Deliberately conservative: the cost of being
 * too cautious is one paste, and the cost of being too generous is a rider
 * sent out with half a route.
 */
export const WA_TEXT_LIMIT = 1800;

/** Which of the three paths actually carried the message. */
export type SharePath =
  | "web-share" // native sheet, no length limit
  | "wa-url" // wa.me prefill, short enough to be safe
  | "clipboard" // copied; operator pastes
  | "cancelled" // operator dismissed the native sheet
  | "failed"; // nothing worked — say so, do not pretend

export type ShareOutcome = {
  path: SharePath;
  /** Characters of plain text (what the rider reads). */
  textLength: number;
  /** Characters once percent-encoded (what a URL would have had to carry). */
  encodedLength: number;
  /** Ready to show verbatim. Explains the paste step when there is one. */
  notice: string;
};

/** Open WhatsApp with no prefilled text, for the paste-it-yourself path. */
function openWhatsApp(): void {
  window.open("https://wa.me/", "_blank", "noopener,noreferrer");
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hand `text` to WhatsApp by the best path available, and report which one
 * was taken so the caller can tell the operator the truth.
 *
 * MUST be called directly from a user gesture (a click handler). Both
 * `navigator.share` and `window.open` are gesture-gated, and the Web Share
 * call below is reached with no `await` before it so the gesture is still
 * live when it runs.
 */
export async function shareRun(text: string, label: string): Promise<ShareOutcome> {
  const textLength = text.length;
  const encodedLength = encodeURIComponent(text).length;
  const measure = { textLength, encodedLength };

  // 1. Web Share. No length limit, native sheet, WhatsApp in the list.
  const canWebShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    // canShare is absent on some implementations that still support share();
    // only treat an explicit `false` as a refusal.
    (typeof navigator.canShare !== "function" || navigator.canShare({ text }));

  if (canWebShare) {
    try {
      await navigator.share({ text });
      return { ...measure, path: "web-share", notice: `Shared ${label}.` };
    } catch (err) {
      // The operator closing the sheet is not a failure and must not fall
      // through to opening a second thing behind their back.
      const name = (err as { name?: string } | null)?.name;
      if (name === "AbortError") {
        return { ...measure, path: "cancelled", notice: "" };
      }
      // Anything else (permission, unsupported target) → keep going.
    }
  }

  // 2. wa.me, but only while the encoded payload is provably safe.
  if (encodedLength <= WA_TEXT_LIMIT) {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
    return { ...measure, path: "wa-url", notice: `Opening WhatsApp with ${label}.` };
  }

  // 3. Too long for a URL. Copy the WHOLE thing and say so plainly.
  const copied = await copyToClipboard(text);
  if (copied) {
    openWhatsApp();
    return {
      ...measure,
      path: "clipboard",
      notice: `Too long for WhatsApp direct — ${label} copied to clipboard instead, paste it into the chat.`,
    };
  }

  // Clipboard denied too. Do NOT fall back to a truncating wa.me link.
  return {
    ...measure,
    path: "failed",
    notice: `Could not copy ${label} — clipboard is blocked. Use Copy in the toolbar, or allow clipboard access for this site.`,
  };
}
