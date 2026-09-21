// Evening bake-plan digest email.
//
// Sent daily at ~18:00 IST (12:30 UTC) to the baker's inbox with EVERYTHING
// due tomorrow — one-time orders + subscription deliveries — grouped by
// delivery slot so it doubles as a production order.
//
// WHY THIS EXISTS
// The bake happens the night before the delivery day. The baker needs one
// glance at "how many loaves, of which kind, for which slot" before firing
// up the oven, and later "who to hand each bag to". Two systems supply that
// data (orders + subscription_deliveries) so a single stitched-together
// email removes the daily "check both dashboards" chore.
//
// EMPTY IS STILL SENT. If nothing is scheduled the email STILL goes out
// saying so — silence would look like the cron broke. The distinction
// between "nothing tomorrow" and "cron down" is load-bearing.

// The line shape is DEFINED in @/lib/bake-plan-lines, beside the two queries
// that build it, and re-exported here so existing importers of this module
// keep working. The production strip above /admin/orders reads the same
// loaders — the email the baker opens at six and the strip he reads at five
// must be counting the same loaves.
export type { BakeItem, BakePlanLine } from "@/lib/bake-plan-lines";

import type { BakeItem, BakePlanLine } from "@/lib/bake-plan-lines";

/** "2 × Protein Bread — Plain". The one place this string is built. */
function itemLine(i: BakeItem): string {
  return `${i.qty} × ${i.name}`;
}

export interface BakePlanEmail {
  subject: string;
  html: string;
  text: string;
}

/** One row in the "unresolved stale deliveries" section — subscription
 *  deliveries whose date is >7 days past and status is still not terminal
 *  (parent not cancelled). Surfaced daily; NEVER auto-resolved. The DB
 *  cannot know whether the loaf actually went out — Sunny does. */
export interface StaleDeliveryLine {
  subscriptionNumber: string;
  /** Booking-time snapshot from `subscriptions.customer_name` — see
   *  stale-deliveries.ts for why the joined `customers.full_name` is
   *  unsafe (shared-phone stale-join). */
  customerName: string;
  /** Booking-time snapshot from `subscriptions.customer_phone`. Rendered
   *  as a `tel:` link so Sunny can dial the correct owner directly from
   *  the email. Empty string is legal — very old rows have no snapshot. */
  customerPhone: string;
  daysOverdue: number;
  deliveryStatus: string;
  parentStatus: string;
}

/**
 * The three canonical delivery windows the site actually books today. Any
 * order stored with a bare "HH:MM" or NULL is legacy or pickup and lands
 * in one of the other sections — never wedged into a canonical bucket by
 * a best-guess mapping. See @/lib/delivery-slots for the authoritative
 * definition of the same three windows on the customer side.
 */
const DELIVERY_SLOTS: {
  value: string;
  label: string;
  windowLabel: string;
}[] = [
  { value: "06:00-10:00", label: "Morning", windowLabel: "6 – 10 AM" },
  { value: "10:00-14:00", label: "Midday", windowLabel: "10 AM – 2 PM" },
  { value: "16:00-21:00", label: "Evening", windowLabel: "4 – 9 PM" },
];

/**
 * One rendered section of the email. `groupSlotValue` is the canonical
 * slot string when the section is a canonical delivery bucket (used to
 * suppress the "(recorded as \"…\")" hint on lines that match); null
 * otherwise — including the always-rendered "Slot not set" section and
 * every pickup section.
 */
interface Section {
  key: string;
  headerLabel: string;
  groupSlotValue: string | null;
  /** Pickup counter rather than a van run. Drives the ready-time line and
   *  the header colour; pickup lines never get the slot hint, because the
   *  ready-time line already prints the same stored value. */
  isPickup: boolean;
  lines: BakePlanLine[];
  loaves: number;
}

/** Canonical slot value → human window, e.g. "10:00-14:00" → "10 AM – 2 PM". */
const SLOT_WINDOW = new Map(
  DELIVERY_SLOTS.map((s) => [s.value, s.windowLabel] as const),
);

