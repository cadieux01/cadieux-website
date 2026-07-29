// Live serviceability helper. Reads service_areas via the service-role
// client, cached by Next's data cache under the "service-areas" tag.
// Every admin write to service_areas calls revalidateTag("service-areas")
// so the public /api/service-areas/check picks up changes immediately.

import { unstable_cache } from "next/cache";

import { supabaseAdmin } from "@/lib/admin-auth";
import { geocodePincode, haversineKm } from "@/lib/geocode";

export const SERVICE_AREAS_TAG = "service-areas";

// Customers within this many km of an active area are auto-approved
// even if their pincode isn't explicitly in service_areas.
export const PROXIMITY_RADIUS_KM = 3;

export type ServiceAreaRow = {
  pincode: string;
  area_name: string;
  is_active: boolean;
  added_at: string;
  added_by: string | null;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  // Prompt 8: `slug` drives /delivery/[area] URLs. Nullable — rows
  // added for checkout serviceability only don't need a public page.
  // `local_note` is human-written area copy, one short paragraph.
  slug: string | null;
  local_note: string | null;
};

/** Normalises whatever the caller passed to a 6-digit pincode, or null. */
export function normalizePincode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits.length === 6 ? digits : null;
}

const getRowsByPincode = unstable_cache(
  async (
    pincode: string,
  ): Promise<{ active: string[]; exists: boolean }> => {
    const { data, error } = await supabaseAdmin
      .from("service_areas")
      .select("area_name, is_active")
      .eq("pincode", pincode);
    if (error) {
      console.warn("[service-areas] lookup failed:", error.message);
      return { active: [], exists: false };
    }
    const rows = data ?? [];
    return {
      exists: rows.length > 0,
      active: rows.filter((r) => r.is_active).map((r) => r.area_name),
    };
  },
  ["service-areas:rows-by-pincode-v2"],
  { tags: [SERVICE_AREAS_TAG], revalidate: 300 },
);

const getActiveGeocoded = unstable_cache(
  async (): Promise<
    Array<{ pincode: string; area_name: string; latitude: number; longitude: number }>
  > => {
    const { data, error } = await supabaseAdmin
      .from("service_areas")
      .select("pincode, area_name, latitude, longitude")
      .eq("is_active", true)
      .not("latitude", "is", null)
      .not("longitude", "is", null);
    if (error) {
      console.warn("[service-areas] geocoded lookup failed:", error.message);
      return [];
    }
    return (data ?? [])
      .filter(
        (r): r is { pincode: string; area_name: string; latitude: number; longitude: number } =>
          typeof r.latitude === "number" && typeof r.longitude === "number",
      );
  },
  ["service-areas:active-geocoded"],
  { tags: [SERVICE_AREAS_TAG], revalidate: 300 },
);

/** Cheap boolean used by checkout pre-flight. Does NOT consult proximity. */
export async function isPincodeServiceable(pincode: string): Promise<boolean> {
  const normalized = normalizePincode(pincode);
  if (!normalized) return false;
  const { active } = await getRowsByPincode(normalized);
  return active.length > 0;
}

export async function lookupServiceArea(
  pincode: string,
): Promise<{ serviceable: boolean; area_names: string[] }> {
  const normalized = normalizePincode(pincode);
  if (!normalized) return { serviceable: false, area_names: [] };
  const { active } = await getRowsByPincode(normalized);
  return { serviceable: active.length > 0, area_names: active };
}

export type ServiceabilityResult =
  | {
      serviceable: true;
      via: "exact";
      area_names: string[];
    }
  | {
      serviceable: true;
      via: "proximity";
      nearest_area: string;
      nearest_pincode: string;
      distance_km: number;
    }
  | {
      serviceable: false;
      reason: "invalid_pincode" | "explicitly_deactivated" | "no_match";
    };

/**
 * Full serviceability resolution including proximity.
 *
 * Order of decisions — important for ITEM 5:
 *   1. Pincode must be 6 digits.
 *   2. If the pincode has ANY rows in service_areas:
 *        - any active row → serviceable via "exact"
 *        - else all rows are inactive → "explicitly_deactivated"
 *          (proximity does NOT override an admin's deliberate pause)
 *   3. Pincode has no row → try proximity. Geocode the pincode, find
 *      the nearest active area with lat/lng. If ≤3km → serviceable via
 *      "proximity". Otherwise → no_match.
 */
