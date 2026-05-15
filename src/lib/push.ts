// Expo push-notification helper.
//
// One call: sendPushNotification(customerId, title, body, data?). Looks
// up customers.push_token, posts to https://exp.host/--/api/v2/push/send,
// and clears the token from the DB when Expo reports it's no longer
// valid. Designed to be fire-and-forget from API route handlers — never
// throws, never blocks the user-facing response on push latency.
//
// No Firebase / APNs setup is needed in development: Expo Go uses
// Expo's relay. A standalone production build will need FCM/APNs
// credentials configured in EAS, but this code path is identical.

import { createClient } from "@supabase/supabase-js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// Expo's invalid-token error codes. When we see these, the token is
// dead — clear it from the row so we don't keep retrying.
const INVALID_TOKEN_CODES = new Set([
  "DeviceNotRegistered",
  "InvalidCredentials",
  "ExpoError",
]);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export type PushData = Record<string, string | number | boolean | null>;

type ExpoTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

type ExpoSendResponse = {
  data?: ExpoTicket | ExpoTicket[];
  errors?: { code: string; message: string }[];
};

/**
 * Validate the shape of an Expo push token. Expo tokens start with
 * `ExponentPushToken[` and end with `]`. We're permissive on content
 * because Expo doesn't publish a strict charset.
 */
export function isExpoPushToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^ExponentPushToken\[[^\]]+\]$/.test(value)
  );
}

/**
 * Send a push notification to a customer by ID. Returns true if a
 * delivery was attempted (token existed and Expo accepted the payload),
 * false otherwise. Never throws — failures are logged and swallowed so
 * the caller's main flow is unaffected.
 *
 * `data` is an arbitrary JSON object delivered alongside the notification;
 * the mobile app reads it on tap (e.g. `{ kind: "order", order_id: ... }`)
 * to deep-link the user to the right screen.
 */
export async function sendPushNotification(
  customerId: string,
  title: string,
  body: string,
  data?: PushData,
): Promise<boolean> {
  try {
    const { data: row, error } = await supabaseAdmin
      .from("customers")
      .select("push_token")
      .eq("id", customerId)
      .maybeSingle();

    if (error) {
      console.error("[push] customer lookup failed:", error.message);
      return false;
    }
    if (!row?.push_token || !isExpoPushToken(row.push_token)) {
      // No token registered (yet) — nothing to do. Not an error.
      return false;
    }

    const message = {
      to: row.push_token,
      sound: "default" as const,
      title,
      body,
      data: data ?? {},
    };

    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      console.error("[push] expo http error:", res.status, await res.text());
      return false;
    }

    const json = (await res.json()) as ExpoSendResponse;

    // A single-message send returns `data` as a single ticket; batch
    // sends return an array. Normalize.
    const tickets: ExpoTicket[] = Array.isArray(json.data)
      ? json.data
      : json.data
        ? [json.data]
        : [];

    let cleared = false;
    for (const ticket of tickets) {
      if (ticket.status === "error") {
        const code = ticket.details?.error;
        console.error("[push] ticket error:", code, ticket.message);
        if (code && INVALID_TOKEN_CODES.has(code) && !cleared) {
          await clearPushToken(customerId);
          cleared = true;
        }
      }
    }

    return tickets.some((t) => t.status === "ok");
  } catch (err) {
    console.error("[push] sendPushNotification threw:", err);
    return false;
  }
}

/**
 * Drops an invalid push token from a customer row. Best-effort — errors
 * are logged but not re-raised.
 */
async function clearPushToken(customerId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("customers")
    .update({ push_token: null })
    .eq("id", customerId);
  if (error) {
    console.error("[push] clearPushToken failed:", error.message);
  }
}

/**
 * Convenience: fire-and-forget wrapper used by API route handlers that
 * don't want to await the push call. Just calls sendPushNotification
 * and discards the promise — errors are already swallowed inside.
 */
export function notifyCustomer(
  customerId: string,
  title: string,
  body: string,
  data?: PushData,
): void {
  void sendPushNotification(customerId, title, body, data);
}
