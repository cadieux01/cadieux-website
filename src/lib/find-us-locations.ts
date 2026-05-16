// Cadieux locations directory.
//
// Two collections matter for the public /find-us page:
//   1. STALLS — the 10 owned-and-operated Cadieux pickup counters across
//      Visakhapatnam.
//   2. COMMUNITIES — the 50 gated residential complexes where Cadieux
//      delivers on a fixed weekly rotation.
//
// Coordinates are intentional and feed the Google Maps markers. Approximate
// to ~50m is fine; the marker is a "find us nearby" hint, not a navigational
// fix. The "Get Directions" button on each card hands off to Google Maps
// with a `name, address` text query — Google geocodes from there, so the
// lat/lng drift below the map does not affect navigation accuracy.
//
// Future-proof: `type` accepts five values so the UI can render disabled
// tabs for categories that go live later (gyms, retail stores, fitness
// clubs).

export type CadieuxLocationType =
  | "stall"
  | "community"
  | "gym"
  | "store"
  | "club";

export interface CadieuxLocation {
  id: string;
  name: string;
  type: CadieuxLocationType;
  zone: string;
  area: string;
  address: string;
  lat: number;
  lng: number;
  pincode?: string;
  rating?: number;
  notes?: string;
}

// Visakhapatnam metro zones, ordered roughly north → south along the city.
// Used to group locations in the list view; matches the URL-friendly slugs
// used by the existing store-locator.
export const ZONES = [
  "Madhurawada",
  "Rushikonda",
  "MVP Colony",
  "Siripuram",
  "Beach Road",
  "Seethammadhara",
  "Dwaraka Nagar",
  "Asilmetta",
  "Gajuwaka",
] as const;

export type Zone = (typeof ZONES)[number];

// Pincodes Cadieux currently delivers to. Vizag city core spans 530001–530052;
// outliers (Anakapalle 531001 etc) are intentionally excluded — the customer
// will hit "Sorry, we don't deliver here yet" on the pincode checker.
export const SERVED_PINCODES: ReadonlyArray<string> = Array.from(
  { length: 52 },
  (_, i) => String(530001 + i),
);

