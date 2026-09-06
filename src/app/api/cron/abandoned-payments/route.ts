// GET /api/cron/abandoned-payments
//
// Vercel Cron entry point. Runs daily at 03:45 UTC (09:15 IST). See vercel.json.
//
// Auth: Bearer ${CRON_SECRET}, same as the subscription-reminders cron.
//
// Why this exists: /api/create-order writes a permanent orders row with
// payment_status='created' BEFORE the Razorpay sheet is even opened. If the
// customer never pays, that row just sits there. Nothing surfaces it — no
// email, no admin badge, no cleanup job. Nine such rows accumulated over four
// days before anyone noticed, and two of them were real customers who walked
// away. This puts them in front of the owner the next morning.
//
// What counts as abandoned:
//   payment_status = 'created', created more than 30 minutes ago (long past any
//   plausible in-progress payment) and within the last 24 hours.
//
// What is filtered out: a customer who abandoned one attempt and then placed a
// real order within 10 minutes. Those are the retry/ghost rows — the customer
// was never lost, so they are noise. Over the four days that prompted this,
// the filter reduced nine rows to the two that actually mattered.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || "Cadieux <hello@cadieux.in>";
// Deliberately NOT reusing HANDOFF_ALERT_EMAIL — that one belongs to the
// WhatsApp handoff subsystem and repointing it would silently move those
// alerts too. Two recipients on purpose: ceo@ is the address that actually
// gets read, admin@ is the one we can independently confirm delivery on. If
// one of them ever stops resolving, the other still lands.
const ALERT_EMAILS = (
  process.env.ABANDONED_ALERT_EMAIL || "ceo@cadieux.in,admin@cadieux.in"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MINUTE_MS = 60 * 1000;
/** How long a payment may legitimately be in progress before we call it dead. */
const STALE_AFTER_MS = 30 * MINUTE_MS;
/** Look-back window for the digest. */
const WINDOW_MS = 24 * 60 * MINUTE_MS;
/** A later successful order this close behind means the customer recovered. */
const RECOVERY_WINDOW_MS = 10 * MINUTE_MS;

/** Render a timestamp as "9:14 pm" in IST. */
function istTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Render a timestamp as "Sat, 6 Sep" in IST. */
function istDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface OrderRow {
  id: string;
  order_number: string | null;
  customer_id: string | null;
  total_amount: number | null;
  payment_status: string | null;
  payment_method: string | null;
  fulfillment_type: string | null;
  created_at: string;
  customers: { full_name: string | null; phone: string | null } | null;
}

/** A row that represents money that actually arrived (or was promised on COD). */
function isSuccessful(o: OrderRow): boolean {
  return o.payment_status === "paid" || o.payment_method === "cod";
}

export async function GET(req: NextRequest) {
  // A missing CRON_SECRET and a wrong Authorization header are two completely
  // different problems and must not look the same. Collapsing both into 401
  // means a cron that has been silently dead since the day it shipped is
  // indistinguishable from someone probing the endpoint — you would see the
  // same line in the logs either way and assume it was the probe.
  //   500 = our configuration is broken, nobody is getting this digest.
  //   401 = config is fine, that caller just isn't authorised.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      "[cron/abandoned-payments] CRON_SECRET is not set — this cron cannot run.",
    );
    return NextResponse.json(
      { error: "cron secret not configured" },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "RESEND_API_KEY not configured" },
      { status: 500 },
    );
  }

  const now = Date.now();
  const windowStart = new Date(now - WINDOW_MS).toISOString();

  // Pull every order in the window in one query — we need the successful ones
  // too, to decide which abandonments were recovered.
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, customer_id, total_amount, payment_status, payment_method, fulfillment_type, created_at, customers(full_name, phone)",
    )
    .gte("created_at", windowStart)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data || []) as unknown as OrderRow[];

  const abandoned = rows.filter(
    (o) =>
      o.payment_status === "created" &&
      now - new Date(o.created_at).getTime() > STALE_AFTER_MS,
  );

  // Drop the ones where the same customer completed an order right afterwards.
  const lost = abandoned.filter((o) => {
    if (!o.customer_id) return true;
    const at = new Date(o.created_at).getTime();
    return !rows.some(
      (other) =>
        other.customer_id === o.customer_id &&
        other.id !== o.id &&
        isSuccessful(other) &&
        new Date(other.created_at).getTime() - at > 0 &&
        new Date(other.created_at).getTime() - at <= RECOVERY_WINDOW_MS,
    );
  });

  if (lost.length === 0) {
    return NextResponse.json({
      abandoned: abandoned.length,
      lost: 0,
      sent: false,
    });
  }

  const lines = lost.map((o) => {
    const name = (o.customers?.full_name || "Unknown").trim();
    const phone = o.customers?.phone || "no phone on file";
    const amount =
      typeof o.total_amount === "number" ? `₹${o.total_amount}` : "—";
    const kind = o.fulfillment_type === "pickup" ? "Pickup" : "Delivery";
    const ref = o.order_number || o.id.slice(0, 8).toUpperCase();
    return {
      ref,
      name,
      phone,
      amount,
      kind,
      when: `${istDate(o.created_at)}, ${istTime(o.created_at)}`,
    };
  });

  const subject = `${lost.length} started paying and didn't finish`;

  const text = [
    `${lost.length} ${lost.length === 1 ? "person" : "people"} opened the payment screen in the last 24 hours and never completed it.`,
    "",
    ...lines.map(
      (l) =>
        `${l.name} — ${l.phone}\n  ${l.amount} · ${l.kind} · ${l.when} · ${l.ref}`,
    ),
    "",
    "These are worth a call. They picked a product, entered an address and reached payment.",
  ].join("\n");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:560px">
      <p style="font-size:16px;margin:0 0 16px">
        <strong>${lost.length}</strong> ${lost.length === 1 ? "person" : "people"}
        opened the payment screen in the last 24 hours and never completed it.
      </p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <tr style="text-align:left;color:#666">
          <th style="padding:6px 8px;border-bottom:1px solid #ddd">Customer</th>
          <th style="padding:6px 8px;border-bottom:1px solid #ddd">Amount</th>
          <th style="padding:6px 8px;border-bottom:1px solid #ddd">Type</th>
          <th style="padding:6px 8px;border-bottom:1px solid #ddd">When</th>
        </tr>
        ${lines
          .map(
            (l) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee">
            <strong>${escapeHtml(l.name)}</strong><br>
            <a href="tel:${escapeHtml(l.phone)}" style="color:#024628">${escapeHtml(l.phone)}</a><br>
            <span style="color:#999;font-size:12px">${escapeHtml(l.ref)}</span>
          </td>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(l.amount)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(l.kind)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(l.when)}</td>
        </tr>`,
          )
          .join("")}
      </table>
      <p style="font-size:14px;color:#666;margin:16px 0 0">
        These are worth a call. They picked a product, entered an address and
        reached payment.
      </p>
    </div>`;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error: sendErr } = await resend.emails.send({
    from: FROM_EMAIL,
    to: ALERT_EMAILS,
    subject,
    html,
    text,
  });

  if (sendErr) {
    console.error("[cron/abandoned-payments] send failed:", sendErr.message);
    return NextResponse.json(
      { abandoned: abandoned.length, lost: lost.length, sent: false, error: sendErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    abandoned: abandoned.length,
    lost: lost.length,
    sent: true,
  });
}
