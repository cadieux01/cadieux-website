// Handing a composed share message to WhatsApp, without ever truncating it.
//
// A fourteen-stop run is ~3,000 characters of text and well over that once
// URL-encoded. `wa.me/?text=` silently CUTS a payload that long — the
// operator sees WhatsApp open with the first few stops in it and nothing to
// say the rest were dropped. That is the worst possible failure for this
// button, because it looks like it worked.
//
// So the text is never put in a URL unless we know it survives, and it is
// never truncated. Three paths, in order of how little the operator has to
// do:
//
//   1. navigator.share — no length limit at all, and on macOS/iOS Safari the
//      native sheet lists WhatsApp. This is the normal path here.
//   2. wa.me, but ONLY if the encoded text is under the cap. Below the cap
//      this is better than a paste: the message arrives prefilled.
//   3. clipboard + WhatsApp Web, and the notice SAYS to paste. The one path
//      that costs the operator a keystroke, so it is the last one.
//
// If all three fail the notice says so. It never pretends.
//
// WHY THIS IS A MODULE AND NOT A FUNCTION IN THE ORDERS PAGE. It was the
// latter, and the subscriptions board grew its own near-copy before anyone
// noticed — which is the same way the orders print view ended up listing 60
// orders while the screen showed 9. Two boards share one WhatsApp and one
// set of limits; they should share one answer to "did it actually send".
//
// RELATED BUT DIFFERENT: share-chunks.ts. That one serves the per-partner
// rows, which address `wa.me/<phone>` and therefore CANNOT use
// navigator.share — it has no way to name a recipient — so the only thing
// left to do there is split. Here the recipient is chosen by the operator,
// so the no-ceiling path is available and splitting is unnecessary.

/** Encoded-length ceiling for a `wa.me/?text=` link. Browsers and WhatsApp
 *  both start cutting well above this; 1800 is the comfortable side of every
 *  limit involved rather than a measured edge. */
export const WA_URL_TEXT_LIMIT = 1800;

export type ShareDelivery = {
  notice: string;
  /** Whether the selection should be dropped. False when the operator still
   *  has to paste — they may want to re-share the same rows. */
  cleared: boolean;
};

/**
 * `count` and `noun` only ever reach the operator-facing notice; the text is
 * sent verbatim. `noun` exists because the subscriptions board shares plans,
 * not orders, and "Shared 3 orders." on that board is a lie about what left
 * the building.
 */
export async function deliverShareText(
  text: string,
  count: number,
  noun: string = "order",
): Promise<ShareDelivery> {
  const plural = count === 1 ? "" : "s";

  // 1. Native share sheet. Must be the FIRST await after the click or the
  //    transient user activation it requires is already spent.
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return { notice: `Shared ${count} ${noun}${plural}.`, cleared: true };
    } catch (err) {
      // The operator dismissing the sheet is not a failure and must not fall
      // through to opening WhatsApp behind their back.
      if (err instanceof DOMException && err.name === "AbortError") {
        return { notice: "Share cancelled.", cleared: false };
      }
      // Anything else (no matching target, permission) → keep going.
    }
  }

  // 2. Prefilled wa.me, but only when the whole message fits.
  const encoded = encodeURIComponent(text);
  if (encoded.length <= WA_URL_TEXT_LIMIT) {
    window.open(`https://wa.me/?text=${encoded}`, "_blank", "noopener,noreferrer");
    return {
      notice: `Opening WhatsApp with ${count} ${noun}${plural}.`,
      cleared: true,
    };
  }

  // 3. Too long for a link. Copy it whole and say what to do with it.
  try {
    await navigator.clipboard.writeText(text);
    window.open("https://web.whatsapp.com/", "_blank", "noopener,noreferrer");
    return {
      notice:
        "Too long for WhatsApp direct — copied to clipboard instead, paste it into the chat.",
      cleared: true,
    };
  } catch {
    return {
      notice: `Too long for WhatsApp direct and the clipboard is blocked. Use Print, or share ${count > 8 ? `fewer ${noun}s at a time` : "them one at a time"}.`,
      cleared: false,
    };
  }
}
