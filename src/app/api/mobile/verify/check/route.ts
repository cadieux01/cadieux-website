// /api/mobile/verify/check
// Mobile-equivalent of /api/verify/check.
//
// Returns the HMAC token in the JSON body — NO Set-Cookie. App stores
// the token in AsyncStorage and sends it as `Authorization: Bearer …`
// on subsequent calls. Token TTL = 30 days (vs. 30 min for web cookie);
// signing uses the exact same `signPhoneCookie` so cookies and bearer
// tokens are interchangeable on the server side via `getVerifiedPhone`.
//
// MOBILE_APP_KEY is a friction layer, not a real secret. See the matching
// note in /api/mobile/verify/send.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  MOBILE_TOKEN_TTL_MS,
  isValidMobileAppKey,
  normalizePhone,
  signPhoneCookie,
} from "@/lib/phone-cookie";
import { verifyOtp } from "@/lib/otp-store";

// Admin client used to stamp age_verified_at on the customer row when
// the user ticks the 18+ confirmation during OTP verification. RLS is
// bypassed by design — this endpoint is server-only and the upsert
// touches a single row matched on the just-verified phone number.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export async function POST(req: NextRequest) {
  if (!process.env.MOBILE_APP_KEY) {
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 }
    );
  }

  const presented = req.headers.get("x-app-key");
  if (!isValidMobileAppKey(presented)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "");
  const code = String(body.code ?? "").replace(/\D/g, "");
  const ageVerified = body.age_verified === true;

  if (!phone || !code) {
    return NextResponse.json(
      { ok: false, error: "Missing fields" },
      { status: 400 }
    );
  }
  if (!ageVerified) {
    return NextResponse.json(
      {
        ok: false,
        error: "Please confirm you are 18 years or older to continue.",
        code: "age_not_verified",
      },
      { status: 400 }
    );
  }

  const to = normalizePhone(phone);

  // ───────── Play review bypass — remove after approval ─────────
  // When REVIEW_TEST_PHONE + REVIEW_TEST_CODE are set and both match,
  // skip the OTP verification and fall through to the exact same success
  // path a real verified code would run (age stamp + signed 30-day bearer
  // token). No effect unless both env vars are configured.
  const reviewTestPhone = process.env.REVIEW_TEST_PHONE;
  const reviewTestCode = process.env.REVIEW_TEST_CODE;
  const isReviewBypass =
    !!reviewTestPhone &&
    !!reviewTestCode &&
    to === normalizePhone(reviewTestPhone) &&
    code === reviewTestCode;
  // ──────────────────────────────────────────────────────────────

  try {
    if (!isReviewBypass) {
      const result = await verifyOtp(to, code);
      if (!result.ok) {
        if (result.reason === "too_many_attempts") {
          return NextResponse.json(
            { ok: false, error: "Too many attempts. Try again later." },
            { status: 429 }
          );
        }
        return NextResponse.json(
          { ok: false, error: "Invalid code." },
          { status: 401 }
        );
      }
    }

    // Stamp age_verified_at on the customer record once the OTP is approved.
    // - Match by the 10-digit local phone (same format used elsewhere).
    // - Insert a minimal row if none exists; otherwise only set the timestamp
    //   when it's still null so we keep the original confirmation date.
    // - Non-fatal: failure here doesn't block sign-in. The order-placement
    //   path will create / update the row again with full_name + city.
    const phoneLocal = to.replace(/^\+?91/, "").replace(/\D/g, "");
    if (phoneLocal.length === 10) {
      try {
        const { data: existing } = await supabaseAdmin
          .from("customers")
          .select("id, age_verified_at")
          .eq("phone", phoneLocal)
          .maybeSingle();

        if (!existing) {
          await supabaseAdmin
            .from("customers")
            .insert({ phone: phoneLocal, age_verified_at: new Date().toISOString() });
        } else if (!existing.age_verified_at) {
          await supabaseAdmin
            .from("customers")
            .update({ age_verified_at: new Date().toISOString() })
            .eq("id", existing.id);
        }
      } catch (e) {
        console.error("[mobile/verify/check] age_verified_at upsert failed:", e);
      }
    }

    const exp = Date.now() + MOBILE_TOKEN_TTL_MS;
    const token = signPhoneCookie(to, exp);
    return NextResponse.json({ ok: true, token, exp });
  } catch (err) {
    console.error("mobile/verify/check error:", err);
    return NextResponse.json(
      { ok: false, error: "Verification failed." },
      { status: 500 }
    );
  }
}
