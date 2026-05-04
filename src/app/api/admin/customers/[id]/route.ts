import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};

  if (body.full_name !== undefined) {
    const v = String(body.full_name ?? "").trim();
    update.full_name = v || null;
  }
  if (body.phone !== undefined) {
    const v = String(body.phone ?? "").trim();
    update.phone = v || null;
  }
  if (body.city !== undefined) {
    const v = String(body.city ?? "").trim();
    update.city = v || null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("customers")
    .update(update)
    .eq("id", params.id);

  if (error) {
    console.error("[admin/customers update]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
