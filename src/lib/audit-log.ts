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
//
// SERVER ONLY, ENFORCED. This module reaches `supabaseAdmin`, a service-role
// client built at module scope from SUPABASE_SERVICE_ROLE_KEY. The vocabulary
// it used to export — the entity/action lists, the label maps and AuditLogRow
// — now lives in lib/audit-log-schema.ts, because the "use client"
// /admin/audit-log page needs those constants, and importing them from here
// pulled the service client into the browser bundle. There the key is not
// NEXT_PUBLIC_-prefixed, so it resolves to undefined, createClient throws
// during module init, and the page renders blank. The `server-only` import
// below turns a repeat of that into a BUILD failure instead of a silent blank
// page at runtime.
//
// The vocabulary is re-exported unchanged, so the ~54 server-side callers that
// import AuditAction/AuditEntity from here keep working untouched. Any new
// client-side consumer must import from lib/audit-log-schema directly;
// reaching for this module will fail the build, which is the point.

import "server-only";

import type { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";

import { supabaseAdmin } from "@/lib/admin-auth";
import type { AuditAction, AuditEntity } from "@/lib/audit-log-schema";

export type {
  AuditEntity,
  AuditAction,
  AuditLogRow,
} from "@/lib/audit-log-schema";
export {
  AUDIT_ENTITIES,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_LABEL,
  AUDIT_ACTION_LABEL,
} from "@/lib/audit-log-schema";

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
// thrown.
//
// CALL THIS ONLY WHERE YOU CAN AWAIT IT. Awaiting is the strongest form:
// the row is on disk before the function returns. Everywhere else use
// queueAuditEvent below — floating the promise loses the write, which is
// why no route handler calls this directly any more.
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

/**
 * Queue an audit write from a call site that cannot await it.
 *
 * USE THIS INSTEAD OF FLOATING THE PROMISE. A bare `void recordAuditEvent(…)`
 * is killed when Vercel freezes the invocation the instant the response is
 * returned, so the insert never runs — not rejected, not logged, just absent.
 * The loss was measured on the other trail (see queueLogisticsAudit in
 * logistics-audit.ts); nothing about the mechanism is schema-specific.
 *
 * Every route handler on this trail now goes through here — the sweep that
 * converted them is done, so a floating `recordAuditEvent` in a handler is a
 * regression, not a leftover. The one remaining direct caller awaits it
 * (preorder-notify.ts), which is stronger than queueing, not weaker.
 *
 * Off-Vercel (local dev, tests) waitUntil is a no-op that does not throw, so
 * the promise simply runs to completion.
 *
 * Never throws and never delays the caller, so it is safe on paths where the
 * user-visible action has already happened.
 *
 * A DELIBERATE MIRROR of queueLogisticsAudit: two audit trails, one queueing
 * discipline. If you change one, change the other — a difference between them
 * would be read as intentional by the next person, and it would not be.
 */
export function queueAuditEvent(input: RecordAuditEventInput): void {
  try {
    const task = recordAuditEvent(input).catch((e) => {
      // recordAuditEvent catches internally, so reaching here is unexpected.
      // Still required: an unhandled rejection inside waitUntil can take down
      // the invocation, which WOULD be user-visible.
      console.warn("[audit-log] queued write threw:", e);
    });
    waitUntil(task);
  } catch (e) {
    console.warn("[audit-log] queue failed:", e);
  }
}
