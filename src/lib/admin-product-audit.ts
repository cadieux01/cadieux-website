// Helpers for the product editor. Two concerns:
//   1) Slugify a free-form product name into a URL-safe slug.
//   2) Compare two product rows field-by-field and produce the audit
//      insert payloads. Centralised so create / patch / archive routes
//      all agree on the diff shape.

import { supabaseAdmin } from "@/lib/admin-auth";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

// Fields the editor exposes. Anything outside this list isn't audited
// (e.g. updated_at, archived_at — those are derived from explicit
// archive/unarchive events and the touch_updated_at trigger).
export const AUDITED_FIELDS = [
  "slug",
  "name",
  "price_inr",
  "subscription_per_loaf_inr",
  "weight",
  "description",
  "tagline",
  "highlights",
  "image_url",
  "is_active",
  "in_stock",
  "is_archived",
  "sort_order",
  // Subscription plan catalogue (consumed by /api/subscription-plans).
  // `is_subscription_plan` flips the product into / out of the wizard's
  // visible plan list; title/blurb are the wizard-only display strings.
  "is_subscription_plan",
  "subscription_title",
  "subscription_blurb",
] as const;

export type AuditedField = (typeof AUDITED_FIELDS)[number];

export type AuditEntry = {
  product_id: string;
  product_slug: string;
  field_changed: string;
  old_value: unknown;
  new_value: unknown;
  changed_by: string | null;
  context: string;
};

// Stable JSON comparison so we don't log no-op array reorders. The
// `highlights` column is a text[] — equality is order-sensitive in JS
// but the admin form only ever sends a freshly-derived list, so doing
// a strict JSON compare is acceptable and avoids surprise "field
// changed but nothing happened" rows.
function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function buildAuditEntries(
  product_id: string,
  product_slug: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  changed_by: string | null,
  context: string,
): AuditEntry[] {
  const entries: AuditEntry[] = [];
  for (const f of AUDITED_FIELDS) {
    if (!(f in after)) continue;
    if (eq(before[f], after[f])) continue;
    entries.push({
      product_id,
      product_slug,
      field_changed: f,
      old_value: before[f] ?? null,
      new_value: after[f] ?? null,
      changed_by,
      context,
    });
  }
  return entries;
}

export async function writeAuditEntries(entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const { error } = await supabaseAdmin
    .from("product_changes")
    .insert(entries);
  if (error) {
    // Audit failure must not break the user-facing PATCH — log loudly
    // and move on. The operator still saw their save succeed.
    console.error("[admin/product-audit] insert failed:", error.message);
  }
}
