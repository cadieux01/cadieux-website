import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

// GET /api/admin/audit
//   Reads the UNIFIED cross-panel audit trail from logistics.audit_logs
//   (fed by both the dashboard and the website super-admin via triggers
//   + sensitive-mutation gating). This is distinct from /api/admin/audit-log,
//   which reads the website-only public.audit_log table.
//
//   Query params (all optional):
//     days      integer — restrict to the last N days (by created_at)
//     from,to   ISO date-times — explicit window (overrides `days`)
//     action    action_type filter (CREATE/UPDATE/DELETE/LOGIN/…)
//     category  category filter (order/product/customer/…)
//     source    'website' | 'dashboard'
//     search    free-text across user_name / description / category /
//               entity_type
//     limit     default 1000, hard max 1000 — see MAX_ROWS
//     offset    default 0
//
//   Response: { rows: AuditRow[], total: number }
//
//   `total` is the count of rows MATCHING THE FILTERS before the page
//   bound, so the caller can say "showing 50 of 7,224" and page through
//   the rest. It used to be absent, and that was the bug: see MAX_ROWS.
//
//   logistics is a non-public schema, so we reach it through
//   supabaseAdmin.schema('logistics'). The service-role key bypasses RLS.

// THE CAP IS 1000 BECAUSE POSTGREST'S IS, AND ASKING FOR MORE IS A LIE.
//
// This said 2000, and so did the page's header comment, but hosted Supabase
// sets PostgREST's `max-rows` to 1000: a request for 1500 or 2000 comes back
// with exactly 1000 rows, HTTP 200, no error and no indication that anything
// was dropped. The page then rendered "1000 events" and "Showing 1-50 of
// 1000" over a table that actually had 7,224 matching rows, and its CSV
// wrote the same 1000. A short audit trail looks exactly like a quiet month.
//
// That is the same failure as the orders export writing 250 of 718, which is
// what lib/export-scope.ts was built for. The fix is the same shape: state
// the REAL total and let the caller page, rather than silently handing back
// whatever the first chunk happened to be.
//
// Raising this number would not help — PostgREST would still cap the
// response at 1000 and we would be back to over-promising. Rows beyond the
// first 1000 are reached with `offset`.
const MAX_ROWS = 1000;

const SELECT =
  "id, created_at, source, user_id, user_name, action_type, entity_type, entity_id, category, description, old_values, new_values, metadata";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const daysRaw = Number(sp.get("days"));
  const from = sp.get("from");
  const to = sp.get("to");
  const action = (sp.get("action") ?? "").trim();
  const category = (sp.get("category") ?? "").trim();
  const source = (sp.get("source") ?? "").trim();
  const search = (sp.get("search") ?? "").trim();
  const limitRaw = Number(sp.get("limit"));
  const limit = Math.min(
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.trunc(limitRaw) : MAX_ROWS,
    MAX_ROWS,
  );
  const offsetRaw = Number(sp.get("offset"));
  const offset = Math.max(
    Number.isFinite(offsetRaw) ? Math.trunc(offsetRaw) : 0,
    0,
  );

  // `count: "exact"` is what makes the truncation visible. It is counted
  // AFTER the filters below and before the range, so it answers "how many
  // rows does this query have", not "how many are in the table".
  let query = supabaseAdmin
    .schema("logistics")
    .from("audit_logs")
    .select(SELECT, { count: "exact" })
    .order("created_at", { ascending: false });

  // Explicit window wins over `days`.
  if (from || to) {
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lt("created_at", to);
  } else if (Number.isFinite(daysRaw) && daysRaw > 0) {
    const since = new Date(Date.now() - daysRaw * 24 * 60 * 60 * 1000);
    query = query.gte("created_at", since.toISOString());
  }

  if (action) query = query.eq("action_type", action);
  if (category) query = query.eq("category", category);
  if (source) query = query.eq("source", source);
  if (search) {
    const term = `%${search.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    query = query.or(
      `user_name.ilike.${term},description.ilike.${term},category.ilike.${term},entity_type.ilike.${term}`,
    );
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);

  if (error) {
    console.error("[admin/audit GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: data ?? [], total: count ?? 0 });
}
