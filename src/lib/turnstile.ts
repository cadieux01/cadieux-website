// Server-side Cloudflare Turnstile verification.
// Posts the user's token to the Cloudflare siteverify endpoint and returns
// whether the request came from a real human. Fails closed.

/**
 * Preview-only escape hatch. Cloudflare Turnstile rejects challenges on
 * unlisted *.vercel.app preview domains, which makes the checkout OTP flow
 * untestable on a Preview deploy. This lets a Preview build skip the
 * Cloudflare round-trip — but it is IMPOSSIBLE on production:
 *
 *   1. `VERCEL_ENV` is injected by Vercel itself and equals "production" on
 *      every production deploy. The bypass requires it to be anything BUT
 *      "production", so a production deploy can never satisfy it.
 *   2. It is also opt-in: the explicit `TURNSTILE_BYPASS_PREVIEW=1` flag must
 *      be set (intended for the Preview environment only). Production never
 *      sets it.
 *
 * Both conditions must hold, so production stays fully enforced even if the
 * flag were ever set there by mistake.
 */
function turnstileBypassEnabled(): boolean {
  return (
    process.env.VERCEL_ENV !== "production" &&
    process.env.TURNSTILE_BYPASS_PREVIEW === "1"
  );
}

export async function verifyTurnstileToken(token: string): Promise<boolean> {
  if (turnstileBypassEnabled()) {
    console.warn(
      "⚠️  Turnstile verification BYPASSED (non-production preview, TURNSTILE_BYPASS_PREVIEW=1)",
    );
    return true;
  }

  const secretKey = process.env.TURNSTILE_SECRET_KEY;

  if (!secretKey) {
    console.error("❌ TURNSTILE_SECRET_KEY not configured");
    return false;
  }

  if (!token) {
    console.error("❌ No Turnstile token provided");
    return false;
  }

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: secretKey,
          response: token,
        }),
      }
    );

    const data = await response.json();

    if (!data.success) {
      console.error("❌ Turnstile verification failed:", data["error-codes"]);
      return false;
    }

    console.log("✅ Turnstile verification passed");
    return true;
  } catch (error) {
    console.error("❌ Turnstile API error:", error);
    return false;
  }
}
