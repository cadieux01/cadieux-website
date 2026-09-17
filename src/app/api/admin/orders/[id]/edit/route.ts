// /api/admin/orders/[id]/edit
//
// Atomic admin order edit — delivery date/slot/address, items,
// unit prices, delivery fee, total, latitude/longitude. Wraps the
// UPDATE and the paired order_notes writes in one plpgsql transaction
// via the `public.admin_edit_order` RPC.
//
// The existing PATCH /api/admin/orders/[id] handles status transitions
// (with push notifications, refund reservation, etc.). This endpoint
// deliberately does NOT accept status; the two flows are kept
// separate so a mid-flow admin cancel + refund is never entangled
// with an in-place edit + money delta.
//
// Money invariants:
//   - If total_amount changes AND payment_status='paid', an internal
//     order_notes row (kind='note', customer_visible=false) is written
//     recording "REFUND DUE ₹X" or "COLLECT ₹X". The reconcile view
//     reads from these rows; total_amount alone is not enough.
//   - COD orders just update total_amount — nothing owed either way.
//
// Customer trail:
//   - Any change to delivery_date / delivery_slot / delivery_address /
//     items / total_amount / delivery_fee writes a kind='edit',
//     customer_visible=true note describing what changed in plain
//     English. The customer's /orders/[id] page renders these.
//   - Lat/lng changes do NOT trigger a customer note — coordinates are
//     an internal routing detail and would confuse the customer.
//
// Location:
//   - lat + lng must be sent together (or both omitted). The server
//     recomputes distance_km via getDrivingDistanceKm — client value
//     is never trusted.
//
// ITEMS ARE LOCKED ONCE THE ORDER IS PAID. The date is always editable —
// a delivery can be moved and nobody is out of pocket. The items are the
// thing the customer was CHARGED for, and editing them after the money
// has landed silently desyncs what was paid from what is owed: the
// receipt, the Razorpay capture and the row stop agreeing, and no refund
// or collection is recorded anywhere. The money-delta note only fires on
// total_amount, so an items edit could move the figure with no trail.
//
// The lock is stated in THREE places on purpose — the panel disables the
// inputs and says why, this route rejects the field, and `admin_edit_order`
// raises. The RPC check is the one that counts: it reads payment_status
// itself, so a caller that bypasses this route (psql, another service, a
// future endpoint) still cannot get through. The first two exist so the
// operator learns the rule at the keyboard rather than from a 500.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { isPaidStatus } from "@/lib/payment-label";
import { recordAuditEvent } from "@/lib/audit-log";
import { isIsoDate, isValidSlotValue, formatSlotForDisplay } from "@/lib/delivery-slots";
import { getDrivingDistanceKm } from "@/lib/distanceMatrix";
import { formatDate } from "@/lib/admin-formatting";
import type { AdminOrderItemSnapshot } from "@/lib/admin-shared";

// Client-supplied items are validated line-by-line, then re-emitted
// server-side in canonical shape so a bad client can't smuggle extra
// keys or drift the schema.
type ItemInput = {
  product_id?: string | null;
  slug?: string | null;
  name?: string | null;
  quantity?: number | null;
  qty?: number | null;
  unit_price_inr?: number | null;
  price_inr?: number | null;
};

// Canonical outgoing shape (matches AdminOrderItemSnapshot; we write
// both aliases so downstream readers that only know the legacy field
// name still work).
type NormalisedItem = {
  product_id: string | null;
  slug: string | null;
  name: string;
  quantity: number;
  qty: number;
  unit_price_inr: number;
  price_inr: number;
  line_total_inr: number;
  line_total: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normaliseItems(raw: unknown): NormalisedItem[] | { error: string } {
  if (!Array.isArray(raw)) return { error: "items must be an array" };
  if (raw.length === 0) return { error: "items cannot be empty" };
  if (raw.length > 20) return { error: "too many items (max 20)" };

  const out: NormalisedItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i] as ItemInput;
    if (!it || typeof it !== "object") {
      return { error: `items[${i}] is not an object` };
    }
    const name = typeof it.name === "string" ? it.name.trim() : "";
    if (!name) return { error: `items[${i}].name is required` };

    // quantity | qty — accept either alias
    const qRaw = it.quantity ?? it.qty;
    const q = typeof qRaw === "number" ? qRaw : Number(qRaw);
    if (!Number.isFinite(q) || !Number.isInteger(q) || q < 1 || q > 99) {
      return { error: `items[${i}].quantity must be 1..99` };
    }

    // unit_price_inr | price_inr — accept either alias
    const pRaw = it.unit_price_inr ?? it.price_inr;
    const p = typeof pRaw === "number" ? pRaw : Number(pRaw);
    if (!Number.isFinite(p) || p < 0 || p > 99999) {
      return { error: `items[${i}].unit_price_inr must be 0..99999` };
    }

    const unit = round2(p);
    const lineTotal = round2(unit * q);

    out.push({
      product_id: typeof it.product_id === "string" ? it.product_id : null,
      slug: typeof it.slug === "string" ? it.slug : null,
      name,
      quantity: q,
      qty: q,
      unit_price_inr: unit,
      price_inr: unit,
      line_total_inr: lineTotal,
      line_total: lineTotal,
    });
  }
  return out;
}

