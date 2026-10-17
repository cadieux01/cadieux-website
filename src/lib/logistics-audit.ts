// Writes to the UNIFIED audit trail: logistics.audit_logs (the same
// table the dashboard and public-schema triggers feed). This is separate
// from recordAuditEvent() in audit-log.ts, which writes the website-only
// public.audit_log.
//
// Reached through supabaseAdmin.schema('logistics'); the service-role key
// bypasses RLS. Writes are best-effort — a failure here is logged but
// never thrown, because the user-visible action has already happened.

import { waitUntil } from "@vercel/functions";

import { supabaseAdmin } from "@/lib/admin-auth";

// action_type values accepted by logistics.audit_logs after the CHECK
// constraint was widened to include BLOCKED and LOCKOUT.
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

/**
 * Queue an audit write from a call site that cannot await it.
 *
 * USE THIS INSTEAD OF `void logLogisticsAudit(...)`. A bare floating promise
 * is killed when Vercel freezes the invocation the instant the response is
 * returned, so the insert never runs — not rejected, not logged, just absent.
 * Measured on /api/verify/check 2026-10-17: ~12% of rows lost, and survivors
 * arriving seconds late and out of order as frozen instances were thawed by
 * later requests. `order-burst-alert.ts:392-394` and
 * `orphaned-payment-alert.ts:148-152` reached the same conclusion earlier.
 *
 * Off-Vercel (local dev, tests) waitUntil is a no-op that does not throw, so
 * the promise simply runs to completion.
 *
 * Never throws and never delays the caller, so it is safe on paths where the
 * user-visible action has already happened.
 */
export function queueLogisticsAudit(input: LogisticsAuditInput): void {
  try {
    const task = logLogisticsAudit(input).catch((e) => {
      // logLogisticsAudit catches internally, so reaching here is unexpected.
      // Still required: an unhandled rejection inside waitUntil can take down
      // the invocation, which WOULD be user-visible.
      console.warn("[logistics-audit] queued write threw:", e);
    });
    waitUntil(task);
  } catch (e) {
    console.warn("[logistics-audit] queue failed:", e);
  }
}
