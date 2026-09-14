// Parse whatever the customer pasted into the admin's Location box on
// an order into { latitude, longitude }.
//
// Accepted shapes, in order of preference:
//   1. Raw pair:  "17.7241, 83.3105"  (comma-separated, whitespace OK)
//   2. Google Maps URL variants — the ones customers actually paste
//      from WhatsApp's "Share location":
//         https://www.google.com/maps/place/.../@17.7241,83.3105,17z/...
//         https://www.google.com/maps?q=17.7241,83.3105
//         https://maps.google.com/?q=17.7241,83.3105
//         https://www.google.com/maps/dir/.../.../@17.7241,83.3105,17z
//         https://www.google.com/maps/.../data=!3d17.7241!4d83.3105
//   3. Short link:  https://maps.app.goo.gl/xxxxxxxx
//      Followed once (redirect: manual, 5 s timeout), then re-parsed
//      as case 2 against the resolved URL.
//
// Anything else — a place name, a plus code, a screenshot filename,
// junk — returns null. The API layer converts null into a 400. We do
// NOT geocode a name into coordinates: an admin's paste is trusted to
// be a coordinate, not a lookup key.

const COORD_RE =
  /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

// Google Maps embeds coordinates in three places we care about, in
// decreasing order of precision:
//   - !3d<lat>!4d<lng>  — the data param on a fully-loaded place URL
//   - @<lat>,<lng>,     — the viewport centre on a directions / place URL
//   - q=<lat>,<lng>     — the legacy search-query form
// The order below matters: !3d/!4d is the pin itself; @ is the map
// centre (usually the same, but not always for directions URLs).
const MAPS_DATA_RE = /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/;
const MAPS_AT_RE = /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/;
const MAPS_Q_RE = /[?&]q=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/;

const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);

export type ParsedCoords = { latitude: number; longitude: number };

function inRange(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/**
 * Pure regex-only parse. Never fetches. Used both directly (for cases
 * 1 and 2) and as the second pass after a short-link resolve.
 */
export function parseLocationPasteSync(input: string): ParsedCoords | null {
  const raw = input.trim();
  if (!raw) return null;

  // Case 1: raw "lat, lng"
  const m1 = raw.match(COORD_RE);
  if (m1) {
    const lat = parseFloat(m1[1]);
    const lng = parseFloat(m1[2]);
    if (inRange(lat, lng)) return { latitude: lat, longitude: lng };
    return null;
  }

  // Case 2: Google Maps URL variants — try the three embed patterns in
  // decreasing-precision order.
  for (const re of [MAPS_DATA_RE, MAPS_AT_RE, MAPS_Q_RE]) {
    const m = raw.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (inRange(lat, lng)) return { latitude: lat, longitude: lng };
    }
  }

  return null;
}

/**
 * Full parse. Falls back to one HTTP redirect follow for short links,
 * then re-parses the resolved URL with parseLocationPasteSync.
 *
 * Timeout is 5 s; anything slower is treated as unparseable. Never
 * throws — the caller gets null on any failure.
 */
export async function parseLocationPaste(
  input: string,
): Promise<ParsedCoords | null> {
  const raw = input.trim();
  if (!raw) return null;

  // Fast path: try the sync parse first. If it works, we're done —
  // no HTTP fetch needed even if the input happened to look like a URL
  // (e.g. a full google.com/maps URL already carries the coords).
  const direct = parseLocationPasteSync(raw);
  if (direct) return direct;

  // Short-link fallback. Only follow maps.app.goo.gl / goo.gl — we do
  // NOT chase arbitrary URLs. This bounds the attack surface (no SSRF
  // against internal hosts) and matches what WhatsApp actually shares.
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!SHORT_HOSTS.has(url.hostname)) return null;

  try {
    const res = await fetch(url.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: {
        // Google will 403 an obviously-scraped request; a real UA
        // string gets a redirect back cleanly.
        "user-agent":
          "Mozilla/5.0 (compatible; CadieuxAdmin/1.0; +https://www.cadieux.in)",
      },
    });
    // Look for a Location header on the 3xx response. Anything else
    // (200, 4xx, 5xx) means the short link didn't resolve — give up.
    if (res.status < 300 || res.status >= 400) return null;
    const loc = res.headers.get("location");
    if (!loc) return null;
    return parseLocationPasteSync(loc);
  } catch {
    return null;
  }
}
