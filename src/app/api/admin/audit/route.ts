import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

// GET /api/admin/audit
//   Reads the UNIFIED cross-panel audit trail from logistics.audit_logs
//   (fed by both the dashboard and the website super-admin via triggers).
//   This is distinct from /api/admin/audit-log,
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
//     limit     default 2000, hard max 2000
//
//   Response: { rows: AuditRow[] }
//
//   logistics is a non-public schema, so we reach it through
//   supabaseAdmin.schema('logistics'). The service-role key bypasses RLS.

const MAX_ROWS = 2000;

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

  let query = supabaseAdmin
    .schema("logistics")
    .from("audit_logs")
    .select(SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);

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

  const { data, error } = await query;

  if (error) {
    console.error("[admin/audit GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: data ?? [] });
}
