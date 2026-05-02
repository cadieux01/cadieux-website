// Server-side Cloudflare Turnstile verification.
// Posts the user's token to the Cloudflare siteverify endpoint and returns
// whether the request came from a real human. Fails closed.

export async function verifyTurnstileToken(token: string): Promise<boolean> {
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
