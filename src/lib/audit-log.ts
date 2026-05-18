// Site-wide admin audit trail. Every mutating admin route calls
// `recordAuditEvent(...)` after the underlying write succeeds. Writes
// are best-effort — a failure here MUST NEVER bubble up to the caller
// because the user-visible action has already happened.
//
// Rows go into `audit_log` (service-role insert only; RLS denies anon).
// The `/admin/audit-log` page reads through `/api/admin/audit-log`
// with the same isAdmin gate as every other admin route.
//
// `actor` is intentionally left null for now: the admin panel uses a
// single shared password, so we have no per-user identity to attribute.

import type { NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/admin-auth";

export type AuditEntity =
  | "product"
  | "product_report"
  | "order"
  | "customer"
  | "subscription"
  | "subscription_delivery"
  | "review"
  | "email"
  | "address"
  | "change_request"
  | "feedback"
  | "other";

export type AuditAction =
  | "create"
  | "update"
  | "archive"
  | "unarchive"
  | "delete"
  | "send_email"
  | "status_change"
  | "price_change"
  | "cancel"
  | "refund"
  | "pause"
  | "resume"
  | "other";

export const AUDIT_ENTITIES: AuditEntity[] = [
  "product",
  "product_report",
  "order",
  "customer",
  "subscription",
  "subscription_delivery",
  "review",
  "email",
  "address",
  "change_request",
  "feedback",
  "other",
];

export const AUDIT_ACTIONS: AuditAction[] = [
  "create",
  "update",
  "archive",
  "unarchive",
  "delete",
  "send_email",
  "status_change",
  "price_change",
  "cancel",
  "refund",
  "pause",
  "resume",
  "other",
];

export const AUDIT_ENTITY_LABEL: Record<AuditEntity, string> = {
  product: "Product",
  product_report: "Lab report",
  order: "Order",
  customer: "Customer",
  subscription: "Subscription",
  subscription_delivery: "Delivery",
  review: "Review",
  email: "Email",
  address: "Address",
  change_request: "Change request",
  feedback: "Feedback",
  other: "Other",
};

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  create: "Created",
  update: "Updated",
  archive: "Archived",
  unarchive: "Unarchived",
  delete: "Deleted",
  send_email: "Email sent",
  status_change: "Status changed",
  price_change: "Price changed",
  cancel: "Cancelled",
  refund: "Refunded",
  pause: "Paused",
  resume: "Resumed",
  other: "Other",
};

export type AuditLogRow = {
  id: string;
  entity: AuditEntity;
  action: AuditAction;
  target_id: string | null;
  target_label: string | null;
  actor: string | null;
  context: string | null;
  meta: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  occurred_at: string;
};

// Pulls the client IP from the standard proxy headers. Vercel and
// most edges put the real IP first in `x-forwarded-for`. Falls back
// to `x-real-ip` and finally null.
function ipFromRequest(req: NextRequest | undefined): string | null {
  if (!req) return null;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  return real?.trim() || null;
}

function userAgentFromRequest(req: NextRequest | undefined): string | null {
  if (!req) return null;
  return req.headers.get("user-agent") || null;
}

export type RecordAuditEventInput = {
  req?: NextRequest;
  entity: AuditEntity;
  action: AuditAction;
  targetId?: string | null;
  targetLabel?: string | null;
  context?: string | null;
  meta?: Record<string, unknown> | null;
};

// Insert one audit row. Wrapped in try/catch so an audit failure
// (network blip, schema drift, RLS misconfig) is logged but never
// thrown — callers use `void recordAuditEvent(...)` so they don't
// even need to await it.
export async function recordAuditEvent(
  input: RecordAuditEventInput,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("audit_log").insert({
      entity: input.entity,
      action: input.action,
      target_id: input.targetId ?? null,
      target_label: input.targetLabel ?? null,
      actor: null,
      context: input.context ?? null,
      meta: input.meta ?? null,
      ip_address: ipFromRequest(input.req),
      user_agent: userAgentFromRequest(input.req),
    });
    if (error) {
      console.warn("[audit-log] insert failed:", error.message);
    }
  } catch (err) {
    console.warn("[audit-log] unexpected failure:", err);
  }
}
