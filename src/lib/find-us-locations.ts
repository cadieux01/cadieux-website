// Cadieux locations directory.
//
// Two collections matter for the public /find-us page:
//   1. The 10 owned-and-operated Cadieux stalls across Visakhapatnam.
//   2. The 50 gated residential communities Cadieux delivers to on a fixed
//      weekly rotation.
//
// Coordinates feed the Google Maps markers. The "Get Directions" button on
// each card hands off to Google Maps with a `name, area, Visakhapatnam`
// text query — Google geocodes from there, so a few metres of marker drift
// does not affect navigation accuracy.
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
  latitude: number;
  longitude: number;
  rating?: number;
  notes?: string;
}

// Visakhapatnam zones, ordered roughly north → south along the city.
// Used to group locations in the list view. Must contain every zone string
// used in LOCATIONS below; unknown zones bucket at the bottom.
export const ZONES = [
  "Bheemili",
  "Pendurthi",
  "PM Palem",
  "Madhurawada",
  "Rushikonda",
  "Yendada",
  "MVP Colony",
  "Seethammadhara",
  "Siripuram",
  "Dwaraka Nagar",
  "Akkayyapalem",
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

export const LOCATIONS: CadieuxLocation[] = [
  // ===== 10 STALLS =====
  { id: "stall-01", name: "Cadieux Kitchen + Flagship Stall",  type: "stall", zone: "PM Palem",        area: "PM Palem / Bakkanapalem",              latitude: 17.8096875,         longitude: 83.33767189999999, notes: "Our flagship — also the kitchen." },
  { id: "stall-02", name: "Cadieux Madhurawada Stall",          type: "stall", zone: "Madhurawada",     area: "Madhurawada / Kommadi / IT Park",      latitude: 17.8170275,         longitude: 83.3422987 },
  { id: "stall-03", name: "Cadieux Rushikonda Stall",           type: "stall", zone: "Rushikonda",      area: "Rushikonda / Beach Rd North",          latitude: 17.7925467,         longitude: 83.38420219999999 },
  { id: "stall-04", name: "Cadieux Yendada Stall",              type: "stall", zone: "Yendada",         area: "Yendada / Sagar Nagar / IT Corridor",  latitude: 17.7751229,         longitude: 83.3632739 },
  { id: "stall-05", name: "Cadieux MVP Colony Stall",           type: "stall", zone: "MVP Colony",      area: "MVP Sectors 1-12",                     latitude: 17.746291,          longitude: 83.3383315 },
  { id: "stall-06", name: "Cadieux Seethammadhara Stall",       type: "stall", zone: "Seethammadhara",  area: "Seethammadhara / HB Colony / Pedda Waltair", latitude: 17.7435916,    longitude: 83.3172987 },
  { id: "stall-07", name: "Cadieux Siripuram Stall",            type: "stall", zone: "Siripuram",       area: "Siripuram / RK Beach / Waltair Uplands", latitude: 17.720371999999998, longitude: 83.31680709999999 },
  { id: "stall-08", name: "Cadieux Dwaraka Nagar Stall",        type: "stall", zone: "Dwaraka Nagar",   area: "Dwaraka Nagar / Jagadamba / Central",  latitude: 17.729416699999998, longitude: 83.3092679 },
  { id: "stall-09", name: "Cadieux Akkayyapalem Stall",         type: "stall", zone: "Akkayyapalem",    area: "Akkayyapalem / Maddilapalem / NAD North", latitude: 17.7352775,      longitude: 83.29995249999999 },
  { id: "stall-10", name: "Cadieux Gajuwaka Stall",             type: "stall", zone: "Gajuwaka",        area: "Gajuwaka / Vadlapudi / Steel Plant",   latitude: 17.7096554,         longitude: 83.17806019999999 },

  // ===== 50 GATED COMMUNITIES =====
  { id: "gc-01", name: "Utkarsha Capital Towers",          type: "community", zone: "PM Palem",       area: "Bakkanapalem",                        latitude: 17.8170275,         longitude: 83.3422987,           rating: 4.6 },
  { id: "gc-02", name: "Vaisakhi Sankalp West Winds",      type: "community", zone: "PM Palem",       area: "Srinivasa Nagar",                     latitude: 17.8117782,         longitude: 83.35223719999999,    rating: 4.4 },
  { id: "gc-03", name: "MVV & GV The Grand",               type: "community", zone: "PM Palem",       area: "SBI Colony",                          latitude: 17.8099405,         longitude: 83.3492007,           rating: 4.3 },
  { id: "gc-04", name: "Sumukha Enclave",                  type: "community", zone: "PM Palem",       area: "Kommadi Road",                        latitude: 17.8173843,         longitude: 83.3447488,           rating: 4.2 },
  { id: "gc-05", name: "MVV City",                         type: "community", zone: "Madhurawada",    area: "Vasundhara Nagar",                    latitude: 17.7939971,         longitude: 83.3574495,           rating: 4.4, notes: "1016 ratings — mega community, 10 acres" },
  { id: "gc-06", name: "Vuda Harita Housing Complex",      type: "community", zone: "Madhurawada",    area: "IT Hub Junction",                     latitude: 17.8178257,         longitude: 83.38324279999999,    rating: 4.3, notes: "700 flats, 20 acres" },
  { id: "gc-07", name: "Sri Lalitha Residency",            type: "community", zone: "Madhurawada",    area: "Kommadi Village",                     latitude: 17.8211817,         longitude: 83.3453134,           rating: 5.0 },
  { id: "gc-08", name: "Hill View Paradise",               type: "community", zone: "Madhurawada",    area: "Kommadi 100ft Road",                  latitude: 17.8336427,         longitude: 83.3418902,           rating: 4.2 },
  { id: "gc-09", name: "Shriram Panorama Hills",           type: "community", zone: "Rushikonda",     area: "VUDA 100 Road",                       latitude: 17.7901571,         longitude: 83.3630981,           rating: 4.3, notes: "456 ratings" },
  { id: "gc-10", name: "Pebble Beach Villas",              type: "community", zone: "Rushikonda",     area: "Pedda Rushikonda",                    latitude: 17.793719199999998, longitude: 83.3791796,           rating: 4.6 },
  { id: "gc-11", name: "La Citadel",                       type: "community", zone: "Rushikonda",     area: "Pedda Rushikonda",                    latitude: 17.797196,          longitude: 83.38288690000002,    rating: 5.0 },
  { id: "gc-12", name: "MK One",                           type: "community", zone: "Yendada",        area: "100 Feet Road",                       latitude: 17.7811457,         longitude: 83.3685781,           rating: 4.9 },
  { id: "gc-13", name: "Vaisakhi Skyline Apartments",      type: "community", zone: "Yendada",        area: "GITAM Medical College Rd",            latitude: 17.780430799999998, longitude: 83.3628288,           rating: 4.5, notes: "612 units" },
  { id: "gc-14", name: "Vaisakhi Skypark",                 type: "community", zone: "Yendada",        area: "Beside Vaisakhi Skyline",             latitude: 17.7806387,         longitude: 83.3622201,           rating: 4.5 },
  { id: "gc-15", name: "Fame Horizon Apartments",          type: "community", zone: "Yendada",        area: "Sagar Nagar",                         latitude: 17.7752762,         longitude: 83.3665109,           rating: 4.3 },
  { id: "gc-16", name: "MK Gold Coast",                    type: "community", zone: "Yendada",        area: "Endada Junction",                     latitude: 17.7809808,         longitude: 83.36559869999999,    rating: 4.4, notes: "647 ratings, mega project" },
  { id: "gc-17", name: "MVV Hill Valley Apartments",       type: "community", zone: "MVP Colony",     area: "MVP Sector 6",                        latitude: 17.746291,          longitude: 83.3383315,           rating: 4.4 },
  { id: "gc-18", name: "Navya Gadiraju Empire",            type: "community", zone: "MVP Colony",     area: "MVP Sector 11",                       latitude: 17.737717099999998, longitude: 83.3404961,           rating: 4.4 },
  { id: "gc-19", name: "Northstar Eden Garden",            type: "community", zone: "MVP Colony",     area: "Venkojipalem / MVP Sector 6",         latitude: 17.750206,          longitude: 83.3326755,           rating: 4.5 },
  { id: "gc-20", name: "MK Builders Complex",              type: "community", zone: "MVP Colony",     area: "MVP Sector 1",                        latitude: 17.744916699999997, longitude: 83.3308258,           rating: 4.4 },
  { id: "gc-21", name: "Fame Enclave",                     type: "community", zone: "MVP Colony",     area: "MVP Sector 12 / Lawson's Bay",        latitude: 17.7365577,         longitude: 83.33609539999999,    rating: 4.5 },
  { id: "gc-22", name: "MVV Pallavi Apartment",            type: "community", zone: "MVP Colony",     area: "Lawson's Bay Colony",                 latitude: 17.7330148,         longitude: 83.3390928,           rating: 4.7 },
  { id: "gc-23", name: "Siri Venkateswara HB Colony",      type: "community", zone: "Seethammadhara", area: "HB Colony Road",                      latitude: 17.7435916,         longitude: 83.3172987,           rating: 4.7 },
  { id: "gc-24", name: "LIC Jeevan Visakha",               type: "community", zone: "Seethammadhara", area: "MMTC Colony / HB Colony",             latitude: 17.7463361,         longitude: 83.31720399999999,    rating: 4.2 },
  { id: "gc-25", name: "Lansum Square",                    type: "community", zone: "Seethammadhara", area: "Isukathota / Maddilapalem",           latitude: 17.743463800000004, longitude: 83.3273815,           rating: 4.4 },
  { id: "gc-26", name: "Sai Vihar Apartments",             type: "community", zone: "Seethammadhara", area: "HB Colony",                           latitude: 17.744260999999998, longitude: 83.3258328,           rating: 4.8 },
  { id: "gc-27", name: "HPCL Waltair Park",                type: "community", zone: "Siripuram",      area: "Andhra University South",             latitude: 17.7211213,         longitude: 83.3245621,           rating: 4.5 },
  { id: "gc-28", name: "Classic Luxury Service Apartments",type: "community", zone: "Siripuram",      area: "Kirlampudi / Pedda Waltair",          latitude: 17.721361299999998, longitude: 83.33139849999999,    rating: 4.4 },
  { id: "gc-29", name: "Park Lane Residency",              type: "community", zone: "Siripuram",      area: "Beach Rd / Pedda Waltair",            latitude: 17.7261102,         longitude: 83.3386872,           rating: 4.5 },
  { id: "gc-30", name: "The Maanvik Shores",               type: "community", zone: "Siripuram",      area: "RK Beach Rd",                         latitude: 17.712961699999997, longitude: 83.3197321,           rating: 4.9 },
  { id: "gc-31", name: "Jasti Square Apartments",          type: "community", zone: "Siripuram",      area: "Beach Rd / Chinna Waltair",           latitude: 17.7145793,         longitude: 83.3229796,           rating: 4.2 },
  { id: "gc-32", name: "Abhiram's Blue Bay Towers",        type: "community", zone: "Siripuram",      area: "Kirlampudi Layout",                   latitude: 17.723335199999998, longitude: 83.3308181,           rating: 4.6 },
  { id: "gc-33", name: "Gayatri Towers",                   type: "community", zone: "Siripuram",      area: "Pedda Waltair",                       latitude: 17.7319984,         longitude: 83.3301066,           rating: 4.6 },
  { id: "gc-34", name: "Oceana Apartments",                type: "community", zone: "Siripuram",      area: "Lawson's Bay / Pedda Waltair",        latitude: 17.731859999999998, longitude: 83.3346317,           rating: 4.4 },
  { id: "gc-35", name: "Daba Gardens Residential",         type: "community", zone: "Dwaraka Nagar",  area: "Allipuram / Daba Garden Rd",          latitude: 17.7197049,         longitude: 83.3028484,           rating: 4.2 },
  { id: "gc-36", name: "Prakruti Avenues",                 type: "community", zone: "Akkayyapalem",   area: "Sagar Nagar / Dwaraka Nagar",         latitude: 17.7264394,         longitude: 83.3052534,           rating: 4.1 },
  { id: "gc-37", name: "Ramky One Krystal",                type: "community", zone: "Gajuwaka",       area: "Sheela Nagar",                        latitude: 17.7235625,         longitude: 83.1968125,           rating: 4.4 },
  { id: "gc-38", name: "Green City Homes",                 type: "community", zone: "Gajuwaka",       area: "Vadlapudi",                           latitude: 17.7096554,         longitude: 83.17806019999999,    rating: 4.1, notes: "50-acre, 400 flats" },
  { id: "gc-39", name: "Suvarna Srinivasam",               type: "community", zone: "Gajuwaka",       area: "Tungalam",                            latitude: 17.708033,          longitude: 83.190438,            rating: 4.1 },
  { id: "gc-40", name: "The Celest",                       type: "community", zone: "Gajuwaka",       area: "Chaitanya Nagar",                     latitude: 17.6846867,         longitude: 83.1995077,           rating: 4.1 },
  { id: "gc-41", name: "MVV & MK Park Apartments",         type: "community", zone: "Gajuwaka",       area: "Kurmannapalem",                       latitude: 17.6972402,         longitude: 83.1668327,           rating: 4.4, notes: "556 ratings, 9 acres" },
  { id: "gc-42", name: "Novus Florence Village",           type: "community", zone: "Gajuwaka",       area: "Gangavaram Port Rd",                  latitude: 17.6644953,         longitude: 83.19063609999999,    rating: 3.9 },
  { id: "gc-43", name: "Steel Plant Township Sector 2",    type: "community", zone: "Gajuwaka",       area: "Steel Plant Township",                latitude: 17.6574113,         longitude: 83.1582377 },
  { id: "gc-44", name: "Steel Plant Township Sector 6",    type: "community", zone: "Gajuwaka",       area: "Steel Plant Township",                latitude: 17.658399499999998, longitude: 83.1482583 },
  { id: "gc-45", name: "Sri Yaduvamsi Anandadhamam",       type: "community", zone: "Pendurthi",      area: "Sujatha Nagar",                       latitude: 17.7983136,         longitude: 83.2136256,           rating: 4.7, notes: "375 units" },
  { id: "gc-46", name: "Hoja Luxury Villas",               type: "community", zone: "Pendurthi",      area: "Karmika Nagar",                       latitude: 17.806390399999998, longitude: 83.21947879999999,    rating: 4.6 },
  { id: "gc-47", name: "MS Ramayya Constructions",         type: "community", zone: "Pendurthi",      area: "Sujatha Nagar",                       latitude: 17.797488599999998, longitude: 83.21143099999999,    rating: 4.3 },
  { id: "gc-48", name: "Villaasam",                        type: "community", zone: "Bheemili",       area: "Uppada / Kapuluppada",                latitude: 17.8533163,         longitude: 83.3900918,           rating: 4.8 },
  { id: "gc-49", name: "Prime Marine View",                type: "community", zone: "Bheemili",       area: "Neerallavalasa",                      latitude: 17.881992900000004, longitude: 83.4399785,           rating: 4.8 },
  { id: "gc-50", name: "Dwaraka 369",                      type: "community", zone: "Madhurawada",    area: "Pataparadesipalem",                   latitude: 17.831897599999998, longitude: 83.363225,            rating: 5.0 },
];

if (process.env.NODE_ENV !== "production") {
  // Hard guard: copy-paste mistakes that duplicate IDs would silently merge
  // markers / cards in the UI. Catch in dev.
  const ids = new Set<string>();
  for (const loc of LOCATIONS) {
    if (ids.has(loc.id)) {
      // eslint-disable-next-line no-console
      console.warn("[find-us] duplicate location id:", loc.id);
    }
    ids.add(loc.id);
  }
}

export const STALL_COUNT = LOCATIONS.filter((l) => l.type === "stall").length;
export const COMMUNITY_COUNT = LOCATIONS.filter(
  (l) => l.type === "community",
).length;

/**
 * Returns the nearest stall to a given lat/lng. Used by the pincode checker
 * to recommend a pickup point. Tiny set (10 stalls) so a linear scan is
 * correct and fast.
 */
export function nearestStall(
  lat: number,
  lng: number,
): { stall: CadieuxLocation; distanceKm: number } | null {
  let best: { stall: CadieuxLocation; distanceKm: number } | null = null;
  for (const s of LOCATIONS) {
    if (s.type !== "stall") continue;
    const d = haversineKm(lat, lng, s.latitude, s.longitude);
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
