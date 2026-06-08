// ---------------------------------------------------------------------------
// manage-partner — Supabase Edge Function
// ---------------------------------------------------------------------------
// Single trusted choke point for managing dashboard login accounts for BOTH
// "sales" and "partner" roles. (Deploy name kept as `manage-partner`;
// conceptually this is "manage-user".) Replaces the previous browser-side
// `supabase.auth.admin.*` / `auth.signUp` calls, which would have required
// shipping the service-role key to the client.
//
// IDENTIFIER MODEL
// ----------------
// Sales execs and partners log in with a 10-digit Indian mobile number +
// password. To keep Supabase's standard email/password auth flow we
// synthesise an email of the form `<phone>@cadieux.<role>` (role ∈
// {sales, partner}) and store the *real* phone in
// `logistics.profiles.phone` (legacy `phone_number` kept in sync). The
// dashboard login page detects when a user types a phone number and applies
// the same transform before calling `signInWithPassword`.
//
// Admin / real-email accounts (e.g. sunny@gmail.com) are untouched.
//
// REQUEST
// -------
//   POST /functions/v1/manage-partner
//   Authorization: Bearer <caller's session.access_token>
//   Content-Type: application/json
//
//   { "action": "create", "phone": "9876543210", "password": "min6chars",
//     "full_name": "Ramesh Kumar", "role": "sales"|"partner",
//     "notes": "optional" }
//
//   { "action": "deactivate", "phone": "9876543210" }  // soft: ban + keep data
//   { "action": "delete",     "phone": "9876543210" }  // remove login, keep data
//   { "action": "reactivate", "phone": "9876543210" }  // un-ban
//
//   // Approving profile change requests (admin any, sales partner-only):
//   { "action": "change-password", "user_id": "<uuid>", "new_password": "min6" }
//   // Admin directly sets a password from the Edit Partner modal (ADMIN-ONLY):
//   { "action": "admin-set-password", "user_id": "<uuid>", "new_password": "min6" }
//   { "action": "change-phone", "user_id": "<uuid>",
//     "old_phone": "9876543210", "new_phone": "9123456780" }
//
// RESPONSE
// --------
//   200 { success: true, ... }
//   4xx { error: string }
//
// ENV
// ---
//   SUPABASE_URL              — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected
//   ALLOWED_ORIGIN            — e.g. "https://sunny.cadieux.in" (or "*")
//
// DEPLOY
//   supabase functions deploy manage-partner --project-ref uejagupcwevadfhfuadv --no-verify-jwt
// ---------------------------------------------------------------------------

// @ts-expect-error — Deno-style remote import resolved at deploy time.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Deno globals — declared loosely so this file also type-checks if
// opened in a Node-based editor.
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Promise<Response> | Response) => void;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

// ~100 years; effectively a permanent ban for deactivated accounts.
const BAN_DURATION = "876000h";

type ManageableRole = "sales" | "partner";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isManageableRole(v: unknown): v is ManageableRole {
  return v === "sales" || v === "partner";
}

// Strict 10-digit Indian mobile shape: starts 6/7/8/9.
// Accepts stray spaces / `+91` / `0` prefix and normalises.
function normaliseIndianMobile(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  const trimmed = digits.length === 12 && digits.startsWith("91")
    ? digits.slice(2)
    : digits.length === 11 && digits.startsWith("0")
      ? digits.slice(1)
      : digits;
  return /^[6-9][0-9]{9}$/.test(trimmed) ? trimmed : null;
}