export async function resolveServiceability(
  rawPincode: string,
): Promise<ServiceabilityResult> {
  const pincode = normalizePincode(rawPincode);
  if (!pincode) return { serviceable: false, reason: "invalid_pincode" };

  const { exists, active } = await getRowsByPincode(pincode);
  if (active.length > 0) {
    return { serviceable: true, via: "exact", area_names: active };
  }
  if (exists) {
    // Explicit deactivation — request-only, no proximity override.
    return { serviceable: false, reason: "explicitly_deactivated" };
  }

  // No row at all → proximity path.
  const customer = await geocodePincode(pincode);
  if (!customer) return { serviceable: false, reason: "no_match" };

  const candidates = await getActiveGeocoded();
  if (candidates.length === 0) {
    return { serviceable: false, reason: "no_match" };
  }

  let best: { pincode: string; area_name: string; km: number } | null = null;
  for (const c of candidates) {
    const km = haversineKm(customer, c);
    if (!best || km < best.km) {
      best = { pincode: c.pincode, area_name: c.area_name, km };
    }
  }

  if (best && best.km <= PROXIMITY_RADIUS_KM) {
    return {
      serviceable: true,
      via: "proximity",
      nearest_area: best.area_name,
      nearest_pincode: best.pincode,
      distance_km: Math.round(best.km * 100) / 100,
    };
  }
  return { serviceable: false, reason: "no_match" };
}

// ── Prompt 8 (SEO /delivery/[area]) ─────────────────────────────────────
//
// Public page reads for /delivery/[area]. Only rows with a populated
// slug render a page — rows added for checkout serviceability without
// an admin-assigned slug are excluded. Aggregation groups multiple
// pincodes under a single slug (today every slug maps to one row, but
// the schema and page render support N pincodes per area).

export type ServiceAreaGroup = {
  slug: string;
  area_name: string;
  pincodes: string[];
  local_note: string | null;
};

const getSluggedGroups = unstable_cache(
  async (): Promise<ServiceAreaGroup[]> => {
    const { data, error } = await supabaseAdmin
      .from("service_areas")
      .select("slug, area_name, pincode, local_note")
      .eq("is_active", true)
      .not("slug", "is", null)
      .order("slug", { ascending: true });
    if (error) {
      console.warn("[service-areas] slugged lookup failed:", error.message);
      return [];
    }
    const bySlug = new Map<string, ServiceAreaGroup>();
    for (const r of data ?? []) {
      if (!r.slug) continue;
      const existing = bySlug.get(r.slug);
      if (existing) {
        existing.pincodes.push(r.pincode);
      } else {
        bySlug.set(r.slug, {
          slug: r.slug,
          area_name: r.area_name,
          pincodes: [r.pincode],
          local_note: r.local_note,
        });
      }
    }
    const groups = Array.from(bySlug.values());
    for (const g of groups) g.pincodes.sort();
    return groups.sort((a, b) => a.slug.localeCompare(b.slug));
  },
  ["service-areas:slugged-groups"],
  { tags: [SERVICE_AREAS_TAG], revalidate: 3600 },
);

/** All slugged/active area groups — one entry per /delivery/[area] page. */
export async function getServiceAreaGroups(): Promise<ServiceAreaGroup[]> {
  return getSluggedGroups();
}

/** Single group lookup by URL slug — returns null when the slug is not
 *  a known service area (page will `notFound()`). */
export async function getServiceAreaBySlug(
  slug: string,
): Promise<ServiceAreaGroup | null> {
  const groups = await getSluggedGroups();
  return groups.find((g) => g.slug === slug) ?? null;
}

/** Display-time normalisation for `area_name`. DB stores what admin
 *  typed. Only fully-uppercase strings ("KURMANA PALEM") are folded
 *  to title-case ("Kurmana Palem"). Mixed-case inputs like "MVP Colony"
 *  are already deliberate and pass through unchanged — folding them
 *  would produce "Mvp Colony" and lose the acronym.
 *  Used for H1, OG title, and inline copy — the slug is independent. */
export function displayAreaName(raw: string): string {
  if (raw !== raw.toUpperCase()) return raw;
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
