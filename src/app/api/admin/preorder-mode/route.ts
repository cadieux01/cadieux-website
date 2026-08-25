// Admin-gated read + write for app_config.preorder_mode.
//
// GET is a convenience for the admin settings page (avoids the client having
// to route through the public /api/preorder-mode when it's already inside an
// authed admin surface); write goes through PUT with an audit trail.

import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getPreorderMode, setPreorderMode } from "@/lib/preorderMode";
import { recordAuditEvent } from "@/lib/audit-log";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const enabled = await getPreorderMode();
  return NextResponse.json(
    { enabled },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PUT(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Missing boolean 'enabled'" }, { status: 400 });
  }

  const previous = await getPreorderMode();
  const next = body.enabled;

  // No-op flip → return current value without touching the DB (still 200 so
  // the client's optimistic UI settles cleanly).
  if (previous === next) {
    return NextResponse.json({ enabled: next, changed: false });
  }

  try {
    await setPreorderMode(next);
  } catch (err) {
    console.error("[admin/preorder-mode] set failed:", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "Failed to save" },
      { status: 500 },
    );
  }

  void recordAuditEvent({
    req,
    entity: "other",
    action: "update",
    targetId: null,
    targetLabel: "preorder_mode",
    context: `Pre-order mode ${next ? "TURNED ON" : "TURNED OFF"}`,
    meta: {
      setting: "preorder_mode",
      previous,
      next,
    },
  });

  return NextResponse.json({ enabled: next, changed: true });
}
