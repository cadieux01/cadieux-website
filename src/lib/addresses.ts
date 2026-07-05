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
