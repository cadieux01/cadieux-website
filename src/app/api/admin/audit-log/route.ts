import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  type AuditAction,
  type AuditEntity,
  type AuditLogRow,
} from "@/lib/audit-log";

// GET /api/admin/audit-log
//   Query params (all optional):
//     from           ISO date-time (inclusive)
//     to             ISO date-time (exclusive)
//     entity         repeatable; restricts to listed entities
//     action         repeatable; restricts to listed actions
//     q              free-text — matches target_label / context / target_id
//     limit          default 100, max 1000
//     offset         default 0
//
//   Response: { rows: AuditLogRow[], total: number }
//
//   The page UI streams paginated rows; CSV export hits the same route
//   with a high `limit` so the operator can download exactly what they
//   see (post-filter).

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

function parseList<T extends string>(
  raw: string[],
  allowed: readonly T[],
): T[] {
  const set = new Set<T>();
  for (const v of raw) {
    for (const part of v.split(",")) {
      const trimmed = part.trim() as T;
      if (trimmed && (allowed as readonly string[]).includes(trimmed)) {
        set.add(trimmed);
      }
    }
  }
  return Array.from(set);
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const entities = parseList<AuditEntity>(
    sp.getAll("entity"),
    AUDIT_ENTITIES,
  );
  const actions = parseList<AuditAction>(sp.getAll("action"), AUDIT_ACTIONS);
  const q = (sp.get("q") ?? "").trim();

  const limitRaw = Number(sp.get("limit"));
  const offsetRaw = Number(sp.get("offset"));
  const limit = Math.min(
    Math.max(Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const offset = Math.max(
    Number.isFinite(offsetRaw) ? Math.trunc(offsetRaw) : 0,
    0,
  );

  let query = supabaseAdmin
    .from("audit_log")
    .select(
      "id, entity, action, target_id, target_label, actor, context, meta, ip_address, user_agent, occurred_at",
      { count: "exact" },
    );

  if (from) query = query.gte("occurred_at", from);
  if (to) query = query.lt("occurred_at", to);
  if (entities.length > 0) query = query.in("entity", entities);
  if (actions.length > 0) query = query.in("action", actions);
  if (q) {
    // ilike across the three primary searchable string columns. PostgREST
    // `or` filter — values are escaped by the driver.
    const term = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    query = query.or(
      `target_label.ilike.${term},context.ilike.${term},target_id.ilike.${term}`,
    );
  }

  const { data, error, count } = await query
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[admin/audit-log GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    rows: (data ?? []) as AuditLogRow[],
    total: count ?? 0,
  });
}