// ---- 10 Cadieux stalls ----------------------------------------------------
// Lat/lng tuned to the named landmark; double-check via Google Maps before
// editing. The `area` is the neighbourhood shown in the card sub-line; the
// `zone` is the grouping bucket.
const STALLS: CadieuxLocation[] = [
  {
    id: "stall-madhurawada",
    name: "Cadieux Madhurawada",
    type: "stall",
    zone: "Madhurawada",
    area: "Madhurawada",
    address: "NH16 Service Road, Madhurawada, Visakhapatnam 530048",
    lat: 17.8167,
    lng: 83.3667,
    pincode: "530048",
    rating: 4.7,
    notes: "Open daily · 7 AM – 9 PM",
  },
  {
    id: "stall-rushikonda",
    name: "Cadieux Rushikonda",
    type: "stall",
    zone: "Rushikonda",
    area: "Rushikonda Beach Road",
    address: "Beach Road, Rushikonda, Visakhapatnam 530045",
    lat: 17.7833,
    lng: 83.3833,
    pincode: "530045",
    rating: 4.8,
    notes: "Open daily · 7 AM – 9 PM",
  },
  {
    id: "stall-mvp",
    name: "Cadieux MVP Colony",
    type: "stall",
    zone: "MVP Colony",
    area: "MVP Colony Sector 4",
    address: "Sector 4, MVP Colony, Visakhapatnam 530017",
    lat: 17.7474,
    lng: 83.3411,
    pincode: "530017",
    rating: 4.7,
    notes: "Open daily · 7 AM – 9 PM",
  },
  {
    id: "stall-siripuram",
    name: "Cadieux Siripuram",
    type: "stall",
    zone: "Siripuram",
    area: "Siripuram Junction",
    address: "Siripuram Junction, Waltair Main Rd, Visakhapatnam 530003",
    lat: 17.7167,
    lng: 83.3167,
    pincode: "530003",
    rating: 4.8,
    notes: "Open daily · 7 AM – 9 PM",
  },
  {
    id: "stall-beachroad",
    name: "Cadieux Beach Road",
    type: "stall",
    zone: "Beach Road",
    area: "Ramakrishna Beach",
    address: "Beach Rd, near RK Beach, Visakhapatnam 530002",
    lat: 17.7106,
    lng: 83.3267,
    pincode: "530002",
    rating: 4.6,
    notes: "Open daily · 6 AM – 10 PM",
  },
  {
    id: "stall-seethammadhara",
    name: "Cadieux Seethammadhara",
    type: "stall",
    zone: "Seethammadhara",
    area: "Seethammadhara Main Road",
    address: "Seethammadhara Main Rd, Visakhapatnam 530013",
    lat: 17.7308,
    lng: 83.3253,
    pincode: "530013",
    rating: 4.7,
    notes: "Open daily · 7 AM – 9 PM",
  },
  {
    id: "stall-dwarakanagar",
    name: "Cadieux Dwaraka Nagar",
    type: "stall",
    zone: "Dwaraka Nagar",
    area: "Dwaraka Nagar Main Road",
    address: "Dwaraka Nagar Main Rd, Visakhapatnam 530016",
    lat: 17.7228,
    lng: 83.3022,
    pincode: "530016",
    rating: 4.6,
    notes: "Open daily · 8 AM – 10 PM",
  },
  {
    id: "stall-asilmetta",
    name: "Cadieux Asilmetta",
    type: "stall",
    zone: "Asilmetta",
    area: "Asilmetta Junction",
    address: "Asilmetta Junction, Visakhapatnam 530003",
    lat: 17.7222,
    lng: 83.3097,
    pincode: "530003",
    rating: 4.5,
    notes: "Open daily · 7 AM – 9 PM",
  },
  {
    id: "stall-gajuwaka",
    name: "Cadieux Gajuwaka",
    type: "stall",
    zone: "Gajuwaka",
    area: "Gajuwaka BC Road",
    address: "BC Road, Gajuwaka, Visakhapatnam 530026",
    lat: 17.6792,
    lng: 83.2078,
    pincode: "530026",
    rating: 4.6,
    notes: "Open daily · 7 AM – 9 PM",
  },
  {
    id: "stall-pmpalem",
    name: "Cadieux PM Palem",
    type: "stall",
    zone: "Madhurawada",
    area: "PM Palem",
    address: "PM Palem, Madhurawada, Visakhapatnam 530041",
    lat: 17.8050,
    lng: 83.3850,
    pincode: "530041",
    rating: 4.7,
    notes: "Open daily · 7 AM – 9 PM",
  },
];

// ---- 50 gated communities -------------------------------------------------
// Helper to keep the table below scannable. Address auto-suffixes the city.
function community(
  id: string,
  name: string,
  zone: Zone,
  area: string,
  pincode: string,
  lat: number,
  lng: number,
  notes?: string,
): CadieuxLocation {
  return {
    id,
    name,
    type: "community",
    zone,
    area,
    address: `${name}, ${area}, Visakhapatnam ${pincode}`,
    lat,
    lng,
    pincode,
    notes,
  };
}

