export type CustomerAddress = {
  id: string;
  customer_id: string;
  label: "home" | "work" | "other";
  address_line: string;
  city: string;
  state: string | null;
  pincode: string | null;
  is_default: boolean;
  created_at: string;
};

export const LABEL_NAMES: Record<"home" | "work" | "other", string> = {
  home: "Home",
  work: "Work",
  other: "Other",
};

export async function fetchAddresses(phone: string): Promise<CustomerAddress[]> {
  const response = await fetch(
    `/api/customer-addresses?phone=${encodeURIComponent(phone)}`,
  );
  if (!response.ok) return [];
  const data = await response.json();
  return data.addresses || [];
}

export async function createAddress(
  phone: string,
  address: Omit<CustomerAddress, "id" | "customer_id" | "created_at">,
): Promise<CustomerAddress | null> {
  const response = await fetch(
    `/api/customer-addresses?phone=${encodeURIComponent(phone)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(address),
    },
  );
  if (!response.ok) return null;
  const data = await response.json();
  return data.address || null;
}

export async function updateAddress(
  phone: string,
  id: string,
  updates: Partial<Omit<CustomerAddress, "id" | "customer_id" | "created_at">>,
): Promise<CustomerAddress | null> {
  const response = await fetch(
    `/api/customer-addresses/${id}?phone=${encodeURIComponent(phone)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    },
  );
  if (!response.ok) return null;
  const data = await response.json();
  return data.address || null;
}

export type DeleteAddressResult =
  | { ok: true }
  | { ok: false; error: string; code?: string };

export async function deleteAddress(
  phone: string,
  id: string,
): Promise<DeleteAddressResult> {
  const response = await fetch(
    `/api/customer-addresses/${id}?phone=${encodeURIComponent(phone)}`,
    { method: "DELETE" },
  );
  if (response.ok) return { ok: true };
  // Try to surface the server's reason (e.g. "address_in_use"). Fall back
  // to a generic message when the body isn't JSON.
  let error = "Could not delete address.";
  let code: string | undefined;
  try {
    const data = await response.json();
    if (data?.error) error = data.error;
    if (data?.code) code = data.code;
  } catch { /* ignore */ }
  return { ok: false, error, code };
}

export function formatAddressPreview(
  address: CustomerAddress,
): string {
  const parts = [address.address_line];
  if (address.city) parts.push(address.city);
  if (address.pincode) parts.push(address.pincode);
  return parts.join(", ");
}

/**
 * Best-effort mirror of a checkout-entered address into the customer's
 * address book (`customer_addresses`). Called from the checkout address
 * step so an address typed there also appears at /account/addresses and
 * prefills future checkouts — closing the round-trip.
 *
 * Contract: NEVER throws, NEVER rethrows. All failures — bad phone,
 * network error, 4xx/5xx from the API, JSON parse — are swallowed. This
 * function must not block or break the checkout submit / payment flow;
 * the order + Razorpay path is the priority, address-book mirroring is
 * secondary.
 *
 * Dedup: fetches existing addresses first and skips the insert when a
 * whitespace-normalized case-insensitive match on (label, address_line,
 * city, pincode) already exists.
 */
export async function upsertAddressToBookBestEffort(
  phone: string,
  input: {
    label: string;           // "Home" | "Work" | "Other" | custom text
    addressLine: string;     // may be free-form (checkout's addressLine)
    area?: string;           // checkout has a separate area/locality — folded in
    city: string;
    pincode: string;
  },
): Promise<void> {
  try {
    const phoneDigits = (phone || "").replace(/\D/g, "");
    if (phoneDigits.length !== 10) return;

    // The customer_addresses.label column is a tri-value enum
    // ('home' | 'work' | 'other'). Custom labels from checkout ("Mom's
    // place") map to 'other' — the string itself isn't persisted here,
    // but the order still carries the label prefix in delivery_address.
    const raw = (input.label || "").trim().toLowerCase();
    const label: "home" | "work" | "other" =
      raw === "home" ? "home" : raw === "work" ? "work" : "other";

    // Combine addressLine + area into one line — customer_addresses has
    // no separate area column and the standalone page treats
    // address_line as the full free-form line.
    const line = input.addressLine.trim();
    const area = (input.area ?? "").trim();
    const address_line = area ? `${line}, ${area}` : line;
    const city = input.city.trim();
    const pincode = input.pincode.trim();

    if (!address_line || !city) return;

    // Dedup — fetch existing rows and short-circuit on a match. If the
    // GET fails we still attempt the POST; worst case is a duplicate row
    // (rare and non-destructive).
    let existing: CustomerAddress[] = [];
    try {
      const r = await fetch(
        `/api/customer-addresses?phone=${encodeURIComponent(phoneDigits)}`,
      );
      if (r.ok) {
        const data = await r.json();
        existing = data.addresses || [];
      }
    } catch { /* ignore, proceed to POST */ }

    const norm = (s: string | null | undefined) =>
      (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    const dup = existing.some(
      (a) =>
        a.label === label &&
        norm(a.address_line) === norm(address_line) &&
        norm(a.city) === norm(city) &&
        (a.pincode ?? "") === pincode,
    );
    if (dup) return;

    await fetch(
      `/api/customer-addresses?phone=${encodeURIComponent(phoneDigits)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          address_line,
          city,
          state: null,
          pincode: pincode || null,
          // Never overwrite a user's chosen default — an address entered
          // at checkout enters the book as non-default so their existing
          // default (if any) stays authoritative.
          is_default: false,
        }),
      },
    );
  } catch {
    /* swallow — best-effort */
  }
}
