// Live serviceability helper. Reads service_areas via the service-role
// client, cached by Next's data cache under the "service-areas" tag.
// Every admin write to service_areas calls revalidateTag("service-areas")
// so the public /api/service-areas/check picks up changes immediately.

import { unstable_cache } from "next/cache";

import { supabaseAdmin } from "@/lib/admin-auth";

export const SERVICE_AREAS_TAG = "service-areas";

export type ServiceAreaRow = {
  pincode: string;
  area_name: string;
  is_active: boolean;
  added_at: string;
  added_by: string | null;
};

/** Normalises whatever the caller passed to a 6-digit pincode, or null. */
export function normalizePincode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits.length === 6 ? digits : null;
}

const getActiveByPincode = unstable_cache(
  async (pincode: string): Promise<{ area_names: string[] }> => {
    const { data, error } = await supabaseAdmin
      .from("service_areas")
      .select("area_name")
      .eq("pincode", pincode)
      .eq("is_active", true);
    if (error) {
      console.warn("[service-areas] lookup failed:", error.message);
      return { area_names: [] };
    }
    return {
      area_names: (data ?? []).map((r) => r.area_name).filter(Boolean),
    };
  },
  ["service-areas:active-by-pincode"],
  { tags: [SERVICE_AREAS_TAG], revalidate: 300 },
);

export async function isPincodeServiceable(pincode: string): Promise<boolean> {
  const normalized = normalizePincode(pincode);
  if (!normalized) return false;
  const { area_names } = await getActiveByPincode(normalized);
  return area_names.length > 0;
}

export async function lookupServiceArea(
  pincode: string,
): Promise<{ serviceable: boolean; area_names: string[] }> {
  const normalized = normalizePincode(pincode);
  if (!normalized) return { serviceable: false, area_names: [] };
  const { area_names } = await getActiveByPincode(normalized);
  return { serviceable: area_names.length > 0, area_names };
}
