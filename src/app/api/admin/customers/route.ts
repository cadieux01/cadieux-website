// GET /api/admin/customers
//
// List customers with derived stats — total_orders, total_spent,
// last_order_at. Supports optional ?q= partial search on name + phone
// (case-insensitive). No pagination yet; the customer count is small
// enough at launch that an in-memory aggregation is fine. Revisit if
// it grows past a few thousand rows.

import { NextRequest, NextResponse } from "next/server";
import {
  isAdmin,
  isTeamOrderToken,
  supabaseAdmin,
  verifyAdminOrTeamOrder,
} from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

export async function GET(req: NextRequest) {
  // Dual-auth: full admin session OR the narrow team-order token
  // (only unlocks the four endpoints the /register form needs).
  if (!verifyAdminOrTeamOrder(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // The team-order token is the "shared /register PIN" — it can look
  // customers up ONLY by a FULL 10-digit phone. This prevents a bored
  // team member from typing "a" and getting the full customer list.
  // Admins retain the partial name / partial phone search.
  const isTeam = !isAdmin(req) && isTeamOrderToken(req);

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();

  if (isTeam) {
    const digits = q.replace(/\D/g, "");
    if (digits.length !== 10) {
      // No error page — the form only lookups on 10 digits anyway,
      // this is belt-and-braces so a hand-crafted request can't skirt.
      return NextResponse.json({ customers: [] });
    }
  }

  let custQ = supabaseAdmin
    .from("customers")
    .select("id, full_name, phone, city, created_at")
    .order("created_at", { ascending: false });

  if (q) {
    if (isTeam) {
      // Exact phone match only. `.eq` avoids the ILIKE wildcard entirely.
      const digits = q.replace(/\D/g, "");
      custQ = custQ.eq("phone", digits);
      void recordAuditEvent({
        req,
        entity: "customer",
        action: "other",
        context: `[team-PIN] customer lookup by phone ${digits}`,
        meta: { via: "team_order", phone: digits },
      });
    } else {
      // ILIKE on either name or phone. Supabase's `.or` takes a string
      // expression; escape `*` and `,` in user input to avoid breaking
      // the parser.
      const safe = q.replace(/[,*()]/g, " ");
      custQ = custQ.or(
        `full_name.ilike.%${safe}%,phone.ilike.%${safe}%`,
      );
    }
  }

  const { data: customers, error } = await custQ;
  if (error) {
    console.error("[admin/customers list]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!customers || customers.length === 0) {
    return NextResponse.json({ customers: [] });
  }

  // Pull every order row for the matched customers in one query and
  // fold into per-customer aggregates client-side. We only need a
  // narrow slice per row — id/customer_id/total_amount/created_at.
  const custIds = customers.map((c) => c.id);
  const { data: orders, error: ordErr } = await supabaseAdmin
    .from("orders")
    .select("customer_id, total_amount, created_at, status")
    .in("customer_id", custIds);

  if (ordErr) {
    console.error("[admin/customers orders agg]", ordErr.message);
    return NextResponse.json({ error: ordErr.message }, { status: 500 });
  }

  type Agg = { total_orders: number; total_spent: number; last_order_at: string | null };
  const agg = new Map<string, Agg>();
  for (const row of orders ?? []) {
    if (!row.customer_id) continue;
    // Don't count cancelled orders in total_spent — they didn't pay.
    const isCancelled = (row.status ?? "").toLowerCase() === "cancelled";
    const cur = agg.get(row.customer_id) ?? {
      total_orders: 0,
      total_spent: 0,
      last_order_at: null,
    };
    cur.total_orders += 1;
    if (!isCancelled) cur.total_spent += Number(row.total_amount) || 0;
    if (!cur.last_order_at || row.created_at > cur.last_order_at) {
      cur.last_order_at = row.created_at;
    }
    agg.set(row.customer_id, cur);
  }

  const enriched = customers.map((c) => {
    const a = agg.get(c.id);
    return {
      ...c,
      total_orders: a?.total_orders ?? 0,
      total_spent: a?.total_spent ?? 0,
      last_order_at: a?.last_order_at ?? null,
    };
  });

  return NextResponse.json({ customers: enriched });
}
