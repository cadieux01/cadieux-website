// Splitting a long share message so WhatsApp cannot swallow the tail.
//
// THE BUG THIS EXISTS FOR
//
// Every partner row in the share popover is an `<a href="wa.me/<phone>
// ?text=<encodeURIComponent(message)>">`. That is a URL, and a URL has a
// length ceiling — imposed by the browser, by Android's Intent extras, and
// by WhatsApp itself, none of which agree on a number and none of which
// report a failure. Past roughly 5–6k URL-ENCODED characters the message
// simply arrives shorter than it left. No error, no warning: the rider gets
// a run sheet that ends mid-address and delivers the stops he can read.
//
// Encoded is the axis that matters, not raw. A run message is mostly
// newlines and spaces, each of which costs THREE characters once encoded
// (%0A, %20), so a 2,000-character message is already past 5,000 encoded.
// Counting `text.length` would have looked safe right up to the moment rows
// started disappearing.
//
// THE BUDGET IS DELIBERATELY WELL UNDER THE OBSERVED CEILING. The ceiling
// is not a documented constant and differs per handset; 4,000 leaves room
// for the `https://wa.me/919999999999?text=` prefix and for the part header
// added below, and it costs nothing — an extra chunk is a second tap, a
// truncated message is a missed delivery.
//
// SPLITTING IS ON STOP BOUNDARIES, NEVER MID-STOP. composeRun joins stops
// with a blank line, so a blank line is the only place a cut is safe. A cut
// anywhere else would hand a rider half an address, which is worse than the
// truncation this is fixing because it looks complete.

/** Encoded-character budget for one wa.me `?text=` payload. */
export const WA_ENCODED_BUDGET = 4000;

/** Room reserved in every chunk for the "(2/3)\n" header added at the end. */
const PART_HEADER_ALLOWANCE = 24;

/** What the URL will actually cost. The only length worth measuring. */
export function encodedLength(text: string): number {
  return encodeURIComponent(text).length;
}

/**
 * One message in, one or more in. A single returned string means it fitted
 * and is byte-identical to the input — callers can treat `length === 1` as
 * "nothing happened".
 *
 * When it does not fit, every chunk is prefixed "(2/3)" so the recipient
 * can see both that there is more coming and whether any of it went
 * missing in transit.
 */
export function splitShareMessage(
  text: string,
  budget: number = WA_ENCODED_BUDGET,
): string[] {
  if (encodedLength(text) <= budget) return [text];

  const blocks = text.split("\n\n");
  const chunks: string[] = [];
  let current: string[] = [];

  for (const block of blocks) {
    if (current.length === 0) {
      current.push(block);
      continue;
    }
    const candidate = [...current, block].join("\n\n");
    if (encodedLength(candidate) + PART_HEADER_ALLOWANCE > budget) {
      chunks.push(current.join("\n\n"));
      current = [block];
    } else {
      current.push(block);
    }
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));

  // A SINGLE stop larger than the whole budget is left intact and oversized
  // rather than cut in half. It cannot happen with today's format — one
  // stop is around 200 characters — and if the format ever grows that far,
  // an obviously-too-long message is a bug someone reports, whereas a stop
  // sliced down the middle is a bug someone delivers.
  if (chunks.length <= 1) return chunks.length === 1 ? chunks : [text];

  const n = chunks.length;
  return chunks.map((c, i) => `(${i + 1}/${n})\n${c}`);
}

/**
 * True when the browser can hand the OS the text directly, with no URL in
 * the middle and therefore no length ceiling at all.
 *
 * `navigator.share` cannot name a recipient, so this is only usable for the
 * "pick a contact yourself" path — a partner row still has to go through
 * wa.me/<phone> and still has to chunk.
 *
 * Must be called from the browser. Guarded for SSR because the admin pages
 * are prerendered.
 */
export function canNativeShare(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  );
}
