// The audit log's shared vocabulary: what can be audited, what can happen to
// it, how each reads in English, and the shape of a row once it comes back
// from the API.
//
// WHY THIS IS A SEPARATE FILE. All of it used to live in lib/audit-log.ts,
// which also exports `recordAuditEvent` and therefore imports `supabaseAdmin`
// from lib/admin-auth — a service-role client constructed at module scope from
// SUPABASE_SERVICE_ROLE_KEY. `/admin/audit-log` is a "use client" page and it
// needs the four constants below, so importing them dragged that client into
// the browser bundle, where the key is not NEXT_PUBLIC_-prefixed and so
// resolves to `undefined`. createClient then threw during module
// initialisation, the client tree never mounted, React discarded the
// server-rendered HTML, and the page was blank. It had been blank since the
// feature shipped (9418bac, 2026-05-18).
//
// `import type` alone could not fix it: AUDIT_ENTITIES, AUDIT_ACTIONS and the
// two label maps are real values, so they have to live somewhere a client can
// reach. That is here.
//
// ZERO `@/` IMPORTS, DELIBERATELY — same rule as lib/audit-target.ts and
// lib/export-scope.ts. It keeps the module loadable by `node --test` as well
// as by the browser; an alias added here would resolve under webpack and
// silently fail under node, taking the test suites with it. This file needs no
// imports at all, so the rule costs nothing to keep.

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
  | "service_area"
  | "delivery_request"
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
  "service_area",
  "delivery_request",
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
  service_area: "Service area",
  delivery_request: "Delivery request",
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
  /**
   * The OLF/OLS code for `target_id`, RESOLVED AT READ TIME by
   * GET /api/admin/audit-log — never stored, never written back.
   *
   * `target_label` is a snapshot taken when the event was recorded, and for
   * every row written before the writers were fixed it holds a UUID slice
   * (`#a1b2c3d4`) or a product name instead of the code. Those rows cannot be
   * repaired by a backfill: audit_log is append-only at the database level
   * (see docs/audit-log-relabel-WONTRUN.md), so the code is derived from
   * `target_id` on each read instead.
   *
   * Null means the id resolved to nothing — the order or subscription was
   * deleted — and the caller should fall back to `target_label`, which is
   * then genuinely all that is known about the event.
   */
  target_code?: string | null;
  actor: string | null;
  context: string | null;
  meta: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  occurred_at: string;
};
