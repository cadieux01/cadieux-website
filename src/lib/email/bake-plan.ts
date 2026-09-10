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

/** One deliverable line — same shape for orders and subscription rows. */
export interface BakePlanLine {
  /** "OLF56", "SUB #12", etc. — printable ref for the human. */
  ref: string;
  /** "order" | "subscription" — used for the section label only. */
  kind: "order" | "subscription";
  /** Delivery slot as stored ("morning", "afternoon", null, …). */
  slot: string | null;
  /** Customer's display name (best effort). */
  customerName: string;
  /** Customer phone as stored (10 or +91 form; not normalised). */
  customerPhone: string;
  /** Flattened address for the driver — line1 / city / pincode. */
  address: string;
  /** Item lines to bake: "2 × Protein Bread — Plain", … */
  items: string[];
  /** Rupees, integer. Used for the running total, not per-line display. */
  amountInr: number;
}

export interface BakePlanEmail {
  subject: string;
  html: string;
  text: string;
}

/** Preferred display order for known slots. Unknowns append alphabetically. */
const SLOT_ORDER = [
  "breakfast",
  "morning",
  "afternoon",
  "evening",
  "night",
];

function slotLabel(s: string | null): string {
  if (!s) return "Unspecified slot";
  const t = s.trim();
  if (!t) return "Unspecified slot";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function slotRank(s: string | null): number {
  if (!s) return 999;
  const idx = SLOT_ORDER.indexOf(s.trim().toLowerCase());
  return idx < 0 ? 500 : idx;
}

/** Group lines by slot, ordered by SLOT_ORDER then alpha. */
function groupBySlot(
  lines: BakePlanLine[],
): { slot: string | null; lines: BakePlanLine[] }[] {
  const buckets = new Map<string, BakePlanLine[]>();
  for (const l of lines) {
    const key = l.slot ?? "__none__";
    const cur = buckets.get(key);
    if (cur) cur.push(l);
    else buckets.set(key, [l]);
  }
  const keys = Array.from(buckets.keys());
  keys.sort((a, b) => {
    const av = a === "__none__" ? null : a;
    const bv = b === "__none__" ? null : b;
    const ra = slotRank(av);
    const rb = slotRank(bv);
    if (ra !== rb) return ra - rb;
    return (av ?? "").localeCompare(bv ?? "");
  });
  return keys.map((k) => ({
    slot: k === "__none__" ? null : k,
    lines: buckets.get(k)!,
  }));
}

/** Sum every "N × Product" line across every deliverable → totals per product. */
function rollupProducts(lines: BakePlanLine[]): { name: string; qty: number }[] {
  const totals = new Map<string, number>();
  for (const l of lines) {
    for (const raw of l.items) {
      // Item strings are pre-built as "<qty> × <name>". Parse defensively —
      // if the format ever changes, the raw string is treated as a single unit.
      const m = raw.match(/^\s*(\d+)\s*[×x]\s*(.+?)\s*$/);
      if (m) {
        const q = parseInt(m[1], 10);
        const name = m[2].trim();
        totals.set(name, (totals.get(name) || 0) + (isFinite(q) ? q : 1));
      } else {
        totals.set(raw, (totals.get(raw) || 0) + 1);
      }
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
export function buildBakePlan(
  deliveryDateIso: string,
  lines: BakePlanLine[],
): BakePlanEmail {
  const humanDate = formatBakeDate(deliveryDateIso);
  const orderCount = lines.filter((l) => l.kind === "order").length;
  const subCount = lines.filter((l) => l.kind === "subscription").length;
  const total = lines.length;

  const subject =
    total === 0
      ? `Bake plan for ${humanDate}: nothing scheduled`
      : `Bake plan for ${humanDate}: ${total} deliver${total === 1 ? "y" : "ies"}`;

  if (total === 0) {
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:560px">
        <p style="font-size:16px;margin:0 0 12px">
          <strong>${escapeHtml(humanDate)}</strong>
        </p>
        <p style="font-size:15px;margin:0 0 12px">
          Nothing scheduled for tomorrow — no orders, no subscription deliveries.
        </p>
        <p style="font-size:13px;color:#666;margin:0">
          This email is sent every evening so a silent inbox means the cron is down, not a quiet day.
        </p>
      </div>`;
    const text = [
      humanDate,
      "",
      "Nothing scheduled for tomorrow — no orders, no subscription deliveries.",
      "",
      "This email is sent every evening so a silent inbox means the cron is down, not a quiet day.",
    ].join("\n");
    return { subject, html, text };
  }

  const groups = groupBySlot(lines);
  const rollup = rollupProducts(lines);

  // ── Text ───────────────────────────────────────────────────────────────
  const textParts: string[] = [];
  textParts.push(humanDate);
  textParts.push(
    `${total} deliver${total === 1 ? "y" : "ies"} — ${orderCount} order${orderCount === 1 ? "" : "s"}, ${subCount} subscription${subCount === 1 ? "" : "s"}`,
  );
  textParts.push("");
  textParts.push("BAKE TOTALS");
  for (const r of rollup) {
    textParts.push(`  ${r.qty} × ${r.name}`);
  }
  textParts.push("");
  for (const g of groups) {
    textParts.push(`— ${slotLabel(g.slot)} (${g.lines.length}) —`);
    for (const l of g.lines) {
      textParts.push(
        `  [${l.kind === "order" ? "ORD" : "SUB"}] ${l.ref} — ${l.customerName} — ${l.customerPhone}`,
      );
      textParts.push(`    ${l.address}`);
      for (const item of l.items) textParts.push(`    · ${item}`);
    }
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

  const groupHtml = groups
    .map((g) => {
      const rows = g.lines
        .map((l) => {
          const badge =
            l.kind === "order"
              ? `<span style="display:inline-block;padding:1px 6px;font-size:11px;background:#024628;color:#FBF3D4;border-radius:3px;letter-spacing:0.4px">ORDER</span>`
              : `<span style="display:inline-block;padding:1px 6px;font-size:11px;background:#436CB4;color:#FBF3D4;border-radius:3px;letter-spacing:0.4px">SUB</span>`;
          const itemLis = l.items
            .map((i) => `<li style="margin:2px 0">${escapeHtml(i)}</li>`)
            .join("");
          return `
            <tr>
              <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">
                ${badge}
                <div style="margin-top:4px;font-weight:600">${escapeHtml(l.ref)}</div>
              </td>
              <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">
                <div><strong>${escapeHtml(l.customerName)}</strong></div>
                <div><a href="tel:${escapeHtml(l.customerPhone)}" style="color:#024628">${escapeHtml(l.customerPhone)}</a></div>
                <div style="color:#666;font-size:12px;margin-top:4px">${escapeHtml(l.address)}</div>
              </td>
              <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">
                <ul style="margin:0;padding-left:16px;font-size:13px">${itemLis}</ul>
              </td>
            </tr>`;
        })
        .join("");
      return `
        <h3 style="margin:24px 0 6px;font-size:15px;color:#024628">
          ${escapeHtml(slotLabel(g.slot))}
          <span style="color:#999;font-weight:400;font-size:13px"> · ${g.lines.length}</span>
        </h3>
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          ${rows}
        </table>`;
    })
    .join("");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:720px">
      <p style="font-size:16px;margin:0 0 4px">
        <strong>${escapeHtml(humanDate)}</strong>
      </p>
      <p style="font-size:14px;color:#666;margin:0 0 20px">
        ${total} deliver${total === 1 ? "y" : "ies"} · ${orderCount} order${orderCount === 1 ? "" : "s"} · ${subCount} subscription${subCount === 1 ? "" : "s"}
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
    </div>`;

  return { subject, html, text };
}
