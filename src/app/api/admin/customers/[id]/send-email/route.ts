// POST /api/admin/customers/[id]/send-email
//
// Ad-hoc operator email. Gated by x-admin-token (isAdmin) and uses the
// same Resend account as the daily reminders cron — FROM_EMAIL is
// configured through RESEND_FROM_EMAIL with a sensible default.
//
// Body: { subject: string, body: string, template?: string }
//   - subject: 1–200 chars, plain text
//   - body:    1–10000 chars, plain text (rendered inside a minimal
//              HTML wrapper). The wrapper sets text-align, paragraph
//              spacing, and a single brand-coloured rule at the top.
//   - template: optional opaque tag persisted to admin_emails_sent for
//               UX history / future analytics. Not validated.
//
// On success, writes an audit row to admin_emails_sent with the sender
// (x-admin-token-bearer is anonymous, so we store the literal "admin"
// plus the customer_id and Resend message_id) and returns
// { ok: true, message_id }.
//
// GET on this same route returns the last 5 emails for the customer
// (subject, body, sent_at, template) so the detail page can render a
// short history strip.

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || "Cadieux <hello@cadieux.in>";

const SUBJECT_MAX = 200;
const BODY_MAX = 10000;
const HISTORY_LIMIT = 5;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapBody(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 1em;">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  return (
    `<!doctype html><html><body style="font-family:Georgia,serif;color:#111;line-height:1.55;max-width:560px;margin:0 auto;padding:24px;">` +
    `<div style="border-top:3px solid #024628;padding-top:16px;">` +
    paragraphs +
    `<p style="margin:2em 0 0;font-size:0.85em;color:#666;">— The Cadieux team</p>` +
    `</div></body></html>`
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "RESEND_API_KEY is not configured." },
      { status: 500 },
    );
  }

  const customerId = params.id;
  const body = (await req.json().catch(() => null)) as
    | { subject?: unknown; body?: unknown; template?: unknown }
    | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const template =
    typeof body.template === "string" && body.template.trim()
      ? body.template.trim().slice(0, 64)
      : null;

  if (!subject || subject.length > SUBJECT_MAX) {
    return NextResponse.json(
      { error: `Subject is required and must be ≤ ${SUBJECT_MAX} characters.` },
      { status: 400 },
    );
  }
  if (!text || text.length > BODY_MAX) {
    return NextResponse.json(
      { error: `Body is required and must be ≤ ${BODY_MAX} characters.` },
      { status: 400 },
    );
  }

  // Resolve customer email. Without an address we can't send; surface
  // that as a clear 400 instead of a generic provider error.
  const { data: customer, error: cErr } = await supabaseAdmin
    .from("customers")
    .select("id, email, full_name")
    .eq("id", customerId)
    .maybeSingle();
  if (cErr) {
    console.error("[admin/send-email] customer lookup:", cErr.message);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if (!customer) {
    return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  }
  const recipient =
    typeof (customer as { email?: string | null }).email === "string"
      ? (customer as { email: string | null }).email
      : null;
  if (!recipient) {
    return NextResponse.json(
      { error: "Customer has no email address on file." },
      { status: 400 },
    );
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error: sendErr } = await resend.emails.send({
    from: FROM_EMAIL,
    to: recipient,
    subject,
    html: wrapBody(text),
    text,
  });

  if (sendErr) {
    console.error("[admin/send-email] resend error:", sendErr);
    return NextResponse.json(
      { error: sendErr.message ?? "Resend send failed." },
      { status: 502 },
    );
  }

  const messageId = data?.id ?? null;

  // Best-effort audit. Failing to insert the audit row should NOT
  // surface as a send failure — the email already went out.
  const { error: auditErr } = await supabaseAdmin
    .from("admin_emails_sent")
    .insert({
      customer_id: customerId,
      subject,
      body: text,
      template,
      sent_by: "admin",
      message_id: messageId,
    });
  if (auditErr) {
    console.warn("[admin/send-email] audit insert failed:", auditErr.message);
  }

  void recordAuditEvent({
    req,
    entity: "email",
    action: "send_email",
    targetId: customerId,
    targetLabel: (customer as { full_name?: string | null }).full_name || recipient,
    context: `Sent email "${subject}" to ${recipient}`,
    meta: {
      customer_id: customerId,
      recipient,
      subject,
      template,
      message_id: messageId,
    },
  });

  return NextResponse.json({ ok: true, message_id: messageId });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await supabaseAdmin
    .from("admin_emails_sent")
    .select("id, subject, body, template, sent_at, message_id")
    .eq("customer_id", params.id)
    .order("sent_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) {
    // Table may not exist on every environment — degrade to empty list.
    console.warn("[admin/send-email history]", error.message);
    return NextResponse.json({ emails: [] });
  }
  return NextResponse.json({ emails: data ?? [] });
}
