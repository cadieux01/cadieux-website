// /api/mobile/customer
// GET: returns the verified phone's customer profile (or null if not yet created)
// PATCH: updates name/email/photo/marketing_opt_in. Phone change disabled by design.
//
// Auth: X-App-Key (friction layer) + Authorization: Bearer <phone-verified token>.
// All operations are scoped to the bearer's verified phone — no id param is
// accepted, so a caller can only see/edit their own profile.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getVerifiedPhone,
  isValidMobileAppKey,
  maskPhone,
} from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import { profileEditRateLimit } from "@/lib/ratelimit";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Loose email check — enough to catch typos, not a deliverability guarantee.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PROFILE_COLS =
  "id, full_name, phone, email, photo_url, marketing_opt_in, city, created_at";

function fail(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

function authError(req: NextRequest):
  | { ok: false; res: NextResponse }
  | { ok: true; phoneLocal: string } {
  if (!process.env.MOBILE_APP_KEY) {
    return { ok: false, res: fail(500, "Server misconfigured") };
  }
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return { ok: false, res: fail(401, "Unauthorized") };
  }
  const verified = getVerifiedPhone(req);
  if (!verified) return { ok: false, res: fail(401, "Phone not verified") };
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return { ok: false, res: fail(400, "Phone format") };
  }
  return { ok: true, phoneLocal };
}

export async function GET(req: NextRequest) {
  const a = authError(req);
  if (!a.ok) return a.res;

  const { data, error } = await supabaseAdmin
    .from("customers")
    .select(PROFILE_COLS)
    .eq("phone", a.phoneLocal)
    .maybeSingle();
  if (error) {
    console.error("[mobile/customer GET] lookup:", error.message);
    return fail(500, "Lookup failed");
  }

  return NextResponse.json({ ok: true, customer: data ?? null });
}

type Patch = {
  full_name?: string;
  email?: string | null;
  photo_url?: string | null;
  marketing_opt_in?: boolean;
};

// Returns the sanitised update map, or an error response.
function validatePatch(
  raw: unknown,
):
  | { ok: true; update: Record<string, unknown> }
  | { ok: false; res: NextResponse } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, res: fail(400, "Bad JSON", "bad_json") };
  }
  const r = raw as Record<string, unknown>;

  // Explicitly reject disallowed fields. Anything not in the whitelist is
  // forbidden — phone is the obvious one but we also block id/created_at/
  // city/address to keep this endpoint narrowly scoped.
  const allowed = new Set([
    "full_name",
    "email",
    "photo_url",
    "marketing_opt_in",
  ]);
  for (const k of Object.keys(r)) {
    if (!allowed.has(k)) {
      return {
        ok: false,
        res: fail(400, `Field '${k}' cannot be changed here.`, "not_allowed"),
      };
    }
  }

  const update: Record<string, unknown> = {};

  if (r.full_name !== undefined) {
    const v = String(r.full_name ?? "").trim();
    if (v.length < 2 || v.length > 80) {
      return {
        ok: false,
        res: fail(400, "Name must be 2-80 characters.", "full_name"),
      };
    }
    update.full_name = v;
  }

  if (r.email !== undefined) {
    if (r.email === null) {
      update.email = null;
    } else {
      const v = String(r.email).trim().toLowerCase();
      if (!EMAIL_RE.test(v) || v.length > 254) {
        return { ok: false, res: fail(400, "Invalid email.", "email") };
      }
      update.email = v;
    }
  }

  if (r.photo_url !== undefined) {
    if (r.photo_url === null) {
      update.photo_url = null;
    } else {
      const v = String(r.photo_url).trim();
      try {
        const u = new URL(v);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          return {
            ok: false,
            res: fail(400, "Photo URL must be http(s).", "photo_url"),
          };
        }
      } catch {
        return { ok: false, res: fail(400, "Invalid photo URL.", "photo_url") };
      }
      update.photo_url = v;
    }
  }

  if (r.marketing_opt_in !== undefined) {
    if (typeof r.marketing_opt_in !== "boolean") {
      return {
        ok: false,
        res: fail(400, "marketing_opt_in must be boolean.", "marketing_opt_in"),
      };
    }
    update.marketing_opt_in = r.marketing_opt_in;
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, res: fail(400, "No fields to update.", "no_fields") };
  }

  return { ok: true, update };
}

export async function PATCH(req: NextRequest) {
  const a = authError(req);
  if (!a.ok) return a.res;

  // Per-phone daily rate limit. NAT-friendly key.
  const { success: rlOk } = await profileEditRateLimit.limit(a.phoneLocal);
  if (!rlOk) {
    console.warn("[mobile/customer PATCH] rate limited", {
      phone: maskPhone(a.phoneLocal),
    });
    return fail(429, "Too many profile edits today.", "rate_limit");
  }

  const raw = (await req.json().catch(() => null)) as unknown;
  const v = validatePatch(raw);
  if (!v.ok) return v.res;

  // Look up existing row.
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", a.phoneLocal)
    .maybeSingle();
  if (lookupErr) {
    console.error("[mobile/customer PATCH] lookup:", lookupErr.message);
    return fail(500, "Lookup failed");
  }

  let row: Record<string, unknown> | null = null;
  if (!existing) {
    // Create profile row for the verified phone.
    const insertPayload = { ...v.update, phone: a.phoneLocal };
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("customers")
      .insert(insertPayload)
      .select(PROFILE_COLS)
      .single();
    if (insertErr || !inserted) {
      console.error("[mobile/customer PATCH] insert:", insertErr?.message);
      return fail(500, "Failed to create profile");
    }
    row = inserted;
  } else {
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("customers")
      .update(v.update)
      .eq("id", existing.id)
      .select(PROFILE_COLS)
      .single();
    if (updateErr || !updated) {
      console.error("[mobile/customer PATCH] update:", updateErr?.message);
      return fail(500, "Failed to update profile");
    }
    row = updated;
  }

  return NextResponse.json({ ok: true, customer: row });
}