function itemsSummaryLine(items: NormalisedItem[]): string {
  return items.map((it) => `${it.name} × ${it.quantity}`).join(", ");
}

function itemsEqual(
  a: AdminOrderItemSnapshot[] | null,
  b: NormalisedItem[],
): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ax = a[i];
    const bx = b[i];
    if ((ax.name ?? "") !== bx.name) return false;
    if ((ax.quantity ?? ax.qty ?? 0) !== bx.quantity) return false;
    const aUnit = Number(ax.unit_price_inr ?? ax.price_inr ?? 0);
    if (round2(aUnit) !== bx.unit_price_inr) return false;
  }
  return true;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = (params.id || "").trim();
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Load current row up-front. Every diff check below reads from
  // `before`; the RPC does the write. `payment_status` gates the
  // money-delta note. `items` is jsonb — cast for our normaliser.
  const { data: before, error: beforeErr } = await supabaseAdmin
    .from("orders")
    .select(
      "id, customer_id, order_number, delivery_date, delivery_slot, delivery_address, items, total_amount, delivery_fee, latitude, longitude, distance_km, payment_status, payment_method, razorpay_payment_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (beforeErr) {
    console.error("[admin/orders/edit] pre-fetch failed:", beforeErr.message);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  const changed: string[] = [];
  const summaryLines: string[] = [];
  const metaBefore: Record<string, unknown> = {};
  const metaAfter: Record<string, unknown> = {};

  // -- delivery_date ------------------------------------------------
  if (Object.prototype.hasOwnProperty.call(body, "delivery_date")) {
    const v = body.delivery_date;
    if (v === null || v === "") {
      if ((before.delivery_date ?? null) !== null) {
        updates.delivery_date = null;
        changed.push("delivery_date");
        summaryLines.push(`Delivery date cleared`);
        metaBefore.delivery_date = before.delivery_date;
        metaAfter.delivery_date = null;
      }
    } else if (typeof v === "string" && isIsoDate(v)) {
      if ((before.delivery_date ?? null) !== v) {
        updates.delivery_date = v;
        changed.push("delivery_date");
        const oldFmt = before.delivery_date
          ? formatDate(before.delivery_date as string)
          : "—";
        summaryLines.push(`Delivery moved from ${oldFmt} to ${formatDate(v)}`);
        metaBefore.delivery_date = before.delivery_date;
        metaAfter.delivery_date = v;
      }
    } else {
      return NextResponse.json({ error: "Invalid delivery_date" }, { status: 400 });
    }
  }

  // -- delivery_slot ------------------------------------------------
  if (Object.prototype.hasOwnProperty.call(body, "delivery_slot")) {
    const v = body.delivery_slot;
    const nextSlot: string | null =
      v === null || v === "" ? null : typeof v === "string" ? v : "__invalid__";
    if (nextSlot === "__invalid__") {
      return NextResponse.json({ error: "Invalid delivery_slot" }, { status: 400 });
    }
    // Pass-through byte-identical legacy values without validating; only
    // a truly-new slot has to match the canonical list.
    if (nextSlot !== (before.delivery_slot ?? null)) {
      if (nextSlot !== null && !isValidSlotValue(nextSlot)) {
        return NextResponse.json({ error: "Invalid delivery_slot" }, { status: 400 });
      }
      updates.delivery_slot = nextSlot;
      changed.push("delivery_slot");
      const oldLabel = before.delivery_slot
        ? formatSlotForDisplay(before.delivery_slot as string)
        : "—";
      const newLabel = nextSlot ? formatSlotForDisplay(nextSlot) : "—";
      summaryLines.push(`Slot changed from ${oldLabel} to ${newLabel}`);
      metaBefore.delivery_slot = before.delivery_slot;
      metaAfter.delivery_slot = nextSlot;
    }
  }

  // -- delivery_address ---------------------------------------------
  if (Object.prototype.hasOwnProperty.call(body, "delivery_address")) {
    const v = body.delivery_address;
    if (typeof v !== "string") {
      return NextResponse.json({ error: "Invalid delivery_address" }, { status: 400 });
    }
    const addr = v.trim();
    if (!addr) {
      return NextResponse.json({ error: "Empty delivery_address" }, { status: 400 });
    }
    if (addr !== (before.delivery_address ?? "")) {
      updates.delivery_address = addr;
      changed.push("delivery_address");
      summaryLines.push(`Delivery address updated`);
      metaBefore.delivery_address = before.delivery_address;
      metaAfter.delivery_address = addr;
    }
  }

  // -- items --------------------------------------------------------
  let normalisedItems: NormalisedItem[] | null = null;
  if (Object.prototype.hasOwnProperty.call(body, "items")) {
    // Refused BEFORE the diff, not after: a paid order must not be able to
    // reach the RPC with an items key even when the payload happens to be
    // identical to what is stored. Rejecting a no-op edit is the honest
    // answer — the field is not editable, whatever its value.
    if (isPaidStatus(before.payment_status)) {
      return NextResponse.json(
        {
          error:
            "Items are locked once an order is paid. Cancel and re-issue, or adjust the total and record the refund.",
          field: "items",
        },
        { status: 409 },
      );
    }
    const result = normaliseItems(body.items);
    if (!Array.isArray(result)) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    normalisedItems = result;
    if (!itemsEqual(before.items as AdminOrderItemSnapshot[] | null, result)) {
      updates.items = result;
      changed.push("items");
      summaryLines.push(`Items updated (${itemsSummaryLine(result)})`);
      metaBefore.items = before.items;
      metaAfter.items = result;
    }
  }

  // -- delivery_fee -------------------------------------------------
  if (Object.prototype.hasOwnProperty.call(body, "delivery_fee")) {
    const raw = body.delivery_fee;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 9999) {
      return NextResponse.json({ error: "Invalid delivery_fee" }, { status: 400 });
    }
    const rounded = round2(n);
    if (rounded !== round2(Number(before.delivery_fee ?? 0))) {
      updates.delivery_fee = rounded;
      changed.push("delivery_fee");
      summaryLines.push(`Delivery fee ₹${before.delivery_fee ?? 0} → ₹${rounded}`);
      metaBefore.delivery_fee = before.delivery_fee;
      metaAfter.delivery_fee = rounded;
    }
  }

  // -- total_amount -------------------------------------------------
  if (Object.prototype.hasOwnProperty.call(body, "total_amount")) {
    const raw = body.total_amount;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 999999) {
      return NextResponse.json({ error: "Invalid total_amount" }, { status: 400 });
    }
    const rounded = round2(n);
    if (rounded !== round2(Number(before.total_amount ?? 0))) {
      updates.total_amount = rounded;
      changed.push("total_amount");
      // The customer note leads with the totals — that's the number
      // they care about.
      summaryLines.push(`Order total ₹${before.total_amount ?? 0} → ₹${rounded}`);
      metaBefore.total_amount = before.total_amount;
      metaAfter.total_amount = rounded;
    }
  }

  // -- lat / lng ----------------------------------------------------
  // Both must be sent together or both omitted. Server recomputes
  // distance_km — we never trust a client value for that.
  const hasLat = Object.prototype.hasOwnProperty.call(body, "latitude");
  const hasLng = Object.prototype.hasOwnProperty.call(body, "longitude");
  if (hasLat !== hasLng) {
    return NextResponse.json(
      { error: "latitude and longitude must be sent together" },
      { status: 400 },
    );
  }
  if (hasLat && hasLng) {
    const latRaw = body.latitude;
    const lngRaw = body.longitude;
    if (latRaw === null && lngRaw === null) {
      if (before.latitude !== null || before.longitude !== null) {
        updates.latitude = null;
        updates.longitude = null;
        updates.distance_km = null;
        changed.push("latitude", "longitude");
        metaBefore.latitude = before.latitude;
        metaBefore.longitude = before.longitude;
        metaAfter.latitude = null;
        metaAfter.longitude = null;
      }
    } else {
      const lat = typeof latRaw === "number" ? latRaw : Number(latRaw);
      const lng = typeof lngRaw === "number" ? lngRaw : Number(lngRaw);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      ) {
        return NextResponse.json(
          { error: "Invalid latitude/longitude" },
          { status: 400 },
        );
      }
      if (lat !== before.latitude || lng !== before.longitude) {
        updates.latitude = lat;
        updates.longitude = lng;
        // Recompute distance server-side. On failure (no pickups
        // configured, matrix API down and no haversine fallback)
        // set null so the reconcile-fee display drops the distance
        // line cleanly.
        const km = await getDrivingDistanceKm(lat, lng);
        updates.distance_km = km;
        changed.push("latitude", "longitude");
        metaBefore.latitude = before.latitude;
        metaBefore.longitude = before.longitude;
        metaAfter.latitude = lat;
        metaAfter.longitude = lng;
      }
    }
  }

  if (changed.length === 0) {
    return NextResponse.json({ error: "No changes" }, { status: 400 });
  }

  // Author label — same source as the notes panel. The header comes
  // from the admin session helper; a missing value is fine (`null`).
  const author = (req.headers.get("x-admin-first-name") ?? "").trim() || null;

  // -- customer-visible edit note -----------------------------------
  // Suppress the note if the ONLY change is lat/lng (routing detail —
  // the customer doesn't need to see "we moved your pin 30m").
  const nonGeoChanges = changed.filter(
    (k) => k !== "latitude" && k !== "longitude" && k !== "distance_km",
  );

  const customerNote =
    nonGeoChanges.length > 0
      ? {
          body: summaryLines.join(" · ") + " by Cadieux",
          author,
          meta: { before: metaBefore, after: metaAfter },
        }
      : null;

  // -- internal money-delta note ------------------------------------
  // Fires only when total_amount actually changed AND the order is
  // paid. COD orders don't get one — the total change on a COD row
  // is just "customer will pay the new figure".
  let moneyNote: { body: string; author: string | null; meta: unknown } | null =
    null;
  if (updates.total_amount !== undefined && before.payment_status === "paid") {
    const oldTotal = round2(Number(before.total_amount ?? 0));
    const newTotal = round2(Number(updates.total_amount));
    const delta = round2(newTotal - oldTotal);
    if (delta !== 0) {
      const label = delta < 0 ? "REFUND DUE" : "COLLECT";
      moneyNote = {
        body: `${label} ₹${Math.abs(delta)}`,
        author,
        meta: {
          old_total: oldTotal,
          new_total: newTotal,
          delta,
          payment_method: before.payment_method,
          razorpay_payment_id: before.razorpay_payment_id,
        },
      };
    }
  }

  // -- RPC ----------------------------------------------------------
  // One plpgsql transaction: UPDATE + optional customer note + optional
  // money note. On any raise, all three roll back together.
  const { error: rpcErr } = await supabaseAdmin.rpc("admin_edit_order", {
    p_order_id: id,
    p_updates: updates,
    p_customer_note: customerNote,
    p_money_note: moneyNote,
  });

  if (rpcErr) {
    console.error("[admin/orders/edit] rpc failed:", rpcErr.message);
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  // Fire the existing audit-log wrapper too — same as the current PATCH
  // does. trg_audit_orders already captures the full before/after JSON
  // in logistics.capture_public_audit; this row is the higher-level
  // "who did what" summary the admin audit page renders.
  void recordAuditEvent({
    req,
    entity: "order",
    action: "update",
    targetId: id,
    targetLabel: `#${id.slice(0, 8)}`,
    context:
      summaryLines.length > 0
        ? `Admin edit: ${summaryLines.join(" · ")}`
        : `Admin edit: ${changed.join(", ")}`,
    meta: {
      fields: changed,
      before: metaBefore,
      after: metaAfter,
      money_delta: moneyNote?.meta ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    changed,
    money_note: moneyNote ? { body: moneyNote.body } : null,
  });
}
