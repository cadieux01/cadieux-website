import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { hasValidPinGrant } from "@/lib/pin-grant";
import { CONTENT_CACHE_TAG } from "@/lib/content";

// Consolidated admin endpoint for the Phase-C content tables.
//   GET  /api/admin/content?table=<t>&product_id=<id>&locale=<code>
//          → list rows; admin + isAdmin gate only.
//   POST /api/admin/content  { table, action, ... }
//          → create | update | upsert | delete | reorder; PIN gate required.
//
// On every mutation we:
//   1. write the row through the service-role client (bypasses RLS),
//   2. revalidateTag('content') so the public reader (getPageContent)
//      drops its cache,
//   3. fire recordAuditEvent — best-effort, never throws.
//
// The DB has AFTER INS/UPD/DEL triggers feeding `content_audit`, so the
// row-level history is captured server-side regardless.

type Table =
  | "content_strings"
  | "product_stat_tiles"
  | "product_app_test_reports"
  | "behind_milestones"
  | "behind_stats"
  | "process_steps";

const TABLE_SET: ReadonlySet<Table> = new Set<Table>([
  "content_strings",
  "product_stat_tiles",
  "product_app_test_reports",
  "behind_milestones",
  "behind_stats",
  "process_steps",
]);

const PRODUCT_SCOPED: ReadonlySet<Table> = new Set<Table>([
  "product_stat_tiles",
  "product_app_test_reports",
]);

function isTable(v: unknown): v is Table {
  return typeof v === "string" && TABLE_SET.has(v as Table);
}

function bust(): void {
  revalidateTag(CONTENT_CACHE_TAG);
}

function s(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function trimStr(v: unknown): string | undefined {
  const x = s(v);
  return x == null ? undefined : x.trim();
}
function b(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}
function n(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

// ───────────────────────── GET (list) ─────────────────────────
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const table = url.searchParams.get("table");
  const productId = url.searchParams.get("product_id");
  const locale = url.searchParams.get("locale") ?? "en";
  if (!isTable(table)) {
    return NextResponse.json({ error: "Unknown table" }, { status: 400 });
  }

  // Select * so the editor can see every field, including audit columns.
  let q = supabaseAdmin.from(table).select("*").eq("locale", locale);
  if (PRODUCT_SCOPED.has(table)) {
    if (!productId) {
      return NextResponse.json(
        { error: "product_id is required for this table" },
        { status: 400 },
      );
    }
    q = q.eq("product_id", productId);
  }
  if (table === "content_strings" && productId !== null) {
    // For content_strings, allow filter to a specific product OR globals (null product_id).
    // The admin UI passes product_id=... to see per-product strings, or omits it for globals only.
    if (productId === "__global__") q = q.is("product_id", null);
    else q = q.eq("product_id", productId);
  }

  // Order: sort_order asc when present, else by natural-key column.
  const orderCol = ((): string => {
    switch (table) {
      case "content_strings":
        return "key";
      default:
        return "sort_order";
    }
  })();
  q = q.order(orderCol, { ascending: true });

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [] });
}

