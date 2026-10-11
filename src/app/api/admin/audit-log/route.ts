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
//     q              free-text — substring across target_label / context /
//                    target_id. An OLF/OLS code instead resolves to its id
//                    and matches on word boundaries only, so OLF73 never
//                    drags in OLF730 (see below)
//     limit          default 100, max 1000
//     offset         default 0
//
//   Response: { rows: AuditLogRow[], total: number }
//
//   The page UI streams paginated rows; CSV export hits the same route
//   with a high `limit` so the operator can download exactly what they
//   see (post-filter).
//
// READ-TIME CODE RESOLUTION. Every row gets a `target_code` — the OLF/OLS
// code for its `target_id` — looked up here rather than read from the
// stored `target_label`. It is done in this route and not in the page
// because the page's CSV export calls the same endpoint, so the download
// gets the codes with no second implementation.
//
// WHY NOT FIX THE STORED LABELS INSTEAD. Because it is impossible:
// `audit_log` is append-only at the database level (triggers
// audit_log_no_update / audit_log_no_delete, from
// sql/audit-log-tamper-protection.sql), so every UPDATE raises P0001 and
// changes nothing. The only way to run a backfill is to disable tamper
// protection, which is refused. The full account is in
// docs/audit-log-relabel-WONTRUN.md. Resolving on read costs two queries
// a page, keeps the guard intact, and is correct for rows written before
// AND after the writers were fixed.

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

/** `target_id` is TEXT and also holds '#a1b2c3d4' slices and NULLs, so any
 *  id is checked for UUID shape before it goes anywhere near a lookup. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An order or subscription code as the operator types it: OLF346, OLS94. */
const CODE_RE = /^OL[FS]\d+$/i;

/** Ids per `.in()` request. The filter goes out as a GET querystring and a
 *  UUID is ~37 bytes of it, so a full 1000-row export would build a ~37 kB
 *  URL and be rejected by the gateway. Chunking keeps every request small;
 *  the cost is still per PAGE, never per row. */
const ID_CHUNK = 200;

type CodeTable = {
  table: "orders" | "subscriptions";
  codeColumn: "order_number" | "subscription_number";
};

const ORDERS: CodeTable = { table: "orders", codeColumn: "order_number" };
const SUBS: CodeTable = {
  table: "subscriptions",
  codeColumn: "subscription_number",
};

/**
 * id → code for the given ids, in chunked batched lookups.
 *
 * A lookup failure is logged and swallowed: the code is a display nicety,
 * and an unresolved id falls back to the stored label, which is what the
 * page showed before this existed. An audit page that 500s because a join
 * table hiccuped is worse than one showing a UUID slice.
 */
async function lookupCodes(
  { table, codeColumn }: CodeTable,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(`id, ${codeColumn}`)
      .in("id", chunk);
    if (error) {
      console.warn(`[admin/audit-log] ${table} code lookup:`, error.message);
      continue;
    }
    for (const row of data ?? []) {
      const id = (row as Record<string, unknown>).id;
      const code = (row as Record<string, unknown>)[codeColumn];
      if (typeof id === "string" && typeof code === "string" && code) {
        out.set(id, code);
      }
    }
  }
  return out;
}

/**
 * Attach `target_code` to every row. Two queries per page: the ids are
 * de-duplicated first, so a page of 100 events touching 12 orders issues
 * one 12-id lookup, not 100.
 */
async function withTargetCodes(rows: AuditLogRow[]): Promise<AuditLogRow[]> {
  const orderIds = new Set<string>();
  const subIds = new Set<string>();
  for (const r of rows) {
    const id = r.target_id;
    if (!id || !UUID_RE.test(id)) continue;
    if (r.entity === "order") orderIds.add(id);
    else if (r.entity === "subscription") subIds.add(id);
  }
  if (orderIds.size === 0 && subIds.size === 0) return rows;

  const [orderCodes, subCodes] = await Promise.all([
    orderIds.size ? lookupCodes(ORDERS, Array.from(orderIds)) : new Map(),
    subIds.size ? lookupCodes(SUBS, Array.from(subIds)) : new Map(),
  ]);

  return rows.map((r) => {
    const id = r.target_id;
    if (!id) return r;
    const code =
      r.entity === "order"
        ? orderCodes.get(id)
        : r.entity === "subscription"
        ? subCodes.get(id)
        : undefined;
    return { ...r, target_code: code ?? null };
  });
}