const COMMUNITIES: CadieuxLocation[] = [
  // Madhurawada (10)
  community("c-md-01", "Vasishta Hill Springs",        "Madhurawada", "Madhurawada",      "530048", 17.8195, 83.3654),
  community("c-md-02", "Hill Ridge County",            "Madhurawada", "Yendada",          "530045", 17.7919, 83.3791),
  community("c-md-03", "My Home Avatar",               "Madhurawada", "Kommadi",          "530048", 17.8011, 83.3530),
  community("c-md-04", "Aparna Westside",              "Madhurawada", "PM Palem",         "530041", 17.8040, 83.3830),
  community("c-md-05", "Vasishta La Mer",              "Madhurawada", "Endada",           "530045", 17.7898, 83.3811),
  community("c-md-06", "NCC Urban One",                "Madhurawada", "Madhurawada",      "530048", 17.8132, 83.3712),
  community("c-md-07", "Jayabheri The Peak",           "Madhurawada", "Madhurawada",      "530048", 17.8245, 83.3601),
  community("c-md-08", "Hill County Phase II",         "Madhurawada", "Yendada",          "530045", 17.7950, 83.3760),
  community("c-md-09", "Greenfield Pinevalley",        "Madhurawada", "Kommadi",          "530048", 17.8067, 83.3525),
  community("c-md-10", "MARS Saritha Sarovar",         "Madhurawada", "Madhurawada",      "530048", 17.8089, 83.3678),

  // Rushikonda (4)
  community("c-rk-01", "Sai Beach Residency",          "Rushikonda",  "Rushikonda",       "530045", 17.7826, 83.3855),
  community("c-rk-02", "Visakha Valley View",          "Rushikonda",  "Rushikonda Hills", "530045", 17.7872, 83.3826),
  community("c-rk-03", "Sunrise Heights",              "Rushikonda",  "Mangamaripeta",    "530045", 17.7755, 83.3872),
  community("c-rk-04", "Ocean Crest Towers",           "Rushikonda",  "Rushikonda",       "530045", 17.7841, 83.3818),

  // MVP Colony (8)
  community("c-mv-01", "MVP Heights",                  "MVP Colony",  "MVP Sector 4",     "530017", 17.7480, 83.3415),
  community("c-mv-02", "Vijetha Towers",               "MVP Colony",  "MVP Sector 7",     "530017", 17.7501, 83.3422),
  community("c-mv-03", "Sri Sai MVP Residency",        "MVP Colony",  "MVP Sector 8",     "530017", 17.7522, 83.3438),
  community("c-mv-04", "Aparna MVP Sarovar",           "MVP Colony",  "MVP Sector 10",    "530017", 17.7540, 83.3460),
  community("c-mv-05", "Sumadhura Anandam",            "MVP Colony",  "MVP Sector 2",     "530017", 17.7450, 83.3398),
  community("c-mv-06", "MVP Excellency",               "MVP Colony",  "MVP Sector 5",     "530017", 17.7488, 83.3431),
  community("c-mv-07", "Pragati MVP Greens",           "MVP Colony",  "MVP Sector 11",    "530017", 17.7558, 83.3470),
  community("c-mv-08", "Madhuri Residency",            "MVP Colony",  "MVP Colony",       "530017", 17.7468, 83.3408),

  // Siripuram (5)
  community("c-sp-01", "Siripuram Heritage",           "Siripuram",   "Siripuram",        "530003", 17.7180, 83.3175),
  community("c-sp-02", "Sai Siripuram Towers",         "Siripuram",   "Waltair Uplands",  "530003", 17.7195, 83.3158),
  community("c-sp-03", "The Park Residences",          "Siripuram",   "Siripuram",        "530003", 17.7170, 83.3183),
  community("c-sp-04", "Waltair Royale",               "Siripuram",   "Waltair Main Rd",  "530003", 17.7210, 83.3140),
  community("c-sp-05", "Daspalla Heights",             "Siripuram",   "Daspalla Hills",   "530003", 17.7150, 83.3198),

  // Beach Road (5)
  community("c-br-01", "RK Beach Towers",              "Beach Road",  "Ramakrishna Beach","530002", 17.7110, 83.3275),
  community("c-br-02", "Beachfront Heights",           "Beach Road",  "Pandurangapuram",  "530003", 17.7166, 83.3261),
  community("c-br-03", "The Coast Residences",         "Beach Road",  "Lawsons Bay",      "530017", 17.7232, 83.3346),
  community("c-br-04", "Sai Sea View",                 "Beach Road",  "Kirlampudi",       "530017", 17.7252, 83.3392),
  community("c-br-05", "Marina Skyline",               "Beach Road",  "Jodugullapalem",   "530003", 17.7298, 83.3415),

  // Seethammadhara (4)
  community("c-st-01", "Seethammadhara Sarovar",       "Seethammadhara","Seethammadhara",  "530013", 17.7315, 83.3268),
  community("c-st-02", "Vasishta Skyline",             "Seethammadhara","HB Colony",       "530013", 17.7298, 83.3232),
  community("c-st-03", "Sai Tirumala Heights",         "Seethammadhara","P&T Colony",      "530013", 17.7333, 83.3289),
  community("c-st-04", "Royal Park Residency",         "Seethammadhara","Seethammadhara",  "530013", 17.7301, 83.3258),

  // Dwaraka Nagar (4)
  community("c-dn-01", "Dwaraka Towers",               "Dwaraka Nagar","Dwaraka Nagar",    "530016", 17.7235, 83.3030),
  community("c-dn-02", "Sri Nagar Heights",            "Dwaraka Nagar","Sri Nagar",        "530016", 17.7218, 83.3045),
  community("c-dn-03", "Resapuvanipalem Residency",    "Dwaraka Nagar","Resapuvanipalem",  "530013", 17.7252, 83.3018),
  community("c-dn-04", "Allipuram Skyline",            "Dwaraka Nagar","Allipuram",        "530004", 17.7165, 83.3015),

  // Asilmetta (3)
  community("c-as-01", "Asilmetta Plaza Residency",    "Asilmetta",    "Asilmetta",        "530003", 17.7230, 83.3105),
  community("c-as-02", "Diamond Park Towers",          "Asilmetta",    "Diamond Park",     "530003", 17.7218, 83.3092),
  community("c-as-03", "Asilmetta Crown",              "Asilmetta",    "Asilmetta",        "530003", 17.7242, 83.3115),

  // Gajuwaka (7)
  community("c-gj-01", "Gajuwaka Heights",             "Gajuwaka",     "Gajuwaka",         "530026", 17.6800, 83.2090),
  community("c-gj-02", "Steel City Residency",         "Gajuwaka",     "Kurmannapalem",    "530046", 17.6650, 83.1985),
  community("c-gj-03", "Visakha Greens",               "Gajuwaka",     "BHEL Township",    "530012", 17.7068, 83.2310),
  community("c-gj-04", "NAD Residency",                "Gajuwaka",     "NAD Junction",     "530009", 17.7280, 83.2360),
  community("c-gj-05", "Sai Industrial Heights",       "Gajuwaka",     "Auto Nagar",       "530012", 17.7012, 83.2245),
  community("c-gj-06", "South Vizag Towers",           "Gajuwaka",     "Gajuwaka",         "530026", 17.6815, 83.2070),
  community("c-gj-07", "Marripalem Residency",         "Gajuwaka",     "Marripalem",       "530018", 17.7392, 83.2545),
];