// ───────────────────────── POST (mutate) ─────────────────────────
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasValidPinGrant(req)) {
    return NextResponse.json(
      { error: "PIN verification required.", code: "pin_required" },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const table = body.table;
  const action = body.action;
  if (!isTable(table)) {
    return NextResponse.json({ error: "Unknown table" }, { status: 400 });
  }
  if (typeof action !== "string") {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  try {
    switch (action) {
      case "create":
        return await handleCreate(req, table, body);
      case "update":
        return await handleUpdate(req, table, body);
      case "upsert":
        return await handleUpsert(req, table, body);
      case "delete":
        return await handleDelete(req, table, body);
      case "reorder":
        return await handleReorder(req, table, body);
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    console.error(`[admin/content ${table}.${action}]`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Pull the editable subset of a payload into a row shape per table.
// Returns ONLY fields the client sent (so PATCH-style updates leave the
// rest alone). Validates that required fields aren't blank strings.
function shapeRow(
  table: Table,
  patch: Record<string, unknown>,
  forCreate: boolean,
): { row: Record<string, unknown>; error?: string } {
  const row: Record<string, unknown> = {};
  const value = trimStr(patch.value);
  const label = trimStr(patch.label);
  const sortOrder = n(patch.sort_order);
  const isVisible = b(patch.is_visible);
  const locale = trimStr(patch.locale);
  const productId = s(patch.product_id);

  if (locale !== undefined) row.locale = locale;
  if (sortOrder !== undefined) row.sort_order = sortOrder;
  if (isVisible !== undefined) row.is_visible = isVisible;

  switch (table) {
    case "content_strings": {
      const key = trimStr(patch.key);
      if (forCreate) {
        if (!key) return { row, error: "key is required" };
        row.key = key;
        row.locale = locale ?? "en";
        row.product_id = productId ?? null;
      } else if (key !== undefined) {
        row.key = key;
      }
      if (patch.value !== undefined) row.value = trimStr(patch.value) ?? null;
      const pageSlug = patch.page_slug;
      if (pageSlug !== undefined) row.page_slug = pageSlug == null ? null : trimStr(pageSlug) ?? null;
      const note = patch.note;
      if (note !== undefined) row.note = note == null ? null : trimStr(note) ?? null;
      return { row };
    }
    case "product_stat_tiles": {
      const tileKey = trimStr(patch.tile_key);
      if (forCreate) {
        if (!productId) return { row, error: "product_id is required" };
        if (!tileKey) return { row, error: "tile_key is required" };
        if (!value) return { row, error: "value is required" };
        if (!label) return { row, error: "label is required" };
        row.product_id = productId;
        row.tile_key = tileKey;
        row.locale = locale ?? "en";
        row.value = value;
        row.label = label;
        row.sort_order = sortOrder ?? 0;
      } else {
        if (tileKey !== undefined) row.tile_key = tileKey;
        if (value !== undefined) row.value = value;
        if (label !== undefined) row.label = label;
      }
      return { row };
    }
    case "product_app_test_reports": {
      const reportKey = trimStr(patch.report_key);
      const metric = trimStr(patch.metric);
      if (forCreate) {
        if (!productId) return { row, error: "product_id is required" };
        if (!reportKey) return { row, error: "report_key is required" };
        if (!metric) return { row, error: "metric is required" };
        if (!value) return { row, error: "value is required" };
        row.product_id = productId;
        row.report_key = reportKey;
        row.locale = locale ?? "en";
        row.metric = metric;
        row.value = value;
        row.sort_order = sortOrder ?? 0;
      } else {
        if (reportKey !== undefined) row.report_key = reportKey;
        if (metric !== undefined) row.metric = metric;
        if (value !== undefined) row.value = value;
      }
      if (patch.note !== undefined) row.note = patch.note == null ? null : trimStr(patch.note) ?? null;
      return { row };
    }
    case "behind_milestones": {
      const milestoneKey = trimStr(patch.milestone_key);
      const marker = trimStr(patch.marker);
      if (forCreate) {
        if (!milestoneKey) return { row, error: "milestone_key is required" };
        if (!marker) return { row, error: "marker is required" };
        if (!label) return { row, error: "label is required" };
        row.milestone_key = milestoneKey;
        row.locale = locale ?? "en";
        row.marker = marker;
        row.label = label;
        row.sort_order = sortOrder ?? 0;
      } else {
        if (milestoneKey !== undefined) row.milestone_key = milestoneKey;
        if (marker !== undefined) row.marker = marker;
        if (label !== undefined) row.label = label;
      }
      return { row };
    }
    case "behind_stats": {
      const statKey = trimStr(patch.stat_key);
      if (forCreate) {
        if (!statKey) return { row, error: "stat_key is required" };
        if (!value) return { row, error: "value is required" };
        if (!label) return { row, error: "label is required" };
        row.stat_key = statKey;
        row.locale = locale ?? "en";
        row.value = value;
        row.label = label;
        row.sort_order = sortOrder ?? 0;
      } else {
        if (statKey !== undefined) row.stat_key = statKey;
        if (value !== undefined) row.value = value;
        if (label !== undefined) row.label = label;
      }
      return { row };
    }
    case "process_steps": {
      const stepKey = trimStr(patch.step_key);
      const stepNum = trimStr(patch.step_num);
      const title = trimStr(patch.title);
      const bodyTxt = trimStr(patch.body);
      if (forCreate) {
        if (!stepKey) return { row, error: "step_key is required" };
        if (!stepNum) return { row, error: "step_num is required" };
        if (!title) return { row, error: "title is required" };
        if (!bodyTxt) return { row, error: "body is required" };
        row.step_key = stepKey;
        row.locale = locale ?? "en";
        row.step_num = stepNum;
        row.title = title;
        row.body = bodyTxt;
        row.sort_order = sortOrder ?? 0;
      } else {
        if (stepKey !== undefined) row.step_key = stepKey;
        if (stepNum !== undefined) row.step_num = stepNum;
        if (title !== undefined) row.title = title;
        if (bodyTxt !== undefined) row.body = bodyTxt;
      }
      // Optional per-step photo (nullable). Present-and-empty clears it
      // back to NULL (text-only step). Sent by the admin editor as a URL
      // string from the shared /upload-image route (process-steps/ prefix).
      if (patch.image_url !== undefined) {
        const img = trimStr(patch.image_url);
        row.image_url = img && img.length > 0 ? img : null;
      }
      return { row };
    }
  }
}

async function handleCreate(
  req: NextRequest,
  table: Table,
  body: Record<string, unknown>,
) {
  const { row, error: shapeErr } = shapeRow(table, body, true);
  if (shapeErr) {
    return NextResponse.json({ error: shapeErr }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from(table)
    .insert(row)
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  bust();
  void recordAuditEvent({
    req,
    entity: "product",
    action: "create",
    targetId: (data?.id as string) ?? null,
    targetLabel: `${table}:${describeNatural(table, row)}`,
    context: `Created ${table} row`,
    meta: { table, row: data },
  });
  return NextResponse.json({ row: data });
}

async function handleUpdate(
  req: NextRequest,
  table: Table,
  body: Record<string, unknown>,
) {
  const id = s(body.id);
  const patch = (body.patch ?? {}) as Record<string, unknown>;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const { row, error: shapeErr } = shapeRow(table, patch, false);
  if (shapeErr) {
    return NextResponse.json({ error: shapeErr }, { status: 400 });
  }
  if (Object.keys(row).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from(table)
    .update(row)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  bust();
  void recordAuditEvent({
    req,
    entity: "product",
    action: "update",
    targetId: id,
    targetLabel: `${table}:${describeNatural(table, data ?? row)}`,
    context: `Updated ${table} row`,
    meta: { table, patch: row },
  });
  return NextResponse.json({ row: data });
}

async function handleUpsert(
  req: NextRequest,
  table: Table,
  body: Record<string, unknown>,
) {
  // Currently only used for content_strings (upsert by natural key).
  if (table !== "content_strings") {
    return NextResponse.json(
      { error: "upsert is only supported for content_strings" },
      { status: 400 },
    );
  }
  const key = trimStr(body.key);
  const locale = trimStr(body.locale) ?? "en";
  const productId = body.product_id == null ? null : s(body.product_id) ?? null;
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  const valueRaw = body.value;
  const value = valueRaw == null ? null : trimStr(valueRaw) ?? null;
  const isVisible = b(body.is_visible) ?? true;
  const row = {
    key,
    locale,
    product_id: productId,
    value,
    is_visible: isVisible,
    page_slug: body.page_slug == null ? null : trimStr(body.page_slug) ?? null,
    note: body.note == null ? null : trimStr(body.note) ?? null,
  };
  const { data, error } = await supabaseAdmin
    .from("content_strings")
    .upsert(row, { onConflict: "key,locale,product_id" })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  bust();
  void recordAuditEvent({
    req,
    entity: "product",
    action: "update",
    targetId: (data?.id as string) ?? null,
    targetLabel: `content_strings:${key} (${locale}${productId ? `, ${productId}` : ""})`,
    context: `Upserted content string`,
    meta: { table, row: data },
  });
  return NextResponse.json({ row: data });
}

async function handleDelete(
  req: NextRequest,
  table: Table,
  body: Record<string, unknown>,
) {
  const id = s(body.id);
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const { data: pre } = await supabaseAdmin
    .from(table)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabaseAdmin.from(table).delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  bust();
  void recordAuditEvent({
    req,
    entity: "product",
    action: "delete",
    targetId: id,
    targetLabel: `${table}:${pre ? describeNatural(table, pre) : id}`,
    context: `Deleted ${table} row`,
    meta: { table, deleted: pre },
  });
  return NextResponse.json({ ok: true });
}

async function handleReorder(
  req: NextRequest,
  table: Table,
  body: Record<string, unknown>,
) {
  if (table === "content_strings") {
    return NextResponse.json(
      { error: "content_strings has no sort_order" },
      { status: 400 },
    );
  }
  const orderedIds = Array.isArray(body.orderedIds)
    ? (body.orderedIds as unknown[]).filter((x): x is string => typeof x === "string")
    : null;
  if (!orderedIds || orderedIds.length === 0) {
    return NextResponse.json({ error: "orderedIds is required" }, { status: 400 });
  }
  // One UPDATE per row; the list is short (handful of tiles/steps/milestones).
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabaseAdmin
      .from(table)
      .update({ sort_order: i })
      .eq("id", orderedIds[i]);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  bust();
  void recordAuditEvent({
    req,
    entity: "product",
    action: "update",
    targetId: null,
    targetLabel: `${table}:reorder`,
    context: `Reordered ${table}`,
    meta: { table, orderedIds },
  });
  return NextResponse.json({ ok: true });
}

function describeNatural(table: Table, row: Record<string, unknown>): string {
  switch (table) {
    case "content_strings":
      return `${row.key} (${row.locale}${row.product_id ? `, ${row.product_id}` : ""})`;
    case "product_stat_tiles":
      return `${row.product_id}/${row.tile_key}`;
    case "product_app_test_reports":
      return `${row.product_id}/${row.report_key}`;
    case "behind_milestones":
      return `${row.milestone_key}`;
    case "behind_stats":
      return `${row.stat_key}`;
    case "process_steps":
      return `${row.step_key}`;
  }
}
