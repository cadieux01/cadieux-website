// DELETE /api/admin/zone-row-overrides/[id]

import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { describeDbError } from "@/lib/db-error";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = params.id;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid override id." }, { status: 400 });
  }
  // .select() so we learn whether anything was actually removed. A bare
  // delete reports success against a row that was never there, which is the
  // same silent-success shape that hid the 42P10 on the POST side.
  const { data, error } = await supabaseAdmin
    .from("delivery_zone_row_overrides")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) {
    console.error("[admin/zone-row-overrides DELETE]", error);
    return NextResponse.json(
      {
        error: `Could not remove row pin — ${describeDbError(error, "unknown database error")}`,
        code: error.code ?? null,
        details: error.details ?? null,
        hint: error.hint ?? null,
      },
      { status: 500 },
    );
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Row pin not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