if (process.env.NODE_ENV !== "production") {
  // Hard guard: copy-paste mistakes that duplicate IDs would silently merge
  // markers / cards in the UI. Catch in dev.
  const ids = new Set<string>();
  for (const loc of [...STALLS, ...COMMUNITIES]) {
    if (ids.has(loc.id)) {
      // eslint-disable-next-line no-console
      console.warn("[find-us] duplicate location id:", loc.id);
    }
    ids.add(loc.id);
  }
}

export const LOCATIONS: CadieuxLocation[] = [...STALLS, ...COMMUNITIES];

export const STALL_COUNT = STALLS.length;
export const COMMUNITY_COUNT = COMMUNITIES.length;

/**
 * Returns the nearest stall to a given lat/lng. Used by the pincode checker
 * to recommend a pickup point when a community is also nearby. Tiny set
 * (10 stalls) so a linear scan is correct and fast.
 */
export function nearestStall(
  lat: number,
  lng: number,
): { stall: CadieuxLocation; distanceKm: number } | null {
  let best: { stall: CadieuxLocation; distanceKm: number } | null = null;
  for (const s of STALLS) {
    const d = haversineKm(lat, lng, s.lat, s.lng);
    if (!best || d < best.distanceKm) best = { stall: s, distanceKm: d };
  }
  return best;
}

/**
 * Great-circle distance, kilometres. Sufficient for "nearest stall" picks
 * within a single city; we don't need ellipsoid accuracy.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function isServedPincode(pincode: string): boolean {
  return SERVED_PINCODES.includes(pincode.trim());
}
