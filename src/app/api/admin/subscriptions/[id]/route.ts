import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

const ALLOWED_STATUSES = new Set([
  "pending",
  "confirmed",
  "dispatched",
  "delivered",
  "cancelled",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.status !== "string") {
    return NextResponse.json({ error: "Missing status" }, { status: 400 });
  }
  const status = body.status.toLowerCase();
  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update({ status })
    .eq("id", params.id);

  if (error) {
    console.error("[admin/subscriptions update]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
