// Regenerates src/lib/emoji-data.ts from the Unicode tables built into the
// running Node binary. No network, no dependency, no hand-maintained list.
//
//   node scripts/generate-emoji-data.js
//
// Re-run after a Node major upgrade to pick up newly assigned emoji. The
// output is deterministic, so a no-op upgrade produces an empty diff.

const fs = require("fs");
const path = require("path");

// Group name -> code point ranges, in priority order. A code point lands in
// the FIRST group whose range contains it; the "More" sweep at the end
// catches everything these ranges miss, so the palette is always complete
// even when Unicode assigns emoji outside the blocks listed here.
const GROUPS = [
  ["Smileys & Emotion", [[0x1f600, 0x1f64f], [0x1f970, 0x1f97a], [0x2764, 0x2764]]],
  ["People & Body", [
    [0x1f440, 0x1f450], [0x1f464, 0x1f487], [0x1f574, 0x1f596],
    [0x1f90c, 0x1f93e], [0x1f9b0, 0x1f9df], [0x1fac0, 0x1fac5],
    [0x1faf0, 0x1faf8],
  ]],
  ["Animals & Nature", [
    [0x1f400, 0x1f43f], [0x1f980, 0x1f9ae], [0x1f330, 0x1f343],
    [0x1f384, 0x1f38f], [0x1fab0, 0x1fabf],
  ]],
  ["Food & Drink", [[0x1f344, 0x1f37f], [0x1f942, 0x1f96f], [0x1fad0, 0x1fadf]]],
  ["Travel & Places", [[0x1f680, 0x1f6ff], [0x1f3d4, 0x1f3f0], [0x1f30d, 0x1f32c]]],
  ["Activities", [[0x1f3a0, 0x1f3cf], [0x1f939, 0x1f93f], [0x1f947, 0x1f94c]]],
  ["Objects", [
    [0x1f4a0, 0x1f4ff], [0x1f50a, 0x1f53d], [0x1f6aa, 0x1f6bf],
    [0x1fa70, 0x1faaf],
  ]],
  ["Symbols", [
    [0x2190, 0x27bf], [0x2b00, 0x2bff], [0x1f191, 0x1f19a],
    [0x1f500, 0x1f509], [0x1f540, 0x1f54f],
  ]],
];

const seen = new Set();
const groups = [];

function take(bucket, ch) {
  if (seen.has(ch)) return;
  seen.add(ch);
  bucket.push(ch);
}

// Emoji_Presentation, not Extended_Pictographic — see the generated header.
function isEmoji(ch) {
  return /\p{Emoji_Presentation}/u.test(ch);
}

for (const [name, ranges] of GROUPS) {
  const bucket = [];
  for (const [lo, hi] of ranges) {
    for (let cp = lo; cp <= hi; cp++) {
      const ch = String.fromCodePoint(cp);
      if (isEmoji(ch)) take(bucket, ch);
    }
  }
  if (bucket.length > 0) groups.push([name, bucket]);
}

// Completeness sweep. Anything with the property that the curated ranges
// missed still reaches the operator, just filed under "More".
const more = [];
for (let cp = 0; cp <= 0x1fbff; cp++) {
  // Lone surrogates are not characters; String.fromCodePoint would produce
  // an unpaired half that no font can draw.
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  const ch = String.fromCodePoint(cp);
  if (isEmoji(ch)) take(more, ch);
}
if (more.length > 0) groups.push(["More", more]);

const total = groups.reduce((n, [, bucket]) => n + bucket.length, 0);

const lines = [];
const w = (s) => lines.push(s);

w("// Emoji palette for the admin row-reaction picker.");
w("//");
w("// GENERATED FILE — do not edit by hand. Regenerate with:");
w("//   node scripts/generate-emoji-data.js");
w("//");
w("// Contains every assigned code point in Node's Unicode tables carrying the");
w(`// Emoji_Presentation property: ${total} of them, deduplicated across groups,`);
w('// with a final sweep into "More" so nothing is silently dropped.');
w("//");
w("// WHY THAT PROPERTY, and not Extended_Pictographic, which sounds more");
w("// complete: Extended_Pictographic deliberately covers RESERVED ranges set");
w("// aside for emoji Unicode has not assigned yet. Enumerating it renders a");
w("// grid peppered with tofu boxes, and which cells are boxes differs per OS");
w("// and per OS version. Emoji_Presentation is assigned-only and defaults to");
w("// colour presentation, so every cell here draws as an emoji on its own,");
w("// without a variation selector.");
w("//");
w("// Consequently NOT included: characters that need U+FE0F to become emoji");
w("// (heart, sun, aeroplane) and multi-code-point ZWJ sequences (family). The");
w("// frequently-wanted ones are in PINNED_EMOJI, which is a quick-access row");
w("// and NOT a cap — the full grid sits directly underneath it.");
w("//");
w("// Each group is one packed string rather than an array of strings: same");
w("// characters, roughly a third of the bytes, unpacked surrogate-safely by");
w("// splitByCodePoint(). The picker imports this module lazily, so none of it");
w("// reaches the boards' initial bundle.");
w("");
w("/** Quick-access row above the full grid. A shortcut, never the limit. */");
w("export const PINNED_EMOJI: readonly string[] = [");
for (const [ch, why] of [
  ["\u{1F44D}", "thumbs up - acknowledged"],
  ["\u{1F44E}", "thumbs down"],
  ["\u{2705}", "check - done"],
  ["\u{274C}", "cross - problem"],
  ["\u{1F525}", "fire - urgent"],
  ["\u{1F440}", "eyes - looking into it"],
  ["\u{1F4DE}", "telephone - call them"],
  ["\u{1F4B0}", "money bag - payment issue"],
  ["\u{1F6A9}", "flag - flagged"],
  ["\u{2753}", "question - unclear"],
  ["\u{1F389}", "party popper - good news"],
  ["\u{1F614}", "pensive - bad news"],
]) {
  const esc = `"\\u{${ch.codePointAt(0).toString(16).toUpperCase()}}"`;
  w(`  ${esc}, // ${why}`);
}
w("];");
w("");
w("export type EmojiGroup = {");
w("  name: string;");
w("  /** Packed. Unpack with splitByCodePoint(). */");
w("  emoji: string;");
w("};");
w("");
w("export const EMOJI_GROUPS: readonly EmojiGroup[] = [");
for (const [name, bucket] of groups) {
  w(`  { name: ${JSON.stringify(name)}, emoji: ${JSON.stringify(bucket.join(""))} },`);
}
w("];");
w("");
w("/**");
w(" * Split a packed group into individual emoji.");
w(" *");
w(' * Array.from, not split(""), because these characters are astral:');
w(" * split would hand back lone surrogate halves and the grid would render");
w(" * mojibake instead of emoji.");
w(" */");
w("export function splitByCodePoint(packed: string): string[] {");
w("  return Array.from(packed);");
w("}");
w("");
w("/** Palette size, for the count in the picker footer. */");
w(`export const EMOJI_COUNT = ${total};`);
w("");

const out = path.join(__dirname, "..", "src", "lib", "emoji-data.ts");
fs.writeFileSync(out, lines.join("\n"));
process.stderr.write(
  `wrote ${total} emoji in ${groups.length} groups -> ${out}\n` +
    groups.map(([n, b]) => `  ${n}: ${b.length}`).join("\n") +
    "\n",
);
