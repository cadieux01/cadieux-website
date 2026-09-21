// Admin-gated read + write for the sandwich kitchen switch + hours.
//
// GET returns { enabled, open, close }. PUT accepts any subset of the three
// and returns the fresh, persisted state. Turning ON is the destructive
// direction (opens the kitchen to customers, once a customer surface ships)
// — the client is responsible for a confirm prompt; the route just writes.

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { isAdmin } from "@/lib/admin-auth";
import {
  getSandwichKitchenStateUncached,
  setSandwichKitchenState,
  SANDWICH_KITCHEN_TAG,
} from "@/lib/sandwich-kitchen";
import { recordAuditEvent } from "@/lib/audit-log";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Admin GET must never observe the customer-side 10 s cache: it renders the
  // form and a stale value would let an admin overwrite fresher DB state.
  const state = await getSandwichKitchenStateUncached();
  return NextResponse.json(state, {
    headers: { "cache-control": "no-store" },
  });
}

export async function PUT(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    enabled?: unknown;
    open?: unknown;
    close?: unknown;
  };

  const patch: {
    enabled?: boolean;
    open?: string;
    close?: string;
  } = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.open === "string") patch.open = body.open.trim();
  if (typeof body.close === "string") patch.close = body.close.trim();

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update. Provide enabled|open|close." },
      { status: 400 },
    );
  }

  // Uncached read for the pre-write compare: reading through the customer
  // cache here would silently produce "no change" verdicts when the row has
  // drifted from the cached copy. See sandwich-kitchen.ts prose.
  const previous = await getSandwichKitchenStateUncached();
  let next;
  try {
    next = await setSandwichKitchenState(patch);
  } catch (err) {
    console.error("[admin/sandwich-kitchen] set failed:", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "Failed to save" },
      { status: 400 },
    );
  }

  // One audit event per PUT (not per-key); the meta captures what changed.
  const changed: string[] = [];
  if (patch.enabled !== undefined && previous.enabled !== next.enabled) changed.push("enabled");
  if (patch.open !== undefined && previous.open !== next.open) changed.push("open");
  if (patch.close !== undefined && previous.close !== next.close) changed.push("close");

  if (changed.length > 0) {
    // Bust the customer-facing cache immediately. Without this, an admin flip
    // would only be visible after each caller's next 10 s expiry — Sunny would
    // read it as broken.
    revalidateTag(SANDWICH_KITCHEN_TAG);

    void recordAuditEvent({
      req,
      entity: "other",
      action: "update",
      targetId: null,
      targetLabel: "sandwich_kitchen",
      context:
        changed.includes("enabled")
          ? `Sandwich kitchen ${next.enabled ? "OPENED" : "CLOSED"}`
          : `Sandwich kitchen hours updated (${next.open}–${next.close})`,
      meta: { previous, next, changed },
    });
  }

  return NextResponse.json({ ...next, changed: changed.length > 0 });
}
