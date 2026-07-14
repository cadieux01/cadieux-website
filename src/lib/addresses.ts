// Client-side helpers for the shared customer address book.
//
// After the address-unification migration these helpers hit
// /api/customer-addresses which reads/writes the SAME `public.addresses`
// rows as the mobile app's /api/mobile/addresses. Website + app now
// share one book per phone.

export type CustomerAddress = {
  id: string;
  customer_id: string;
  label: string;          // free text, 1-40 chars (was a 3-value enum)
  full_name: string;
  phone: string | null;
  line1: string;
  area: string;
  city: string;
  pincode: string;
  is_default: boolean;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
};

export type CustomerAddressInput = {
  label: string;
  full_name: string;
  phone?: string;
  line1: string;
  area: string;
  city: string;
  pincode: string;
  is_default?: boolean;
  latitude?: number | null;
  longitude?: number | null;
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
  address: CustomerAddressInput,
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
  updates: Partial<CustomerAddressInput>,
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
  let error = "Could not delete address.";
  let code: string | undefined;
  try {
    const data = await response.json();
    if (data?.error) error = data.error;
    if (data?.code) code = data.code;
  } catch { /* ignore */ }
  return { ok: false, error, code };
}

export function formatAddressPreview(address: CustomerAddress): string {
  const parts = [address.line1];
  if (address.area) parts.push(address.area);
  if (address.city) parts.push(address.city);
  if (address.pincode) parts.push(address.pincode);
  return parts.join(", ");
}

/**
 * Best-effort mirror of a checkout-entered address into the customer's
 * shared address book (`public.addresses`). Called from the checkout
 * address step so an address typed there also appears at
 * /account/addresses AND the mobile app — closing the round-trip.
 *
 * Contract: NEVER throws. All failures are swallowed. Must not block
 * or break checkout submit / payment; order + Razorpay path is priority.
 *
 * Dedup: fetches existing addresses first and skips the insert when a
 * whitespace-normalized case-insensitive match on (label, line1, area,
 * city, pincode) already exists.
 */
export async function upsertAddressToBookBestEffort(
  phone: string,
  input: {
    label: string;
    fullName: string;
    line1: string;
    area: string;
    city: string;
    pincode: string;
  },
): Promise<void> {
  try {
    const phoneDigits = (phone || "").replace(/\D/g, "").slice(-10);
    if (phoneDigits.length !== 10) return;

    const label = (input.label || "").trim().slice(0, 40);
    const fullName = (input.fullName || "").trim();
    const line1 = (input.line1 || "").trim();
    const area = (input.area || "").trim();
    const city = (input.city || "").trim();
    const pincode = (input.pincode || "").trim();

    // Skip if any required field is missing / violates mobile-parity
    // length bounds — the POST would 400 anyway.
    if (
      !label ||
      fullName.length < 2 ||
      line1.length < 3 ||
      area.length < 2 ||
      city.length < 2 ||
      !/^\d{6}$/.test(pincode)
    ) {
      return;
    }

    // Dedup — best-effort GET. On any failure we still POST; the API
    // enforces a unique-label guard so a true duplicate label just 400s
    // (which we swallow).
    let existing: CustomerAddress[] = [];
    try {
      const r = await fetch(
        `/api/customer-addresses?phone=${encodeURIComponent(phoneDigits)}`,
      );
      if (r.ok) {
        const data = await r.json();
        existing = data.addresses || [];
      }
    } catch { /* ignore */ }

    const norm = (s: string | null | undefined) =>
      (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    const dup = existing.some(
      (a) =>
        norm(a.label) === norm(label) &&
        norm(a.line1) === norm(line1) &&
        norm(a.area) === norm(area) &&
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
          full_name: fullName,
          phone: phoneDigits,
          line1,
          area,
          city,
          pincode,
          // Never overwrite user's chosen default — checkout entries
          // arrive as non-default so their existing default (if any)
          // stays authoritative. First-ever address will auto-default
          // server-side.
          is_default: false,
        }),
      },
    );
  } catch {
    /* swallow — best-effort */
  }
}
