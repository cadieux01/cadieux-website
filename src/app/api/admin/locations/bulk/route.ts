// Bulk archive/unarchive/delete of pickup_locations rows by id. Mirrors
// the service-areas/bulk shape so the admin UI can use the same pattern:
// one round-trip, one audit row, returns { succeeded, failed }.
//
// `delete` is hard-delete — callers must surface a stronger confirm.

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

type BulkAction = "archive" | "unarchive" | "delete";

type BulkBody = {
  action?: unknown;
  ids?: unknown;
};

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as BulkBody;
  const action = body.action;
  if (action !== "archive" && action !== "unarchive" && action !== "delete") {
    return NextResponse.json(
      { error: "action must be 'archive', 'unarchive' or 'delete'" },
      { status: 400 },
    );
  }

  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const ids = Array.from(
    new Set(
      rawIds
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id): id is string => id.length > 0),
    ),
  );
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "At least one valid id is required" },
      { status: 400 },
    );
  }
  if (ids.length > 200) {
    return NextResponse.json(
      { error: "Cannot process more than 200 ids at once" },
      { status: 400 },
    );
  }

  let succeeded: string[] = [];
  let succeededLabels: string[] = [];

  if (action === "delete") {
    const { data, error } = await supabaseAdmin
      .from("pickup_locations")
      .delete()
      .in("id", ids)
      .select("id, name");
    if (error) {
      console.error("[admin/locations/bulk] delete failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    succeeded = (data ?? []).map((r) => r.id as string);
    succeededLabels = (data ?? []).map((r) => (r.name as string) ?? "");
  } else {
    const isArchived = action === "archive";
    const patch: Record<string, unknown> = {
      is_archived: isArchived,
      archived_at: isArchived ? new Date().toISOString() : null,
    };
    const { data, error } = await supabaseAdmin
      .from("pickup_locations")
      .update(patch)
      .in("id", ids)
      .select("id, name");
    if (error) {
      console.error("[admin/locations/bulk] update failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    succeeded = (data ?? []).map((r) => r.id as string);
    succeededLabels = (data ?? []).map((r) => (r.name as string) ?? "");
  }

  const failed = ids.filter((id) => !succeeded.includes(id));

  revalidateTag("pickup-locations");

  const auditAction: "archive" | "update" | "delete" =
    action === "archive"
      ? "archive"
      : action === "unarchive"
        ? "update"
        : "delete";

  void recordAuditEvent({
    req,
    entity: "other",
    action: auditAction,
    targetId: null,
    targetLabel: `${succeeded.length} location${
      succeeded.length === 1 ? "" : "s"
    }`,
    context: `Bulk ${action} pickup locations: ${
      succeededLabels.filter(Boolean).join(", ") || "(none)"
    }`,
    meta: {
      action,
      requested: ids,
      succeeded,
      failed,
    },
  });

  return NextResponse.json({ ok: true, succeeded, failed });
}