/**
 * The ready time printed on every pickup line.
 *
 * THE ONLY HONEST SOURCE IS THE STORED SLOT. There is no promised-ready-time
 * field anywhere: `orders.pickup_ready_at` is an EVENT STAMP written when an
 * admin flips the status to `ready_for_pickup`, so on a plan for a future
 * date it is always NULL (measured: 0 of the future-dated pickup rows carry
 * one, against 18 of the 58 historical rows), and `pickup_locations` has no
 * opening-hours column at all. So this prints the slot when one was stored —
 * 2 of 58 pickup orders on record have one — and says so plainly when it was
 * not. Inventing an hour here would be promising a time nobody committed to;
 * the customer-facing share message refuses the same invention for the same
 * reason (see order-share-customer.ts::whenLine).
 */
function readyTimeLabel(line: BakePlanLine): string {
  const raw = (line.slot || "").trim();
  if (!raw) return "Ready time not set";
  // Legacy bare "07:30" values print verbatim — never mapped to a window
  // name, because the window it belongs to is a guess.
  return `Ready ${SLOT_WINDOW.get(raw) ?? raw}`;
}

/** Total loaves across every item on every line. Items are structured
 *  ({name, qty}), so no regex reparse — see BakeItem for why. */
function loafCount(lines: BakePlanLine[]): number {
  let n = 0;
  for (const l of lines) {
    for (const it of l.items) n += it.qty;
  }
  return n;
}

