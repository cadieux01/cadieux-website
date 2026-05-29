// Writes to the UNIFIED audit trail: logistics.audit_logs (the same
// table the dashboard and public-schema triggers feed). This is separate
// from recordAuditEvent() in audit-log.ts, which writes the website-only
// public.audit_log.
//
// Reached through supabaseAdmin.schema('logistics'); the service-role key
// bypasses RLS. Writes are best-effort — a failure here is logged but
// never thrown, because the user-visible action has already happened.

import { supabaseAdmin } from "@/lib/admin-auth";

// action_type values accepted by logistics.audit_logs after
// security/product-lock-audit.sql widens the CHECK.
export type LogisticsAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "LOGIN"
  | "FEEDBACK_REPLY"
  | "BLOCKED"
  | "LOCKOUT";

export type LogisticsAuditInput = {
  actionType: LogisticsAction;
  entityType: string;
  /** Must be a uuid (or omitted). Non-uuid keys should be left null. */
  entityId?: string | null;
  category?: string | null;
  description: string;
  userName?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  metadata?: Record<string, unknown> | null;
  source?: string;
};

export async function logLogisticsAudit(
  input: LogisticsAuditInput,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .schema("logistics")
      .from("audit_logs")
      .insert({
        user_id: null,
        user_name: input.userName ?? "Super Admin (website)",
        action_type: input.actionType,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        category: input.category ?? null,
        description: input.description,
        old_values: input.oldValues ?? null,
        new_values: input.newValues ?? null,
        metadata: input.metadata ?? null,
        source: input.source ?? "website",
      });
    if (error) {
      console.warn("[logistics-audit] insert failed:", error.message);
    }
  } catch (err) {
    console.warn("[logistics-audit] unexpected failure:", err);
  }
}
