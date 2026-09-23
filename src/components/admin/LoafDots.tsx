// One dot per unit, under the OLF number on every order row.
//
// Green = Plain, red = Multigrain, yellow = Burger bun. Two plain + two
// multigrain reads as two green dots and two red dots, so the operator sees
// the bag contents without opening the order.
//
// COLOUR IS NOT DECIDED HERE. The palette and the slug→tone registry live
// in ProductMarker (PRODUCT_TONES / TONE_COLOURS) and this file imports
// them, so the same loaf can never be two colours on two boards. It used to
// declare its own PLAIN/MULTIGRAIN constants, which is exactly how the
// orders board came to paint Multigrain red while the subscriptions board
// painted it amber. Adding a product means editing ProductMarker only.
//
// IDENTITY IS BY SLUG, NOT NAME. This matched `name.includes("multigrain")`
// before, which quietly did two wrong things: a product with no keyword in
// its name fell through to a hollow dot (the burger bun did, on every row,
// from the day it launched), and a rename of the display string would have
// re-bucketed live orders. See lib/order-items.ts for the two jsonb shapes
// `orders.items` is written in and why the key is `slug ?? product_id`.
//
// A product with no tone still gets a hollow cream dot rather than being
// silently counted as Plain — an unknown must look unknown.

import type { AdminOrderItemSnapshot } from "@/lib/admin-shared";
import { itemQty, itemSlug } from "@/lib/order-items";
import { TONE_COLOURS, toneForProduct, type MarkerTone } from "./ProductMarker";

/** Guard against a bad row painting thousands of nodes. Rendering concern,
 *  so it lives here and not in itemQty() — a count must never be capped. */
const MAX_DOTS_PER_LINE = 99;

export function LoafDots({
  items,
}: {
  items: AdminOrderItemSnapshot[] | null | undefined;
}) {
  if (!items || items.length === 0) return null;

  const dots: { tone: MarkerTone; label: string }[] = [];
  for (const it of items) {
    const slug = itemSlug(it);
    const tone = slug ? toneForProduct(slug) : "neutral";
    // Label from the row's own name — humans read the tooltip, and the
    // stored name is the most specific thing we have. Falls back to the
    // slug so an unnamed line is still identifiable.
    const label =
      String(it.name ?? "").trim() || slug || "Item";
    const n = Math.min(itemQty(it), MAX_DOTS_PER_LINE);
    for (let i = 0; i < n; i++) dots.push({ tone, label });
  }
  if (dots.length === 0) return null;

  const summary = dots.map((d) => d.label).join(", ");

  return (
    <div
      className="flex flex-wrap items-center gap-1"
      style={{ marginTop: 6 }}
      title={summary}
      aria-label={`Items: ${summary}`}
    >
      {dots.map((d, i) => (
        <span
          key={i}
          aria-hidden
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            display: "inline-block",
            background: TONE_COLOURS[d.tone].bg,
            border:
              d.tone === "neutral"
                ? "1px solid rgba(251,243,212,0.6)"
                : "none",
          }}
        />
      ))}
    </div>
  );
}
