// GET   /api/admin/payment-exceptions/[id]  — one row, INCLUDING the raw event
// PATCH /api/admin/payment-exceptions/[id]  — append one note; resolve if open
//
// The GET exists so `payload` is fetched only when a human opens it, by id,
// rather than riding along on every list render. See the list route for why.
//
// THE PATCH APPENDS. There is no overwrite, no un-resolve and no delete — see
// src/lib/payment-exception-notes.ts for the reasoning, which is the point of
// the endpoint rather than an implementation detail of it.
//
// NO BULK RESOLVE ANYWHERE. Each row is a question about a specific sum of
// money that a person has to answer; a button that answers twenty at once is a
// button that answers them without reading them, which is where this table
// came from.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import {
  appendResolvedNote,
  validateExceptionNote,
} from "@/lib/payment-exception-notes";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One literal, not a concatenation — PostgREST infers the row type from the
// select string, and a non-literal collapses it to GenericStringError.
const ROW_COLUMNS =
  "id, reason, razorpay_payment_id, razorpay_order_id, amount_paise, expected_amount_paise, received_at, resolved_at, resolved_note";

export async function GET(
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

  const { data, error } = await supabaseAdmin
    .from("payment_exceptions")
    .select(`${ROW_COLUMNS}, payload`)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[admin/payment-exceptions get]", error.message);
    return NextResponse.json({ error: "Failed to load." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ exception: data });
}

export async function PATCH(
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
  const check = validateExceptionNote(body.note);
  if ("error" in check) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const { data: row, error: readErr } = await supabaseAdmin
    .from("payment_exceptions")
    .select("id, resolved_at, resolved_note")
    .eq("id", id)
    .maybeSingle();
  if (readErr) {
    console.error("[admin/payment-exceptions patch read]", readErr.message);
    return NextResponse.json({ error: "Failed to load." }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const nextNote = appendResolvedNote(row.resolved_note, check.note, now);

  // Appending means read-then-write, and two operators answering the same row
  // at once would otherwise have one entry silently overwrite the other —
  // losing a record of a decision from the table built to keep them. So the
  // write is conditional on the note still being what we just read; if it
  // isn't, nothing is written and the operator is told to reload. Their text
  // is still in the box.
  //
  // KNOWN CEILING. The comparison sends the whole previous note as a filter
  // value, so a trail of several thousand characters on ONE row will eventually
  // be refused for the length of the query string. It fails LOUD — a 4xx, an
  // error on screen, the typed note still in the box — which is why this is
  // acceptable and a last-write-wins update was not. The fix when it arrives is
  // to move the concatenation into Postgres (`resolved_note || …` in one
  // UPDATE), which is atomic and sends nothing; that is a migration, and not
  // worth one for a ceiling no row is near.
  const update = supabaseAdmin
    .from("payment_exceptions")
    .update({
      resolved_note: nextNote,
      // Stamped once. A later correction does not un-make the decision to
      // close this row, and re-stamping would lose when it was actually made.
      ...(row.resolved_at ? {} : { resolved_at: now.toISOString() }),
    })
    .eq("id", id);

  const { data: updated, error: updErr } = await (
    row.resolved_note === null
      ? update.is("resolved_note", null)
      : update.eq("resolved_note", row.resolved_note)
  ).select(ROW_COLUMNS);

  if (updErr) {
    console.error("[admin/payment-exceptions patch]", updErr.message);
    return NextResponse.json({ error: "Failed to save note." }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      {
        error:
          "Someone else added a note to this exception just now. Reload and add yours again — nothing was lost.",
        code: "stale",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ exception: updated[0] });
}
