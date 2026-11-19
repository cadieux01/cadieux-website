// GET  /api/mkt/profiles  → list of every profile in the marketing
//                           workspace (admin + non-admin). Admin only.
//
// POST /api/mkt/profiles  → create a new person: one auth.users row +
//                           one logistics.profiles row with the same id.
//                           Admin only. Returns a ONE-TIME password the
//                           admin can hand over.
//
// Why POST exists here. Before this route the only way a new person
// could sign in to /mkt was for an operator to create an auth.users
// row by hand in the Supabase dashboard and then INSERT a matching
// profile row. That path is error-prone (every manual INSERT is a
// chance to split a person across two profile rows) and takes the
// operator out of /mkt. This route runs the whole flow server-side
// with uniqueness guards on both email AND phone.
//
// Why a one-time password rather than an invite link. The invite flow
// (sb.auth.admin.inviteUserByEmail) depends on the project's SMTP
// settings and template being correctly configured — if either is
// missing, the invite fails silently from the admin's point of view
// and the new teammate waits for an email that never arrives. A
// returned password works in every environment, is passed over the
// WhatsApp channel the admin already uses to onboard people, and the
// /mkt/login reset flow handles any later rotation. The response is
// shown ONCE in the UI — refreshing the page clears it.
//
// Atomicity. Supabase doesn't expose a transaction for admin API
// calls, so the pattern is: create the auth user; try to insert the
// profile; on profile-insert failure, delete the auth user. That
// keeps the two tables in step. The one leak is a crash between the
// two calls — the auth row would be orphaned until a human cleans up.
// Flagged in the module doc, not in a TODO comment.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { mktServerClient } from "@/lib/mkt-auth";

const ALLOWED_ROLES = new Set(["admin", "sales", "partner", "marketing"]);

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function requireAdminServer(sb: ReturnType<typeof mktServerClient>) {
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const { data: me } = await sb
    .from("profiles")
    .select("role, status")
    .eq("id", userRes.user.id)
    .maybeSingle();
  if (!me || me.role !== "admin" || me.status !== "active") {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { user: userRes.user, me };
}

export async function GET() {
  const sb = mktServerClient();
  const gate = await requireAdminServer(sb);
  if ("error" in gate) return gate.error;

  const { data, error } = await sb
    .from("profiles")
    .select("id, full_name, email, phone, role, status, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ profiles: data ?? [] });
}

/** Tight-enough email check. RFC-5322 in a regex is a tar pit; this
 *  only has to catch obvious typos — the real check is whether
 *  Supabase Auth accepts the string. */
function isPlausibleEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

/** Normalise to bare 10 digits. Returns null when it cannot find
 *  exactly 10 digits — refuses silently coercing a 9-digit stub. */
function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const tail = digits.slice(-10);
  return tail.length === 10 ? tail : null;
}

/** 20 characters, URL-safe-ish alphabet with the visually ambiguous
 *  glyphs removed (no 0/O/1/l). ~120 bits of entropy — comfortable
 *  margin for a password handed over once and then rotated at will. */
function generatePassword(): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(20);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export async function POST(req: NextRequest) {
  const sb = mktServerClient();
  const gate = await requireAdminServer(sb);
  if ("error" in gate) return gate.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const full_name = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phoneRaw = typeof body.phone === "string" ? body.phone : "";
  const role = typeof body.role === "string" ? body.role : "";

  if (!full_name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!isPlausibleEmail(emailRaw)) {
    return NextResponse.json({ error: "Email looks malformed" }, { status: 400 });
  }
  const phone = normalisePhone(phoneRaw);
  if (!phone) {
    return NextResponse.json(
      { error: "Phone must contain 10 digits" },
      { status: 400 },
    );
  }
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json(
      { error: `role must be one of ${Array.from(ALLOWED_ROLES).join(", ")}` },
      { status: 400 },
    );
  }

  // UNIQUENESS: refuse before creating the auth row. Two profiles for
  // one human splits their tasks and notifications in half with no
  // error anywhere. Check BOTH email AND phone in one round-trip —
  // admin may type one correctly and mistype the other.
  const svc = serviceClient();
  const { data: dupes, error: dupeErr } = await svc
    .from("profiles")
    .select("id, email, phone")
    .or(`email.eq.${emailRaw},phone.eq.${phone}`)
    .limit(2);
  if (dupeErr) {
    return NextResponse.json({ error: dupeErr.message }, { status: 500 });
  }
  if (dupes && dupes.length > 0) {
    const hit = dupes[0];
    const field = hit.email === emailRaw ? "email" : "phone";
    return NextResponse.json(
      {
        error: `A profile with this ${field} already exists.`,
        code: "duplicate_profile",
        field,
      },
      { status: 409 },
    );
  }

  // Create the auth user. email_confirm:true skips the email round-
  // trip; the admin is handing over the password out-of-band.
  const password = generatePassword();
  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email: emailRaw,
    password,
    email_confirm: true,
    user_metadata: { full_name, created_via: "mkt_team" },
  });
  if (createErr || !created?.user) {
    return NextResponse.json(
      { error: createErr?.message ?? "Could not create auth user" },
      { status: 500 },
    );
  }

  // Insert the matching profile. On failure, roll back the auth user
  // so a retry doesn't 422 on "user already exists".
  const { error: profileErr } = await svc.from("profiles").insert({
    id: created.user.id,
    full_name,
    email: emailRaw,
    phone,
    role,
    status: "active",
  });
  if (profileErr) {
    const rollback = await svc.auth.admin.deleteUser(created.user.id);
    if (rollback.error) {
      console.error(
        "[mkt/profiles] PROFILE INSERT FAILED, ROLLBACK ALSO FAILED. Orphan auth user:",
        created.user.id,
        rollback.error.message,
      );
    }
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  // Shown ONCE. The client page is responsible for warning the admin
  // before they navigate away — no second fetch will re-reveal this.
  return NextResponse.json({
    profile: {
      id: created.user.id,
      full_name,
      email: emailRaw,
      phone,
      role,
      status: "active",
    },
    one_time_password: password,
  });
}
