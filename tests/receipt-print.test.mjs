// The print rules, asserted on the ONE file that owns them.
//
// This test used to live in tests/order-receipt.test.mjs, asserting against
// app/orders/[id]/receipt/page.tsx. The block moved into
// components/ReceiptShell.tsx when the subscription summary and the
// per-delivery note were added, because three documents print on the same
// paper and a second hand-written copy of these rules is exactly how the bug
// below comes back on two more pages.
//
// THE BUG THESE RULES EXIST FOR is invisible on screen and only appears on
// paper. The root layout's chrome is a bare <div> (the off-canvas drawer) and
// a bare <button> (the floating music toggle), so a "header, footer, nav"
// rule matched NEITHER and the music button — position:fixed, so it is on
// every page — printed on the receipt.
//
// So the guard is by POSITION, not by tag name: everything at body level
// except the document's own <main> is hidden. The assertions below check the
// positional rule is present, that the tag-name rule has not crept back, and
// that no page has grown a print block of its own.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const SHELL = path.join(ROOT, "src/components/ReceiptShell.tsx");
const PRINT_BUTTON = path.join(ROOT, "src/components/PrintButton.tsx");

/** Every page that prints. Each must use the shell and own no print CSS. */
const RECEIPT_PAGES = [
  "src/app/orders/[id]/receipt/page.tsx",
  "src/app/subscriptions/[id]/receipt/page.tsx",
  "src/app/subscriptions/[id]/deliveries/[deliveryId]/receipt/page.tsx",
];

const read = (p) => fs.readFileSync(p, "utf8");

/**
 * The @media print block, bounded and with CSS comments stripped.
 *
 * Both are necessary. Slicing to end-of-file swept in the whole component,
 * and the comment explaining why tag names failed CONTAINS the string
 * "header, footer, nav" — so the doesNotMatch below fired on its own
 * documentation.
 */
function printBlock(src) {
  const start = src.indexOf("@media print");
  const end = src.indexOf("`}</style>", start);
  assert.ok(start !== -1 && end > start, "the print block must be locatable");
  return src.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
}

test("the print block keeps the site chrome off the paper by position, not by tag", () => {
  const block = printBlock(read(SHELL));

  assert.match(
    block,
    /body\s*>\s*\*:not\(main\)\s*\{[^}]*display:\s*none/,
    "everything at body level except the document must be hidden in print",
  );
  assert.doesNotMatch(
    block,
    /header,\s*footer,\s*nav/,
    "naming chrome tags is what failed; do not reintroduce it as the guard",
  );
  // The print button lives inside <main>, so it needs its own rule.
  assert.match(block, /\.no-print\s*\{[^}]*display:\s*none/);
});

test("the print button carries the class the rule hides", () => {
  // The two halves of one fact, in two files. A renamed class on either side
  // would leave a green "Download receipt" button printed on every receipt.
  assert.match(read(PRINT_BUTTON), /className="no-print"/);
});

test("the sheet drops its screen border and margins on paper", () => {
  const block = printBlock(read(SHELL));
  assert.match(block, /\.receipt-sheet\s*\{[^}]*border:\s*none/);
  assert.match(read(SHELL), /className="receipt-sheet"/);
});

test("EVERY receipt page renders through the shell and owns no print CSS", () => {
  for (const rel of RECEIPT_PAGES) {
    const src = read(path.join(ROOT, rel));

    assert.match(
      src,
      /<ReceiptShell/,
      `${rel} must render through ReceiptShell — a hand-rolled sheet is how ` +
        "the print rules drift apart",
    );
    assert.ok(
      !src.includes("@media print"),
      `${rel} has grown its own @media print block. There must be exactly ` +
        "one copy of these rules, in components/ReceiptShell.tsx",
    );
  }
});
