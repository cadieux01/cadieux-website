// Admin-gated read + write for app_config.preorder_mode.
//
// GET is a convenience for the admin settings page (avoids the client having
// to route through the public /api/preorder-mode when it's already inside an
// authed admin surface); write goes through PUT with an audit trail.

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { isAdmin } from "@/lib/admin-auth";
import {
  getPreorderModeUncached,
  PREORDER_MODE_TAG,
  setPreorderMode,
} from "@/lib/preorderMode";
import { recordAuditEvent } from "@/lib/audit-log";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Uncached: the admin settings page is showing the operator the value they
  // are about to change, and it is one request on a low-traffic surface.
  const enabled = await getPreorderModeUncached();
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

  // Uncached on purpose — see getPreorderModeUncached. Comparing against a
  // cached value could make a real flip look like a no-op and silently skip
  // the write.
  const previous = await getPreorderModeUncached();
  const next = body.enabled;

  // No-op flip → return current value without touching the DB (still 200 so
  // the client's optimistic UI settles cleanly). Still drop the cache: if the
  // row already held `next` while the cache held the opposite (a direct DB
  // edit), pressing the toggle is the operator's way of forcing a resync.
  if (previous === next) {
    revalidateTag(PREORDER_MODE_TAG);
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

  // Drop the cached read immediately, so the flip is live on the next request
  // instead of waiting out the 10 s window. This is what lets the public read
  // be cached at all without the toggle ever looking stale.
  revalidateTag(PREORDER_MODE_TAG);

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
