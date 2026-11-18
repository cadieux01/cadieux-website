// PATCH /api/mkt/profiles/[id] — admin edits to a single profile.
//
// Writable fields, admin-only:
//   * role   — must be one of the allowed values in logistics.user_role_enum.
//              The route accepts the set statically so a hostile payload
//              can't request a value that doesn't exist (which would 500
//              from Postgres rather than 400 from here).
//   * status — 'active' | 'inactive' | 'deactivated' | 'deleted'.
//
// Everything else is left to the profiles table's own policies.

import { NextRequest, NextResponse } from "next/server";
import { mktServerClient } from "@/lib/mkt-auth";

const ALLOWED_ROLES = new Set(["admin", "sales", "partner", "marketing"]);
const ALLOWED_STATUS = new Set([
  "active",
  "inactive",
  "deactivated",
  "deleted",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: me } = await sb
    .from("profiles")
    .select("role, status")
    .eq("id", userRes.user.id)
    .maybeSingle();
  if (!me || me.role !== "admin" || me.status !== "active") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const update: Record<string, string> = {};

  if (typeof body.role === "string") {
    if (!ALLOWED_ROLES.has(body.role)) {
      return NextResponse.json(
        { error: `role must be one of ${Array.from(ALLOWED_ROLES).join(", ")}` },
        { status: 400 },
      );
    }
    update.role = body.role;
  }
  if (typeof body.status === "string") {
    if (!ALLOWED_STATUS.has(body.status)) {
      return NextResponse.json(
        { error: `status must be one of ${Array.from(ALLOWED_STATUS).join(", ")}` },
        { status: 400 },
      );
    }
    update.status = body.status;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // GUARD: an admin cannot demote themselves below admin while they
  // are the only active admin — that would leave the workspace with
  // no admin at all. A count query first; cheap, and the right
  // answer is "refuse" not "do it then explain".
  if (params.id === userRes.user.id) {
    if (update.role !== undefined && update.role !== "admin") {
      const { count } = await sb
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("status", "active");
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "You are the only active admin — add another admin first." },
          { status: 409 },
        );
      }
    }
    if (update.status !== undefined && update.status !== "active") {
      return NextResponse.json(
        { error: "You cannot deactivate your own admin account from here." },
        { status: 409 },
      );
    }
  }

  const { error } = await sb
    .from("profiles")
    .update(update)
    .eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