function phoneToEmail(phone: string, role: ManageableRole): string {
  return `${phone}@cadieux.${role}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("[manage-partner] missing SUPABASE_URL or service role key");
    return json(500, { error: "Server mis-configured" });
  }

  // ── 1. Caller JWT ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!token) {
    return json(401, { error: "Missing bearer token" });
  }

  // Service-role client — bypasses RLS, used for every privileged op.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 2. Verify the JWT belongs to a real user ──────────────────────────
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json(401, { error: "Invalid or expired session" });
  }
  const caller = userData.user;

  // ── 3. Role check — admin or sales only ───────────────────────────────
  const { data: callerProfile, error: roleErr } = await admin
    .schema("logistics")
    .from("profiles")
    .select("role")
    .eq("id", caller.id)
    .maybeSingle();

  if (roleErr) {
    console.error("[manage-partner] role lookup failed:", roleErr.message);
    return json(500, { error: "Role lookup failed" });
  }
  const callerRole = callerProfile?.role;
  if (callerRole !== "admin" && callerRole !== "sales") {
    return json(403, { error: "Only admin or sales can manage users" });
  }

  // ── 4. Parse + dispatch ───────────────────────────────────────────────
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json(400, { error: "Body must be valid JSON" });
  }

  const action = body.action;

  async function writeAudit(entry: Record<string, unknown>) {
    const { error: auditError } = await admin
      .schema("logistics")
      .from("audit_logs")
      .insert({
        actor_id: caller.id,
        actor_email: caller.email,
        category: "user",
        metadata: { via: "edge:manage-partner" },
        ...entry,
      });
    if (auditError) {
      console.warn("[manage-partner] audit insert failed:", auditError.message);
    }
  }

  // -----------------------------------------------------------------------
  // CREATE
  // -----------------------------------------------------------------------
  if (action === "create") {
    const phone = normaliseIndianMobile(body.phone);
    const password = body.password;
    const full_name = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const role = body.role;
    const notes = typeof body.notes === "string" ? body.notes : null;

    if (!phone) {
      return json(400, {
        error: "phone must be a 10-digit Indian mobile (leading 6-9)",
      });
    }
    if (!isManageableRole(role)) {
      return json(400, { error: 'role must be "sales" or "partner"' });
    }
    if (!isNonEmptyString(password) || password.length < 6) {
      return json(400, { error: "password must be at least 6 characters" });
    }
    if (!isNonEmptyString(full_name)) {
      return json(400, { error: "full_name is required" });
    }

    const email = phoneToEmail(phone, role);

    // 4a. Create the auth user (auto-confirmed, no email verification).
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role, phone },
    });
    if (createErr || !created?.user) {
      const msg = createErr?.message ?? "Failed to create user";
      const friendly = /already (registered|exists)/i.test(msg)
        ? `A ${role} with phone ${phone} already exists`
        : msg;
      return json(400, { error: friendly });
    }

    // 4b. Insert the profile row. Roll back the auth user on failure so
    //     we don't leak a half-onboarded account.
    const { error: profileErr } = await admin
      .schema("logistics")
      .from("profiles")
      .insert({
        id: created.user.id,
        email,
        phone,
        phone_number: phone, // legacy column kept in sync for older UI
        full_name,
        role,
        notes,
        status: "active",
      });
    if (profileErr) {
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
      const dupe = /duplicate key|unique constraint/i.test(profileErr.message);
      return json(400, {
        error: dupe
          ? `A ${role} with phone ${phone} already exists`
          : `Failed to create profile: ${profileErr.message}`,
      });
    }

    // 4c. Audit (non-fatal).
    await writeAudit({
      action_type: "CREATE",
      entity_type: "user",
      entity_id: created.user.id,
      description: `Created ${role} account for ${full_name} (${phone})`,
      new_values: { phone, full_name, role },
    });

    return json(200, { success: true, user_id: created.user.id, phone, email, role });
  }

  // -----------------------------------------------------------------------
  // DEACTIVATE / DELETE / REACTIVATE — operate on an existing user by phone.
  // -----------------------------------------------------------------------
  if (action === "deactivate" || action === "delete" || action === "reactivate") {
    const phone = normaliseIndianMobile(body.phone);
    if (!phone) {
      return json(400, {
        error: "phone must be a 10-digit Indian mobile (leading 6-9)",
      });
    }

    // Look up the profile by the real phone column (works for both roles).
    const { data: target, error: lookupErr } = await admin
      .schema("logistics")
      .from("profiles")
      .select("id, email, phone, role, full_name, status")
      .eq("phone", phone)
      .maybeSingle();

    if (lookupErr) {
      return json(500, { error: `Lookup failed: ${lookupErr.message}` });
    }
    if (!target) {
      return json(404, { error: `No account found for phone ${phone}` });
    }
    if (!isManageableRole(target.role)) {
      return json(403, {
        error: "This endpoint only manages sales/partner accounts",
      });
    }
    if (target.id === caller.id) {
      return json(400, { error: "You cannot modify your own account" });
    }

    // ── DEACTIVATE: ban the login, keep all data ───────────────────────
    if (action === "deactivate") {
      const { error: banErr } = await admin.auth.admin.updateUserById(target.id, {
        ban_duration: BAN_DURATION,
      });
      if (banErr) {
        return json(400, { error: `Failed to deactivate login: ${banErr.message}` });
      }
      const { error: statusErr } = await admin
        .schema("logistics")
        .from("profiles")
        .update({ status: "inactive" })
        .eq("id", target.id);
      if (statusErr) {
        return json(400, {
          error: `Login banned but status update failed: ${statusErr.message}`,
        });
      }
      await writeAudit({
        action_type: "UPDATE",
        entity_type: "user",
        entity_id: target.id,
        description: `Deactivated ${target.role} account ${target.full_name || phone} (${phone})`,
        old_values: { status: target.status ?? "active" },
        new_values: { status: "inactive" },
      });
      return json(200, { success: true, phone, status: "inactive" });
    }

    // ── REACTIVATE: un-ban a deactivated login ─────────────────────────
    if (action === "reactivate") {
      const { error: unbanErr } = await admin.auth.admin.updateUserById(target.id, {
        ban_duration: "none",
      });
      if (unbanErr) {
        return json(400, { error: `Failed to reactivate login: ${unbanErr.message}` });
      }
      const { error: statusErr } = await admin
        .schema("logistics")
        .from("profiles")
        .update({ status: "active" })
        .eq("id", target.id);
      if (statusErr) {
        return json(400, {
          error: `Login un-banned but status update failed: ${statusErr.message}`,
        });
      }
      await writeAudit({
        action_type: "UPDATE",
        entity_type: "user",
        entity_id: target.id,
        description: `Reactivated ${target.role} account ${target.full_name || phone} (${phone})`,
        old_values: { status: target.status ?? "inactive" },
        new_values: { status: "active" },
      });
      return json(200, { success: true, phone, status: "active" });
    }

    // ── DELETE: remove the login but KEEP the profile row + all data ───
    const { error: delAuthErr } = await admin.auth.admin.deleteUser(target.id);
    if (delAuthErr) {
      return json(400, { error: `Failed to delete login: ${delAuthErr.message}` });
    }
    // Keep the profile row (sales, leads, audit logs reference it); just
    // mark it deleted so it leaves active lists.
    const { error: statusErr } = await admin
      .schema("logistics")
      .from("profiles")
      .update({ status: "deleted" })
      .eq("id", target.id);
    if (statusErr) {
      return json(400, {
        error: `Login deleted but status update failed: ${statusErr.message}`,
      });
    }
    await writeAudit({
      action_type: "DELETE",
      entity_type: "user",
      entity_id: target.id,
      description: `Deleted login for ${target.full_name || phone} (${phone})`,
      old_values: {
        email: target.email,
        role: target.role,
        full_name: target.full_name,
        phone,
        status: target.status ?? "active",
      },
      new_values: { status: "deleted" },
    });
    return json(200, { success: true, phone, status: "deleted" });
  }

  // -----------------------------------------------------------------------
  // CHANGE-PASSWORD — reset an existing user's password.
  //   { action: "change-password", user_id, new_password }
  // Used when an admin/sales approves a 'password' change request. The
  // request row never carries the plaintext; the approver supplies it here.
  // -----------------------------------------------------------------------
  if (action === "change-password") {
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    const newPassword = body.new_password;

    if (!isNonEmptyString(userId)) {
      return json(400, { error: "user_id is required" });
    }
    if (!isNonEmptyString(newPassword) || newPassword.length < 6) {
      return json(400, { error: "new_password must be at least 6 characters" });
    }

    // Look up the target so we can enforce the sales→partner-only rule
    // and produce a useful audit description.
    const { data: target, error: lookupErr } = await admin
      .schema("logistics")
      .from("profiles")
      .select("id, phone, role, full_name")
      .eq("id", userId)
      .maybeSingle();
    if (lookupErr) {
      return json(500, { error: `Lookup failed: ${lookupErr.message}` });
    }
    if (!target) {
      return json(404, { error: "No account found for that user" });
    }
    if (callerRole === "sales" && target.role !== "partner") {
      return json(403, { error: "Sales can only manage partner accounts" });
    }

    const { error: pwErr } = await admin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });
    if (pwErr) {
      return json(400, { error: `Failed to update password: ${pwErr.message}` });
    }

    await writeAudit({
      action_type: "UPDATE",
      entity_type: "user",
      entity_id: userId,
      description: `Reset password for ${target.full_name || target.phone || userId}`,
      new_values: { password: "reset" },
    });
    return json(200, { success: true, user_id: userId });
  }

  // -----------------------------------------------------------------------
  // ADMIN-SET-PASSWORD — an admin directly sets a user's password.
  //   { action: "admin-set-password", user_id, new_password }
  // ADMIN-ONLY (stricter than change-password): used by the Edit Partner
  // modal where the admin is the authority and sets the password directly,
  // with no separate approval step. Sales/agents are rejected here even for
  // partner targets — they must use the change-request approval flow instead.
  // -----------------------------------------------------------------------
  if (action === "admin-set-password") {
    if (callerRole !== "admin") {
      return json(403, { error: "Only an admin can set a user's password" });
    }

    const userId = typeof body.user_id === "string" ? body.user_id : "";
    const newPassword = body.new_password;

    if (!isNonEmptyString(userId)) {
      return json(400, { error: "user_id is required" });
    }
    if (!isNonEmptyString(newPassword) || newPassword.length < 6) {
      return json(400, { error: "new_password must be at least 6 characters" });
    }

    const { data: target, error: lookupErr } = await admin
      .schema("logistics")
      .from("profiles")
      .select("id, phone, role, full_name")
      .eq("id", userId)
      .maybeSingle();
    if (lookupErr) {
      return json(500, { error: `Lookup failed: ${lookupErr.message}` });
    }
    if (!target) {
      return json(404, { error: "No account found for that user" });
    }
    if (!isManageableRole(target.role)) {
      return json(403, {
        error: "This endpoint only manages sales/partner accounts",
      });
    }

    const { error: pwErr } = await admin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });
    if (pwErr) {
      return json(400, { error: `Failed to update password: ${pwErr.message}` });
    }

    await writeAudit({
      action_type: "UPDATE",
      entity_type: "user",
      entity_id: userId,
      description: `Admin set password for ${target.full_name || target.phone || userId}`,
      new_values: { password: "set" },
    });
    return json(200, { success: true, user_id: userId });
  }

  // -----------------------------------------------------------------------
  // CHANGE-PHONE — change an existing user's phone.
  //   { action: "change-phone", user_id, old_phone, new_phone }
  // Rewrites the synthetic auth email `<phone>@cadieux.<role>` and the
  // profile's phone columns. Used when approving a 'phone' change request.
  // -----------------------------------------------------------------------
  if (action === "change-phone") {
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    const newPhone = normaliseIndianMobile(body.new_phone);

    if (!isNonEmptyString(userId)) {
      return json(400, { error: "user_id is required" });
    }
    if (!newPhone) {
      return json(400, {
        error: "new_phone must be a 10-digit Indian mobile (leading 6-9)",
      });
    }

    const { data: target, error: lookupErr } = await admin
      .schema("logistics")
      .from("profiles")
      .select("id, email, phone, role, full_name")
      .eq("id", userId)
      .maybeSingle();
    if (lookupErr) {
      return json(500, { error: `Lookup failed: ${lookupErr.message}` });
    }
    if (!target) {
      return json(404, { error: "No account found for that user" });
    }
    if (!isManageableRole(target.role)) {
      return json(403, {
        error: "This endpoint only manages sales/partner accounts",
      });
    }
    if (callerRole === "sales" && target.role !== "partner") {
      return json(403, { error: "Sales can only manage partner accounts" });
    }

    const oldPhone = target.phone;
    const newEmail = phoneToEmail(newPhone, target.role);

    // 1. Update the synthetic auth email so login with the new phone works.
    const { error: emailErr } = await admin.auth.admin.updateUserById(userId, {
      email: newEmail,
      email_confirm: true,
      user_metadata: { phone: newPhone },
    });
    if (emailErr) {
      const dupe = /already (registered|exists)/i.test(emailErr.message);
      return json(400, {
        error: dupe
          ? `A ${target.role} with phone ${newPhone} already exists`
          : `Failed to update login: ${emailErr.message}`,
      });
    }

    // 2. Update the profile phone columns + email to match.
    const { error: profileErr } = await admin
      .schema("logistics")
      .from("profiles")
      .update({ phone: newPhone, phone_number: newPhone, email: newEmail })
      .eq("id", userId);
    if (profileErr) {
      return json(400, {
        error: `Login updated but profile update failed: ${profileErr.message}`,
      });
    }

    await writeAudit({
      action_type: "UPDATE",
      entity_type: "user",
      entity_id: userId,
      description: `Changed phone for ${target.full_name || userId} (${oldPhone || "?"} → ${newPhone})`,
      old_values: { phone: oldPhone, email: target.email },
      new_values: { phone: newPhone, email: newEmail },
    });
    return json(200, { success: true, user_id: userId, phone: newPhone, email: newEmail });
  }

  return json(400, {
    error:
      'action must be "create", "deactivate", "delete", "reactivate", "change-password", "admin-set-password", or "change-phone"',
  });
});
