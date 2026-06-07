// ---------------------------------------------------------------------------
// verify-admin-pin — Supabase Edge Function
// ---------------------------------------------------------------------------
// Account-level dashboard PIN: set, change, remove, verify, and is-set — all
// SERVER-SIDE with the service-role key. The PIN is stored ONLY as a bcrypt
// hash in `logistics.admin_pins` (RLS on, no policies → the anon/authenticated
// client can never read it). The plaintext PIN and the hash NEVER reach the
// browser. Because the PIN is keyed by the caller's account id, a single shared
// admin login = one row = one PIN that applies on every device.
//
// Why this exists: the previous gate stored a SHA-256 hash in localStorage and
// DEFAULT-ALLOWED when no local hash was present, so a PIN set on one device did
// not apply to others sharing the login — they approved instantly with no PIN.
//
// REQUEST
//   POST /functions/v1/verify-admin-pin
//   Authorization: Bearer <caller's session.access_token>
//   Content-Type: application/json
//
//   { "action": "is-set" }                              → { isSet: boolean }
//   { "action": "set",    "pin": "123456" }             → first-time set
//   { "action": "change", "current_pin": "..", "new_pin": ".." }
//   { "action": "remove", "current_pin": ".." }
//   { "action": "verify", "pin": "123456" }             → { success: true }
//
// LOCKOUT (account-level, authoritative in DB so every device agrees):
//   3 wrong attempts → locked for 5 minutes (locked_until). An optional Upstash
//   sliding window adds burst/DoS protection when its secrets are configured.
//
// ENV
//   SUPABASE_URL              — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected
//   ALLOWED_ORIGIN            — e.g. "https://www.cadieux.in" (or "*")
//   UPSTASH_REDIS_REST_URL    — optional, enables burst rate-limit
//   UPSTASH_REDIS_REST_TOKEN  — optional
//
// DEPLOY
//   supabase functions deploy verify-admin-pin --project-ref uejagupcwevadfhfuadv --no-verify-jwt
// ---------------------------------------------------------------------------

// @ts-expect-error — Deno-style remote import resolved at deploy time.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
// @ts-expect-error — pure-JS bcrypt, runs in Deno.
import bcrypt from "https://esm.sh/bcryptjs@2.4.3";