function pluralize(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** "N orders · M loaves". Loaves are the ACTIONABLE number — bread to move
 *  is what a baker at 4am needs, and Dark store 3 (14 orders / 29 loaves)
 *  vs dark store 01 (17 orders / 20 loaves) proves order count alone would
 *  send the wrong quantity to the wrong counter. */
function sectionCountsLabel(s: Section): string {
  const n = s.lines.length;
  const l = s.loaves;
  return `${n} ${pluralize(n, "order", "orders")} · ${l} ${pluralize(l, "loaf", "loaves")}`;
}

/**
 * Per-line hint, e.g. ` (recorded as "07:30")`. Shown whenever the line
 * has a slot value that isn't the section's canonical string — so:
 *   • legacy times in a canonical section ("07:30" inside Morning)
 *   • any slot value in Slot not set (all deliveries with non-canonical times)
 * Empty when the line matches the header, or when there is no value —
 * repeating the header on every line would be noise.
 *
 * NOT called on pickup lines: readyTimeLabel() already prints that same
 * stored value as the ready time, and two renderings of one field on one
 * line reads as two different facts.
 */
function slotHint(
  line: BakePlanLine,
  groupSlotValue: string | null,
): string {
  const raw = (line.slot || "").trim();
  if (!raw) return "";
  if (raw === groupSlotValue) return "";
  return ` (recorded as "${raw}")`;
}

/**
 * Build every section for the email, always in the same order:
 *   1. Morning (canonical) — even at 0
 *   2. Midday (canonical) — even at 0
 *   3. Evening (canonical) — even at 0
 *   4. Slot not set — even at 0 (a missing header is a bug, never a zero)
 *   5. Pickup — <point name> (verbatim, sorted); rendered only when non-empty
 *
 * Grouping is by fulfillment_type FIRST, then slot. Two pickup orders on
 * record (OLF81, OLF259) carry a canonical delivery-slot string; slot-first
 * grouping would land them in a delivery section and someone would load
 * them onto a van for a store address.
 */
function buildSections(lines: BakePlanLine[]): Section[] {
  const deliveries = lines.filter((l) => l.fulfillment === "delivery");
  const pickups = lines.filter((l) => l.fulfillment === "pickup");

  const canonicalBuckets = new Map<string, BakePlanLine[]>();
  for (const s of DELIVERY_SLOTS) canonicalBuckets.set(s.value, []);
  const unset: BakePlanLine[] = [];
  for (const d of deliveries) {
    const slot = (d.slot || "").trim();
    if (slot && canonicalBuckets.has(slot)) {
      canonicalBuckets.get(slot)!.push(d);
    } else {
      unset.push(d);
    }
  }

  const pickupBuckets = new Map<string, BakePlanLine[]>();
  for (const p of pickups) {
    const key = (p.pickupPointName || "").trim() || "__unspecified__";
    const cur = pickupBuckets.get(key);
    if (cur) cur.push(p);
    else pickupBuckets.set(key, [p]);
  }

  const sections: Section[] = [];

  for (const s of DELIVERY_SLOTS) {
    const lns = canonicalBuckets.get(s.value)!;
    sections.push({
      key: `slot:${s.value}`,
      headerLabel: `${s.label} · ${s.windowLabel}`,
      groupSlotValue: s.value,
      isPickup: false,
      lines: lns,
      loaves: loafCount(lns),
    });
  }

  // ALWAYS rendered, even at zero — a legacy delivery-time value or an
  // otherwise unroutable delivery going non-zero on a future send is a
  // "something new broke" signal, and the header must be there for the
  // reader to notice its own value.
  sections.push({
    key: "slot:unset",
    headerLabel: "Slot not set",
    groupSlotValue: null,
    isPickup: false,
    lines: unset,
    loaves: loafCount(unset),
  });

  // Verbatim pickup point names — see BakePlanLine.pickupPointName for
  // why we do NOT normalise the casing. Sorted case-insensitively so the
  // ordering does not depend on the exact spellings stored today.
  const pickupKeys = Array.from(pickupBuckets.keys()).sort((a, b) => {
    if (a === "__unspecified__") return 1;
    if (b === "__unspecified__") return -1;
    return a.localeCompare(b, "en", { sensitivity: "base" });
  });
  for (const k of pickupKeys) {
    const lns = pickupBuckets.get(k)!;
    const displayName = k === "__unspecified__" ? "(unspecified point)" : k;
    sections.push({
      key: `pickup:${k}`,
      headerLabel: `Pickup · ${displayName}`,
      groupSlotValue: null,
      isPickup: true,
      lines: lns,
      loaves: loafCount(lns),
    });
  }

  return sections;
}

/** Sum every item line across every deliverable → totals per product.
 *
 *  This used to build "<qty> × <name>" strings upstream and then parse them
 *  back out with a regex. Items are structured now, so the round trip — and
 *  its failure mode, a product name containing "×" splitting into a wrong
 *  quantity — is gone. */
function rollupProducts(lines: BakePlanLine[]): { name: string; qty: number }[] {
  const totals = new Map<string, number>();
  for (const l of lines) {
    for (const it of l.items) {
      totals.set(it.name, (totals.get(it.name) || 0) + it.qty);
    }
  }
  return Array.from(totals.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render "Sat, 12 Sep 2026" from an ISO date (YYYY-MM-DD), IST-neutral. */
export function formatBakeDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleDateString("en-IN", {
    weekday: "short",
    timeZone: "UTC",
  });
  const day = dt.getUTCDate();
  const month = dt.toLocaleDateString("en-IN", {
    month: "short",
    timeZone: "UTC",
  });
  return `${weekday}, ${day} ${month} ${dt.getUTCFullYear()}`;
}

/**
 * Build the bake-plan email for a given delivery date.
 *
 * `lines` may be empty — in that case the email says "Nothing scheduled" and
 * is STILL returned so the caller can send it. Callers must NOT swallow the
 * empty case; a delivered "nothing" is the daily heartbeat.
 */
/** Render the "unresolved stale deliveries" HTML + text blocks. Empty
 *  `stale` returns two empty strings — the caller can concatenate blindly. */
function renderStaleSection(stale: StaleDeliveryLine[]): {
  html: string;
  text: string;
} {
  if (stale.length === 0) return { html: "", text: "" };
  const textParts: string[] = [];
  textParts.push("UNRESOLVED STALE DELIVERIES");
  textParts.push(
    `${stale.length} subscription deliver${stale.length === 1 ? "y is" : "ies are"} more than 7 days past their date and still open.`,
  );
  textParts.push("Decide by hand — the DB does not know if bread went out.");
  for (const s of stale) {
    const phone = s.customerPhone ? ` — ${s.customerPhone}` : "";
    textParts.push(
      `  ${s.subscriptionNumber} — ${s.customerName}${phone} — ${s.daysOverdue}d overdue (delivery: ${s.deliveryStatus}, parent: ${s.parentStatus})`,
    );
  }
  textParts.push("");
  const rows = stale
    .map((s) => {
      const phoneHtml = s.customerPhone
        ? `<div><a href="tel:${escapeHtml(s.customerPhone)}" style="color:#024628">${escapeHtml(s.customerPhone)}</a></div>`
        : "";
      return `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${escapeHtml(s.subscriptionNumber)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">
          <div>${escapeHtml(s.customerName)}</div>
          ${phoneHtml}
        </td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#991B1B;font-weight:600">${s.daysOverdue}d</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;color:#666">
          delivery: ${escapeHtml(s.deliveryStatus)}<br/>parent: ${escapeHtml(s.parentStatus)}
        </td>
      </tr>`;
    })
    .join("");
  const html = `
      <h3 style="margin:28px 0 6px;font-size:15px;color:#991B1B">
        Unresolved stale deliveries
        <span style="color:#999;font-weight:400;font-size:13px"> · ${stale.length}</span>
      </h3>
      <p style="margin:0 0 8px;font-size:13px;color:#666">
        More than 7 days past their date and still open. Decide by hand — the database can't tell whether the loaf actually went out.
      </p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <tr style="text-align:left;color:#666">
          <th style="padding:6px 10px;border-bottom:1px solid #ddd">Subscription</th>
          <th style="padding:6px 10px;border-bottom:1px solid #ddd">Customer</th>
          <th style="padding:6px 10px;border-bottom:1px solid #ddd">Overdue</th>
          <th style="padding:6px 10px;border-bottom:1px solid #ddd">Status</th>
        </tr>
        ${rows}
      </table>`;
  return { html, text: textParts.join("\n") };
}

/**
 * Which of the three cron sends this email represents. Controls the subject
 * line (planning vs instruction) and the empty-body wording ("nothing
 * scheduled for tomorrow" vs "nothing to bake today"). Default is d1_1800
 * so pre-existing callers and the manual `?date=` re-run path continue to
 * read as the evening plan.
 *
 *   d1_1800  — evening send for tomorrow's delivery (existing 18:45 IST)
 *   d1_2215  — late send for tomorrow, after Midday cutoff
 *   d0_0445  — final tally for TODAY's delivery, after Evening cutoff
 *              (an instruction, not a report — Sunny's rule)
 */
export type SendSlot = "d1_1800" | "d1_2215" | "d0_0445";

function subjectPrefix(sendSlot: SendSlot): string {
  switch (sendSlot) {
    case "d0_0445":
      return "Bake today";
    case "d1_2215":
      return "Bake plan update";
    case "d1_1800":
    default:
      return "Bake plan";
  }
}

function emptyBodySentence(sendSlot: SendSlot): string {
  return sendSlot === "d0_0445"
    ? "Nothing to bake today — no orders, no subscription deliveries."
    : "Nothing scheduled for tomorrow — no orders, no subscription deliveries.";
}

export function buildBakePlan(
  deliveryDateIso: string,
  lines: BakePlanLine[],
  stale: StaleDeliveryLine[] = [],
  sendSlot: SendSlot = "d1_1800",
): BakePlanEmail {
  const humanDate = formatBakeDate(deliveryDateIso);
  const orderCount = lines.filter((l) => l.kind === "order").length;
  const subCount = lines.filter((l) => l.kind === "subscription").length;
  const total = lines.length;
  const totalLoaves = loafCount(lines);

  // Pickups are already inside `total`, `totalLoaves` and the bake rollup —
  // they always were. This makes that VISIBLE, because a counter loaf and a
  // van loaf come out of the same oven and the summary line says
  // "N deliveries", which reads like pickups were left out.
  const pickupLines = lines.filter((l) => l.fulfillment === "pickup");
  const pickupCount = pickupLines.length;
  const pickupSummary =
    pickupCount === 0
      ? ""
      : ` (incl. ${pickupCount} pickup · ${loafCount(pickupLines)} ${pluralize(loafCount(pickupLines), "loaf", "loaves")})`;

  // Cutoff notice. Never print an exact time — the schedule may drift by up
  // to an hour on Hobby's random-jitter behaviour, and a printed clock time
  // that disagrees with the "Received:" header is worse than no time at all.
  // The live board link is the source of truth for "as of right now".
  const liveHref = `https://www.cadieux.in/admin/orders?basis=delivery&date=${encodeURIComponent(deliveryDateIso)}`;

  const staleSection = renderStaleSection(stale);
  const prefix = subjectPrefix(sendSlot);

  // Stale count rides in the subject line when there are unresolved rows,
  // so the summary is visible from the inbox list without opening. Format
  // examples:
  //   "Bake plan for Fri, 12 Sep 2026: 6 deliveries · 14 loaves"
  //   "Bake plan for Fri, 12 Sep 2026: nothing scheduled · 4 stale"
  //   "Bake today Sat, 20 Sep 2026: 4 deliveries · 8 loaves"
  const staleSuffix =
    stale.length > 0 ? ` · ${stale.length} stale` : "";
  const subject =
    total === 0
      ? `${prefix} ${humanDate}: nothing scheduled${staleSuffix}`
      : `${prefix} ${humanDate}: ${total} deliver${total === 1 ? "y" : "ies"} · ${totalLoaves} ${pluralize(totalLoaves, "loaf", "loaves")}${staleSuffix}`;

  if (total === 0) {
    const emptyBody = emptyBodySentence(sendSlot);
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:720px">
        <p style="font-size:16px;margin:0 0 12px">
          <strong>${escapeHtml(humanDate)}</strong>
        </p>
        <p style="font-size:15px;margin:0 0 12px">
          ${escapeHtml(emptyBody)}
        </p>
        <p style="font-size:13px;color:#666;margin:0 0 12px">
          This email is sent on schedule so a silent inbox means the cron is down, not a quiet day.
        </p>
        ${staleSection.html}
      </div>`;
    const textLines = [
      humanDate,
      "",
      emptyBody,
      "",
      "This email is sent on schedule so a silent inbox means the cron is down, not a quiet day.",
    ];
    if (staleSection.text) {
      textLines.push("", staleSection.text);
    }
    return { subject, html, text: textLines.join("\n") };
  }

  const sections = buildSections(lines);
  const rollup = rollupProducts(lines);

  // ── Text ───────────────────────────────────────────────────────────────
  const textParts: string[] = [];
  textParts.push(humanDate);
  textParts.push(
    `${total} deliver${total === 1 ? "y" : "ies"} · ${totalLoaves} ${pluralize(totalLoaves, "loaf", "loaves")} — ${orderCount} order${orderCount === 1 ? "" : "s"}, ${subCount} subscription${subCount === 1 ? "" : "s"}${pickupSummary}`,
  );
  textParts.push(
    `Orders placed after this email are not counted. Live figure: ${liveHref}`,
  );
  textParts.push("");
  textParts.push("BAKE TOTALS");
  for (const r of rollup) {
    textParts.push(`  ${r.qty} × ${r.name}`);
  }
  textParts.push("");
  for (const sec of sections) {
    textParts.push(`— ${sec.headerLabel} (${sectionCountsLabel(sec)}) —`);
    if (sec.lines.length === 0) {
      textParts.push("");
      continue;
    }
    for (const l of sec.lines) {
      const hint = sec.isPickup ? "" : slotHint(l, sec.groupSlotValue);
      textParts.push(
        `  [${l.kind === "order" ? "ORD" : "SUB"}] ${l.ref}${hint} — ${l.customerName} — ${l.customerPhone}`,
      );
      textParts.push(`    ${l.address}`);
      if (sec.isPickup) textParts.push(`    ${readyTimeLabel(l)}`);
      for (const item of l.items) textParts.push(`    · ${itemLine(item)}`);
    }
    textParts.push("");
  }
  if (staleSection.text) {
    textParts.push(staleSection.text);
    textParts.push("");
  }
  const text = textParts.join("\n");

  // ── HTML ───────────────────────────────────────────────────────────────
  const rollupRows = rollup
    .map(
      (r) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${escapeHtml(String(r.qty))}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeHtml(r.name)}</td>
      </tr>`,
    )
    .join("");

  const groupHtml = sections
    .map((sec) => {
      const headerColor = sec.isPickup ? "#436CB4" : "#024628";
      const emptyBodyRow =
        sec.lines.length === 0
          ? `<p style="margin:0 0 0 4px;font-size:13px;color:#999">(nothing here — the section is rendered anyway so a missing header would read as a bug, not a zero)</p>`
          : "";
      const rows = sec.lines
        .map((l) => {
          const badge =
            l.kind === "order"
              ? `<span style="display:inline-block;padding:1px 6px;font-size:11px;background:#024628;color:#FBF3D4;border-radius:3px;letter-spacing:0.4px">ORDER</span>`
              : `<span style="display:inline-block;padding:1px 6px;font-size:11px;background:#436CB4;color:#FBF3D4;border-radius:3px;letter-spacing:0.4px">SUB</span>`;
          const hint = sec.isPickup ? "" : slotHint(l, sec.groupSlotValue);
          const hintHtml = hint
            ? `<span style="color:#B45309;font-weight:400;font-size:12px">${escapeHtml(hint.trim())}</span>`
            : "";
          const readyHtml = sec.isPickup
            ? `<div style="color:#436CB4;font-size:12px;margin-top:4px;font-weight:600">${escapeHtml(readyTimeLabel(l))}</div>`
            : "";
          const itemLis = l.items
            .map(
              (i) => `<li style="margin:2px 0">${escapeHtml(itemLine(i))}</li>`,
            )
            .join("");
          return `
            <tr>
              <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">
                ${badge}
                <div style="margin-top:4px;font-weight:600">${escapeHtml(l.ref)} ${hintHtml}</div>
              </td>
              <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">
                <div><strong>${escapeHtml(l.customerName)}</strong></div>
                <div><a href="tel:${escapeHtml(l.customerPhone)}" style="color:#024628">${escapeHtml(l.customerPhone)}</a></div>
                <div style="color:#666;font-size:12px;margin-top:4px">${escapeHtml(l.address)}</div>
                ${readyHtml}
              </td>
              <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">
                <ul style="margin:0;padding-left:16px;font-size:13px">${itemLis}</ul>
              </td>
            </tr>`;
        })
        .join("");
      const tableHtml =
        sec.lines.length === 0
          ? emptyBodyRow
          : `<table style="border-collapse:collapse;width:100%;font-size:14px">${rows}</table>`;
      return `
        <h3 style="margin:24px 0 6px;font-size:15px;color:${headerColor}">
          ${escapeHtml(sec.headerLabel)}
          <span style="color:#999;font-weight:400;font-size:13px"> · ${escapeHtml(sectionCountsLabel(sec))}</span>
        </h3>
        ${tableHtml}`;
    })
    .join("");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:720px">
      <p style="font-size:16px;margin:0 0 4px">
        <strong>${escapeHtml(humanDate)}</strong>
      </p>
      <p style="font-size:14px;color:#666;margin:0 0 4px">
        ${total} deliver${total === 1 ? "y" : "ies"} · ${orderCount} order${orderCount === 1 ? "" : "s"} · ${subCount} subscription${subCount === 1 ? "" : "s"}${escapeHtml(pickupSummary)}
      </p>
      <p style="font-size:12px;color:#888;margin:0 0 20px">
        Orders placed after this email are not counted.
        <a href="${liveHref}" style="color:#024628">Live figure &rarr;</a>
      </p>

      <h3 style="margin:0 0 6px;font-size:15px;color:#024628">Bake totals</h3>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <tr style="text-align:left;color:#666">
          <th style="padding:6px 10px;border-bottom:1px solid #ddd;width:60px">Qty</th>
          <th style="padding:6px 10px;border-bottom:1px solid #ddd">Product</th>
        </tr>
        ${rollupRows}
      </table>

      ${groupHtml}

      ${staleSection.html}
    </div>`;

  return { subject, html, text };
}
