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
  const update: Record<string, unknown> = {};

  if (typeof body.status === "string") {
    const s = body.status.toLowerCase();
    if (!ALLOWED_STATUSES.has(s)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    update.status = s;
  }

  if (typeof body.delivery_address === "string") {
    const addr = body.delivery_address.trim();
    if (!addr) {
      return NextResponse.json({ error: "Empty delivery_address" }, { status: 400 });
    }
    update.delivery_address = addr;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update(update)
    .eq("id", params.id);

  if (error) {
    console.error("[admin/orders update]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
