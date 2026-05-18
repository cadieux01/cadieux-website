import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

// Soft-archive a lab report. Public PDP only renders is_archived=false
// rows, so this hides without losing the file.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; reportId: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("product_reports")
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq("id", params.reportId)
    .eq("product_id", params.id)
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Not found" },
      { status: error ? 500 : 404 },
    );
  }

  revalidateTag("product-reports");
  return NextResponse.json({ ok: true });
}