declare const Deno: {
  env: { get(key: string): string | undefined };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const UPSTASH_URL = Deno.env.get("UPSTASH_REDIS_REST_URL") ?? "";
const UPSTASH_TOKEN = Deno.env.get("UPSTASH_REDIS_REST_TOKEN") ?? "";

const PIN_LENGTH = 6;
const MAX_ATTEMPTS = 3;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes
const BCRYPT_ROUNDS = 10;

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

function isSixDigits(v: unknown): v is string {
  return typeof v === "string" && /^\d{6}$/.test(v.trim());
}

// Optional Upstash burst limiter via the REST API (no SDK import needed).
// Returns true if the request is allowed, false if it should be throttled.
// Fails OPEN on transport errors so a Redis outage never locks out admins —
// the authoritative 3-strike lockout lives in the DB regardless.
async function upstashAllow(key: string, limit: number, windowSec: number): Promise<boolean> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return true;
  try {
    const incr = await fetch(`${UPSTASH_URL}/incr/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const { result } = await incr.json();
    const count = Number(result) || 0;
    if (count === 1) {
      // First hit in the window — set the TTL.
      await fetch(`${UPSTASH_URL}/expire/${encodeURIComponent(key)}/${windowSec}`, {
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      });
    }
    return count <= limit;
  } catch (e) {
    console.warn("[verify-admin-pin] upstash error (failing open):", (e as Error).message);
    return true;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("[verify-admin-pin] missing SUPABASE_URL or service role key");
    return json(500, { error: "Server mis-configured" });
  }

  // ── 1. Caller JWT ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!token) return json(401, { error: "Missing bearer token" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 2. Verify the JWT belongs to a real user ──────────────────────────
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json(401, { error: "Invalid or expired session" });
  }
  const caller = userData.user;

  // ── 3. Role check — admin or sales only (partners never gate) ─────────
  const { data: callerProfile, error: roleErr } = await admin
    .schema("logistics")
    .from("profiles")
    .select("role, full_name, phone, email")
    .eq("id", caller.id)
    .maybeSingle();
  if (roleErr) {
    console.error("[verify-admin-pin] role lookup failed:", roleErr.message);
    return json(500, { error: "Role lookup failed" });
  }
  const callerRole = callerProfile?.role;
  if (callerRole !== "admin" && callerRole !== "sales") {
    return json(403, { error: "Only admin or sales accounts use a dashboard PIN" });
  }
  const callerName = callerProfile?.full_name || callerProfile?.phone || caller.email || "user";

  // ── 4. Parse ──────────────────────────────────────────────────────────
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json(400, { error: "Body must be valid JSON" });
  }
  const action = body.action;
  const accountId = caller.id;

  async function writeAudit(entry: Record<string, unknown>) {
    const { error } = await admin
      .schema("logistics")
      .from("audit_logs")
      .insert({
        user_id: accountId,
        user_name: callerName,
        entity_type: "admin_pin",
        entity_id: accountId,
        category: "security",
        source: "dashboard",
        metadata: { via: "edge:verify-admin-pin" },
        ...entry,
      });
    if (error) console.warn("[verify-admin-pin] audit insert failed:", error.message);
  }

  async function loadRow() {
    const { data, error } = await admin
      .schema("logistics")
      .from("admin_pins")
      .select("account_id, pin_hash, failed_attempts, locked_until")
      .eq("account_id", accountId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as
      | { account_id: string; pin_hash: string; failed_attempts: number; locked_until: string | null }
      | null;
  }

  function lockoutRemainingMs(row: { locked_until: string | null }): number {
    if (!row.locked_until) return 0;
    const until = new Date(row.locked_until).getTime();
    const rem = until - Date.now();
    return rem > 0 ? rem : 0;
  }

  // Records a failed verify/current-pin attempt, applying the 3-strike lock.
  async function registerFailure(row: { failed_attempts: number }) {
    const next = (row.failed_attempts || 0) + 1;
    if (next >= MAX_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCKOUT_MS).toISOString();
      await admin.schema("logistics").from("admin_pins")
        .update({ failed_attempts: 0, locked_until: lockedUntil, updated_at: new Date().toISOString() })
        .eq("account_id", accountId);
      await writeAudit({
        action_type: "LOCKOUT",
        description: `Dashboard PIN locked for 5 min after ${MAX_ATTEMPTS} wrong attempts`,
      });
      return { locked: true, attemptsLeft: 0 };
    }
    await admin.schema("logistics").from("admin_pins")
      .update({ failed_attempts: next, updated_at: new Date().toISOString() })
      .eq("account_id", accountId);
    await writeAudit({
      action_type: "BLOCKED",
      description: `Wrong dashboard PIN (${next}/${MAX_ATTEMPTS})`,
    });
    return { locked: false, attemptsLeft: MAX_ATTEMPTS - next };
  }

  try {
    // ── IS-SET ────────────────────────────────────────────────────────
    if (action === "is-set") {
      const row = await loadRow();
      return json(200, { isSet: !!row });
    }

    // ── SET (first-time only) ───────────────────────────────────────────
    if (action === "set") {
      if (!isSixDigits(body.pin)) {
        return json(400, { error: `PIN must be exactly ${PIN_LENGTH} digits.` });
      }
      const existing = await loadRow();
      if (existing) {
        return json(409, { error: "A PIN is already set. Use “Change PIN” instead." });
      }
      const hash = await bcrypt.hash(String(body.pin).trim(), BCRYPT_ROUNDS);
      const { error } = await admin.schema("logistics").from("admin_pins").insert({
        account_id: accountId,
        pin_hash: hash,
        failed_attempts: 0,
        locked_until: null,
      });
      if (error) return json(500, { error: `Failed to store PIN: ${error.message}` });
      await writeAudit({ action_type: "CREATE", description: "Dashboard PIN set" });
      return json(200, { success: true });
    }

    // ── CHANGE (requires current PIN) ──────────────────────────────────
    if (action === "change") {
      if (!isSixDigits(body.new_pin)) {
        return json(400, { error: `New PIN must be exactly ${PIN_LENGTH} digits.` });
      }
      const row = await loadRow();
      if (!row) return json(400, { error: "No PIN set yet. Use “Set PIN”." });
      const rem = lockoutRemainingMs(row);
      if (rem > 0) {
        return json(429, { error: "Locked out.", lockedMs: rem });
      }
      if (!isSixDigits(body.current_pin) || !(await bcrypt.compare(String(body.current_pin).trim(), row.pin_hash))) {
        const r = await registerFailure(row);
        return json(403, {
          error: r.locked ? "Too many wrong attempts. Locked for 5 minutes." : "Current PIN is incorrect.",
          attemptsLeft: r.attemptsLeft,
          locked: r.locked,
        });
      }
      const hash = await bcrypt.hash(String(body.new_pin).trim(), BCRYPT_ROUNDS);
      const { error } = await admin.schema("logistics").from("admin_pins")
        .update({ pin_hash: hash, failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() })
        .eq("account_id", accountId);
      if (error) return json(500, { error: `Failed to update PIN: ${error.message}` });
      await writeAudit({ action_type: "UPDATE", description: "Dashboard PIN changed" });
      return json(200, { success: true });
    }

    // ── REMOVE (requires current PIN) ──────────────────────────────────
    if (action === "remove") {
      const row = await loadRow();
      if (!row) return json(200, { success: true }); // already absent
      const rem = lockoutRemainingMs(row);
      if (rem > 0) return json(429, { error: "Locked out.", lockedMs: rem });
      if (!isSixDigits(body.current_pin) || !(await bcrypt.compare(String(body.current_pin).trim(), row.pin_hash))) {
        const r = await registerFailure(row);
        return json(403, {
          error: r.locked ? "Too many wrong attempts. Locked for 5 minutes." : "Current PIN is incorrect.",
          attemptsLeft: r.attemptsLeft,
          locked: r.locked,
        });
      }
      const { error } = await admin.schema("logistics").from("admin_pins")
        .delete().eq("account_id", accountId);
      if (error) return json(500, { error: `Failed to remove PIN: ${error.message}` });
      await writeAudit({ action_type: "DELETE", description: "Dashboard PIN removed" });
      return json(200, { success: true });
    }

    // ── VERIFY (gates a sensitive action) ──────────────────────────────
    if (action === "verify") {
      // Burst guard: at most 10 verify calls / minute / account.
      const allowed = await upstashAllow(`ratelimit:adminpin:${accountId}`, 10, 60);
      if (!allowed) return json(429, { error: "Too many attempts. Slow down." });

      const row = await loadRow();
      if (!row) return json(400, { error: "No PIN set", noPin: true });
      const rem = lockoutRemainingMs(row);
      if (rem > 0) return json(429, { error: "Locked out.", lockedMs: rem });

      if (!isSixDigits(body.pin) || !(await bcrypt.compare(String(body.pin).trim(), row.pin_hash))) {
        const r = await registerFailure(row);
        return json(403, {
          error: r.locked ? "Too many wrong attempts. Locked for 5 minutes." : "Wrong PIN.",
          attemptsLeft: r.attemptsLeft,
          locked: r.locked,
          lockedMs: r.locked ? LOCKOUT_MS : 0,
        });
      }
      // Success — clear the failure counter.
      if (row.failed_attempts !== 0 || row.locked_until) {
        await admin.schema("logistics").from("admin_pins")
          .update({ failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() })
          .eq("account_id", accountId);
      }
      return json(200, { success: true });
    }

    return json(400, {
      error: 'action must be "is-set", "set", "change", "remove", or "verify"',
    });
  } catch (e) {
    console.error("[verify-admin-pin] unhandled:", (e as Error).message);
    return json(500, { error: "PIN service error" });
  }
});
