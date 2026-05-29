import { NextRequest, NextResponse } from "next/server";

import { isAdmin } from "@/lib/admin-auth";
import { logLogisticsAudit } from "@/lib/logistics-audit";
import {
  clearFailures,
  isLockedOut,
  productLockConfigured,
  PRODUCT_LOCK_LIMITS,
  registerFailure,
  signGrant,
  verifyProductKey,
} from "@/lib/product-lock";

// POST /api/admin/verify-product-lock
//   Body: { key: string, productName?: string, change?: string }
//   Verifies the Product Lock key server-side. On success returns a
//   short-lived signed grant the caller must attach (as the
//   x-product-lock-grant header) to the actual product mutation. The key
//   itself is never echoed back to the client.
//
//   Audit logging (to logistics.audit_logs):
//     • wrong key      -> BLOCKED  ("FAILED product edit attempt …")
//     • 3rd wrong key  -> LOCKOUT  ("locked out after 3 failed attempts")
//   The SUCCESS audit row is written by the mutation route after the
//   change actually lands, so this route logs failures/lockouts only.

function callerId(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "global";
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!productLockConfigured()) {
    return NextResponse.json(
      { error: "PRODUCT_LOCK_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    key?: unknown;
    productName?: unknown;
    change?: unknown;
  };
  const productName =
    typeof body.productName === "string" ? body.productName : "a product";
  const change =
    typeof body.change === "string" ? body.change : "edit product";

  const id = callerId(req);

  // Already locked out? Reject without consuming another attempt.
  const lock = isLockedOut(id);
  if (lock.locked) {
    return NextResponse.json(
      {
        ok: false,
        error: "locked_out",
        retryAfterMs: Math.max(0, lock.until - Date.now()),
      },
      { status: 423 },
    );
  }

  if (verifyProductKey(body.key)) {
    clearFailures(id);
    return NextResponse.json({ ok: true, grant: signGrant() });
  }

  // Wrong key → register a failure, then log BLOCKED or LOCKOUT.
  const result = registerFailure(id);

  if (result.justLockedOut) {
    void logLogisticsAudit({
      actionType: "LOCKOUT",
      entityType: "product",
      category: "product",
      description: `Product Lock: user locked out after ${PRODUCT_LOCK_LIMITS.MAX_ATTEMPTS} failed attempts (${change} on "${productName}")`,
      metadata: { ip: id, productName, change },
    });
    return NextResponse.json(
      {
        ok: false,
        error: "locked_out",
        retryAfterMs: Math.max(0, result.lockedUntil - Date.now()),
      },
      { status: 423 },
    );
  }

  void logLogisticsAudit({
    actionType: "BLOCKED",
    entityType: "product",
    category: "product",
    description: `FAILED product edit attempt — wrong Product Lock key (${change} on "${productName}")`,
    metadata: { ip: id, productName, change, attempt: result.fails },
  });

  return NextResponse.json(
    { ok: false, error: "incorrect_key", attemptsLeft: result.attemptsLeft },
    { status: 401 },
  );
}