/**
 * An OLF/OLS code → the id audit rows point at, or null.
 *
 * EXACT EQUALITY, NEVER A SUBSTRING. Order codes are sequential, so an
 * `ilike '%OLF73%'` would also match OLF730 and OLF731 — the same trap that
 * forced adminQueryRelevance on the orders board. There is exactly one order
 * called OLF73.
 */
async function idForCode(code: string): Promise<string | null> {
  const { table, codeColumn } = /^OLS/i.test(code) ? SUBS : ORDERS;
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("id")
    .eq(codeColumn, code.toUpperCase())
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[admin/audit-log] ${table} code search:`, error.message);
    return null;
  }
  const id = (data as Record<string, unknown> | null)?.id;
  return typeof id === "string" ? id : null;
}

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
    // PostgREST `or` filter; values are escaped by the driver.
    const clauses: string[] = [];

    if (CODE_RE.test(q)) {
      // A CODE QUERY FOUND NOTHING BEFORE THIS. `target_id` holds a UUID and
      // `target_label` on every pre-fix row holds a UUID slice, so searching
      // 'OLF346' matched only whatever `context` prose happened to mention
      // it. So the code is resolved to an id and matched exactly on the
      // column that actually holds it.
      //
      // ...AND AN ilike WOULD THEN OVER-MATCH, because order codes are
      // sequential. The writers now store the code in `target_label`
      // ('OLF731', 'OLS94 delivery 2026-10-10') and name it in `context`
      // ('Subscription OLS94 → status_change'), so a plain '%OLF73%' pulled
      // in OLF730 and OLF731 — measured on prod: three orders for a code
      // that belongs to exactly one. Same trap as the orders board's
      // adminQueryRelevance. `\y` is Postgres' word boundary, so 'OLF73'
      // cannot match its own successors while still finding the code
      // mid-sentence in `context`.
      //
      // Interpolating the code into the pattern is safe: CODE_RE admits
      // only OL[FS] plus digits, so there is no metacharacter, quote or
      // comma to break the regex or the `or` list.
      // DOUBLED BACKSLASH, DELIBERATELY. PostgREST processes `\` escapes
      // inside a quoted filter value, so a single `\y` arrives at Postgres
      // as a bare `y` and the pattern matches NOTHING — silently, with a
      // 200 and a short result, which is how it first slipped through here
      // (a search for OLS94 lost its delivery rows). Quoting is itself
      // required: the pattern holds no comma, but an unquoted value would
      // leave the escapes at the mercy of the `or` list parser.
      const bounded = `"\\\\y${q.toUpperCase()}\\\\y"`;
      clauses.push(
        `target_label.imatch.${bounded}`,
        `context.imatch.${bounded}`,
      );

      // `target_id.ilike` is dropped for this input on purpose: a code is
      // never a substring of a UUID, so for a code query that clause can
      // only ever contribute false negatives.
      const id = await idForCode(q);
      if (id) clauses.push(`target_id.eq.${id}`);
    } else {
      // Free text: substring across the searchable columns, `target_id`
      // included for the case it genuinely serves — an operator pasting a
      // UUID, or a fragment of one.
      const term = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
      clauses.push(
        `target_label.ilike.${term}`,
        `context.ilike.${term}`,
        `target_id.ilike.${term}`,
      );
    }

    query = query.or(clauses.join(","));
  }

  const { data, error, count } = await query
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[admin/audit-log GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    rows: await withTargetCodes((data ?? []) as AuditLogRow[]),
    total: count ?? 0,
  });
}
