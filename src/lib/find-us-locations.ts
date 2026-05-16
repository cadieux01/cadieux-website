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

  // ===== 100 GYMS =====
  { id: "gym-001", name: "Iron Paradise",                        type: "gym", zone: "PM Palem",       area: "Midhilapuri / Pothinamallayya Palem", latitude: 17.8041641, longitude: 83.355907,  rating: 4.9 },
  { id: "gym-002", name: "Fitness Edge",                         type: "gym", zone: "PM Palem",       area: "Pothinamallayya Palem",               latitude: 17.8040177, longitude: 83.3478156, rating: 4.6 },
  { id: "gym-003", name: "Traxx Fitness",                        type: "gym", zone: "Madhurawada",    area: "Srinivasa Nagar",                     latitude: 17.8082793, longitude: 83.3550273, rating: 4.4 },
  { id: "gym-004", name: "LG Fitness Centre",                    type: "gym", zone: "Madhurawada",    area: "Kommadi Junction",                    latitude: 17.8263221, longitude: 83.3573871, rating: 5.0 },
  { id: "gym-005", name: "JB Personal Training Gym",             type: "gym", zone: "Madhurawada",    area: "Vasundhara Nagar",                    latitude: 17.7967683, longitude: 83.3538211, rating: 4.9 },
  { id: "gym-006", name: "Stars Gym",                            type: "gym", zone: "Madhurawada",    area: "Krishna Nagar",                       latitude: 17.8170162, longitude: 83.3605032, rating: 5.0 },
  { id: "gym-007", name: "Core Fitness",                         type: "gym", zone: "PM Palem",       area: "Chandrampalem / Midhilapuri",         latitude: 17.8039954, longitude: 83.3593329, rating: 4.5 },
  { id: "gym-008", name: "Akshara Almighty Gym",                 type: "gym", zone: "Madhurawada",    area: "Kommadi 100ft Road",                  latitude: 17.825453,  longitude: 83.3498431, rating: 4.5 },
  { id: "gym-009", name: "Gurudatta Health Gym",                 type: "gym", zone: "Madhurawada",    area: "Kommadi Road",                        latitude: 17.8166016, longitude: 83.3572069, rating: 4.7 },
  { id: "gym-010", name: "V Square Fitness",                     type: "gym", zone: "Yendada",        area: "Midhilapuri 100ft Rd",                latitude: 17.8012761, longitude: 83.3680678, rating: 4.8 },
  { id: "gym-011", name: "CRX FitBay",                           type: "gym", zone: "MVP Colony",     area: "Sector 9 (Vuda Health Arena)",        latitude: 17.7457158, longitude: 83.3424793, rating: 4.7 },
  { id: "gym-012", name: "AIM Fitness Unisex Gym",               type: "gym", zone: "MVP Colony",     area: "MVP Sector 3",                        latitude: 17.742128,  longitude: 83.3347272, rating: 5.0 },
  { id: "gym-013", name: "S3 Sports Arena",                      type: "gym", zone: "MVP Colony",     area: "MVP Sector 8",                        latitude: 17.7390863, longitude: 83.3370966, rating: 4.6 },
  { id: "gym-014", name: "Kratos Fitness",                       type: "gym", zone: "MVP Colony",     area: "MVP Double Road",                     latitude: 17.7422108, longitude: 83.3313695, rating: 5.0 },
  { id: "gym-015", name: "Abhi's Gym",                           type: "gym", zone: "MVP Colony",     area: "MVP Double Road",                     latitude: 17.7422041, longitude: 83.331301,  rating: 4.6 },
  { id: "gym-016", name: "AA Stepup Fitness Studio",             type: "gym", zone: "MVP Colony",     area: "Adarsh Nagar",                        latitude: 17.7354984, longitude: 83.3333118, rating: 4.8 },
  { id: "gym-017", name: "Planet Fitness Studio (Women)",        type: "gym", zone: "MVP Colony",     area: "MVP Sector 10",                       latitude: 17.741021,  longitude: 83.3384278, rating: 4.6 },
  { id: "gym-018", name: "Vikram Fitness Rack",                  type: "gym", zone: "MVP Colony",     area: "MVP Sector 4 / Isukathota",           latitude: 17.7411191, longitude: 83.3283667, rating: 4.6 },
  { id: "gym-019", name: "AIM Fitness & Dance Floor",            type: "gym", zone: "MVP Colony",     area: "MVP Sector 3",                        latitude: 17.744298,  longitude: 83.3331211, rating: 4.6 },
  { id: "gym-020", name: "Camel Crew The Gym",                   type: "gym", zone: "Siripuram",      area: "Chinna Waltair",                      latitude: 17.7225577, longitude: 83.3335414, rating: 4.8 },
  { id: "gym-021", name: "ABS Fitness Gym",                      type: "gym", zone: "Seethammadhara", area: "Seethammadhara",                      latitude: 17.742365,  longitude: 83.3081554, rating: 4.7 },
  { id: "gym-022", name: "Metcon Fitness Hub",                   type: "gym", zone: "Seethammadhara", area: "North Extension",                     latitude: 17.7455147, longitude: 83.3118269, rating: 5.0 },
  { id: "gym-023", name: "AKSA Fitness Studio",                  type: "gym", zone: "Seethammadhara", area: "Balayya Sastri Layout",               latitude: 17.7396491, longitude: 83.3107103, rating: 4.8 },
  { id: "gym-024", name: "Prabhu's Professional Gym",            type: "gym", zone: "Seethammadhara", area: "Hill View Doctors Colony",            latitude: 17.743584,  longitude: 83.3156481, rating: 4.7 },
  { id: "gym-025", name: "Elevate High Performance Centre",      type: "gym", zone: "Seethammadhara", area: "NE Layout",                           latitude: 17.7455131, longitude: 83.3089885, rating: 5.0 },
  { id: "gym-026", name: "SK Fitness Gym",                       type: "gym", zone: "Seethammadhara", area: "Satyam Junction",                     latitude: 17.7354609, longitude: 83.3129324, rating: 4.9 },
  { id: "gym-027", name: "Eccentric Fitness Seethammadhara",     type: "gym", zone: "Seethammadhara", area: "TPT Colony",                          latitude: 17.7439095, longitude: 83.3121788, rating: 4.9 },
  { id: "gym-028", name: "Let's Go Gym & Aerobics",              type: "gym", zone: "Seethammadhara", area: "Balayya Sastri / North Extension",    latitude: 17.7417599, longitude: 83.3066037, rating: 5.0 },
  { id: "gym-029", name: "Shape Well Ladies Fitness Center",     type: "gym", zone: "Seethammadhara", area: "APSEB Colony",                        latitude: 17.7446843, longitude: 83.3144139, rating: 4.3 },
  { id: "gym-030", name: "Gymnaz 365 CrossFit Studio",           type: "gym", zone: "Seethammadhara", area: "Ambedkar Nagar / Adarsh Nagar",       latitude: 17.7482469, longitude: 83.3141416, rating: 5.0 },
  { id: "gym-031", name: "Varun Fitness",                        type: "gym", zone: "Siripuram",      area: "Kasturba Marg",                       latitude: 17.7199423, longitude: 83.3195503, rating: 4.9, notes: "703 ratings — flagship gym near Beach Rd" },
  { id: "gym-032", name: "Cult Gym Siripuram",                   type: "gym", zone: "Siripuram",      area: "Dutt Island / Jagapathi Plaza",       latitude: 17.7242803, longitude: 83.3175876, rating: 4.3 },
  { id: "gym-033", name: "Club F7",                              type: "gym", zone: "Siripuram",      area: "Gangapur Layout",                     latitude: 17.7199706, longitude: 83.3155202, rating: 4.8, notes: "Biggest gym in Vizag — 5 floors" },
  { id: "gym-034", name: "Being Fitness Unisex Gym",             type: "gym", zone: "Siripuram",      area: "Pandurangapuram / Ocean View",        latitude: 17.715609,  longitude: 83.3248266, rating: 4.5 },
  { id: "gym-035", name: "Tos Gym",                              type: "gym", zone: "Dwaraka Nagar",  area: "Ram Nagar / Daba Gardens",            latitude: 17.7165112, longitude: 83.3026562, rating: 5.0 },
  { id: "gym-036", name: "Sai Sanjivani Multi Fitness Gym",      type: "gym", zone: "Dwaraka Nagar",  area: "Daba Gardens / Allipuram",            latitude: 17.717004,  longitude: 83.3017506, rating: 4.8 },
  { id: "gym-037", name: "SS Gym Unisex",                        type: "gym", zone: "Dwaraka Nagar",  area: "Daba Gardens / Allipuram",            latitude: 17.7170547, longitude: 83.3017582, rating: 4.9 },
  { id: "gym-038", name: "Vibrations Fitness Studio",            type: "gym", zone: "Siripuram",      area: "Ram Nagar",                           latitude: 17.7224031, longitude: 83.3108238, rating: 4.8 },
  { id: "gym-039", name: "Oxyzen Fitness",                       type: "gym", zone: "Dwaraka Nagar",  area: "Jail Rd / Ram Nagar",                 latitude: 17.7187874, longitude: 83.3060254, rating: 4.8 },
  { id: "gym-040", name: "JW Fitness & Strength",                type: "gym", zone: "Siripuram",      area: "Facor Layout / Asilmetta",            latitude: 17.7244121, longitude: 83.3131162, rating: 5.0 },
  { id: "gym-041", name: "Massiv Fitness Studio",                type: "gym", zone: "Dwaraka Nagar",  area: "Vidya Mandhir Road",                  latitude: 17.728767,  longitude: 83.3074328, rating: 4.9 },
  { id: "gym-042", name: "Elevate by 28 Fitness",                type: "gym", zone: "Siripuram",      area: "Facor Layout / Ram Nagar",            latitude: 17.7243941, longitude: 83.3131774, rating: 4.3 },
  { id: "gym-043", name: "Anytime Fitness Visakhapatnam",        type: "gym", zone: "Siripuram",      area: "Facor Layout / Ram Nagar",            latitude: 17.72434,   longitude: 83.31321,   rating: 4.4 },
  { id: "gym-044", name: "Indian Gym KN Raju Fitness",           type: "gym", zone: "Akkayyapalem",   area: "CBM Compound / Asilmetta",            latitude: 17.7262703, longitude: 83.3105629, rating: 5.0 },
  { id: "gym-045", name: "Ram Sai Muscle Gym",                   type: "gym", zone: "Dwaraka Nagar",  area: "Jagadamba Junction",                  latitude: 17.7096093, longitude: 83.3072822, rating: 4.8 },
  { id: "gym-046", name: "Champions Gym Unisex",                 type: "gym", zone: "Akkayyapalem",   area: "Lalitha Nagar",                       latitude: 17.7327325, longitude: 83.2995911, rating: 4.8 },
  { id: "gym-047", name: "Bhairava's Fitness Zone",              type: "gym", zone: "Akkayyapalem",   area: "Srinivas Nagar",                      latitude: 17.7316727, longitude: 83.2990089, rating: 5.0 },
  { id: "gym-048", name: "Teja Fitness Akkayyapalem",            type: "gym", zone: "Akkayyapalem",   area: "Akkayyapalem",                        latitude: 17.7389127, longitude: 83.2998336, rating: 4.3 },
  { id: "gym-049", name: "Indian Gym Akkayyapalem",              type: "gym", zone: "Akkayyapalem",   area: "Lalitha Nagar",                       latitude: 17.7343659, longitude: 83.2997544, rating: 4.4 },
  { id: "gym-050", name: "Squad Fitness Akkayyapalem",           type: "gym", zone: "Akkayyapalem",   area: "Railway New Colony",                  latitude: 17.7276431, longitude: 83.2965974, rating: 4.8 },
  { id: "gym-051", name: "Bodyline Fitness",                     type: "gym", zone: "Akkayyapalem",   area: "Marripalem Highway",                  latitude: 17.7453437, longitude: 83.2525731, rating: 4.9 },
  { id: "gym-052", name: "SVS Fitness World",                    type: "gym", zone: "Akkayyapalem",   area: "104 Area / Marripalem",               latitude: 17.7390979, longitude: 83.2569429, rating: 4.9 },
  { id: "gym-053", name: "AB Fitness",                           type: "gym", zone: "Akkayyapalem",   area: "Railway New Colony",                  latitude: 17.7301491, longitude: 83.2924208, rating: 4.9 },
  { id: "gym-054", name: "Talwalkars HiFi Gym Muralinagar",      type: "gym", zone: "Akkayyapalem",   area: "Muralinagar / Madhavadhara",          latitude: 17.7460774, longitude: 83.2607305, rating: 4.7 },
  { id: "gym-055", name: "Addict Fitness Studio NAD",            type: "gym", zone: "Akkayyapalem",   area: "NAD Junction / Shanti Nagar",         latitude: 17.7421133, longitude: 83.2382668, rating: 4.7 },
  { id: "gym-056", name: "RK Fitness Mantra",                    type: "gym", zone: "Akkayyapalem",   area: "NAD Kotha Rd / Marripalem",           latitude: 17.7404201, longitude: 83.2459142, rating: 4.8 },
  { id: "gym-057", name: "Lifespan Fitness Zone Marripalem",     type: "gym", zone: "Akkayyapalem",   area: "Marripalem Highway",                  latitude: 17.7449422, longitude: 83.2537116, rating: 4.6 },
  { id: "gym-058", name: "Teja Fitness Studio 104",              type: "gym", zone: "Akkayyapalem",   area: "104 Area / Marripalem",               latitude: 17.7383507, longitude: 83.2591261, rating: 4.7 },
  { id: "gym-059", name: "Impact Fitness Gym",                   type: "gym", zone: "Akkayyapalem",   area: "Birla Junction / Madhavadhara",       latitude: 17.7444224, longitude: 83.2589835, rating: 5.0 },
  { id: "gym-060", name: "Cross Road Fitness Birla Junction",    type: "gym", zone: "Akkayyapalem",   area: "Vuda Colony / Madhavadhara",          latitude: 17.7464814, longitude: 83.2519071, rating: 4.8 },
  { id: "gym-061", name: "Fit N Feet Gym & Dance Studio",        type: "gym", zone: "MVP Colony",     area: "Lawson's Bay Colony",                 latitude: 17.7311065, longitude: 83.33649,   rating: 4.9 },
  { id: "gym-062", name: "Vybefit Studio",                       type: "gym", zone: "MVP Colony",     area: "Lawson's Bay Colony",                 latitude: 17.7314676, longitude: 83.3364749, rating: 4.9 },
  { id: "gym-063", name: "Transformers Gym",                     type: "gym", zone: "MVP Colony",     area: "Lawson's Bay / Ushodaya",             latitude: 17.7340543, longitude: 83.3318651, rating: 4.3 },
  { id: "gym-064", name: "Prime Fitness Pedda Waltair",          type: "gym", zone: "MVP Colony",     area: "Pedda Waltair",                       latitude: 17.7330117, longitude: 83.3325816, rating: 5.0 },
  { id: "gym-065", name: "The Gold Coast Fitness Studio",        type: "gym", zone: "Siripuram",      area: "East Point Colony / Chinna Waltair",  latitude: 17.7270241, longitude: 83.3359122, rating: 4.5 },
  { id: "gym-066", name: "Power House Gym",                      type: "gym", zone: "MVP Colony",     area: "Lawson's Bay / Annapurna Complex",    latitude: 17.7334083, longitude: 83.3321494, rating: 4.6 },
  { id: "gym-067", name: "Teja Fitness Studio Yendada",          type: "gym", zone: "Yendada",        area: "Yendada / Indian Bank",               latitude: 17.7817497, longitude: 83.360583,  rating: 5.0 },
  { id: "gym-068", name: "Transcend Fitness Center",             type: "gym", zone: "Yendada",        area: "Sirigudi Nagar",                      latitude: 17.7764705, longitude: 83.3592165, rating: 4.9 },
  { id: "gym-069", name: "Vigor The Fitness Club",               type: "gym", zone: "Yendada",        area: "Ram Gardens / 100ft Rd",              latitude: 17.7811742, longitude: 83.3592839, rating: 4.8 },
  { id: "gym-070", name: "Pawan Putra Power Fitness Gym",        type: "gym", zone: "Yendada",        area: "Polamamba / Yendada Highway",         latitude: 17.7789507, longitude: 83.3574949, rating: 4.8 },
  { id: "gym-071", name: "MK Unisex AC Gym",                     type: "gym", zone: "Yendada",        area: "Sagar Nagar / NTR Marg",              latitude: 17.7652569, longitude: 83.3581969, rating: 5.0 },
  { id: "gym-072", name: "Fit 4 Busy Fitness",                   type: "gym", zone: "Yendada",        area: "Sagar Nagar / NTR Marg",              latitude: 17.7652466, longitude: 83.3581981, rating: 4.9 },
  { id: "gym-073", name: "Sai Fitness Zone",                     type: "gym", zone: "Yendada",        area: "Sagar Nagar / NTR Marg",              latitude: 17.7653569, longitude: 83.3581709, rating: 4.1 },
  { id: "gym-074", name: "Sea Shells Gym",                       type: "gym", zone: "Yendada",        area: "Sagar Nagar / Beach Rd",              latitude: 17.7670743, longitude: 83.3593745, rating: 4.3 },
  { id: "gym-075", name: "MM Fitness Zone Rushikonda",           type: "gym", zone: "Rushikonda",     area: "Pedda Rushikonda",                    latitude: 17.7946341, longitude: 83.3841266, rating: 4.7 },
  { id: "gym-076", name: "TFH The Fit Hub Gym",                  type: "gym", zone: "Yendada",        area: "Yendada / Balaji Nagar",              latitude: 17.7743289, longitude: 83.358373,  rating: 5.0 },
  { id: "gym-077", name: "Graphene Fitness Studio",              type: "gym", zone: "Pendurthi",      area: "Ratnagiri Nagar / Sujatha Nagar",     latitude: 17.8020126, longitude: 83.2093631, rating: 4.8 },
  { id: "gym-078", name: "Vigor Fitness Club Pendurthi",         type: "gym", zone: "Pendurthi",      area: "Sujatha Nagar B Zone",                latitude: 17.8017543, longitude: 83.2104246, rating: 4.5 },
  { id: "gym-079", name: "MFitness Ladies Gym",                  type: "gym", zone: "Pendurthi",      area: "Sujatha Nagar A Zone",                latitude: 17.7984463, longitude: 83.2110556, rating: 4.9 },
  { id: "gym-080", name: "JB Personal Training Sujatha",         type: "gym", zone: "Pendurthi",      area: "Pendurthi",                           latitude: 17.8132388, longitude: 83.2066565, rating: 5.0 },
  { id: "gym-081", name: "BullRocksFitness",                     type: "gym", zone: "Pendurthi",      area: "Sujatha Nagar A Zone",                latitude: 17.7990307, longitude: 83.2109787, rating: 4.7 },
  { id: "gym-082", name: "Royal Fitness Gym",                    type: "gym", zone: "Pendurthi",      area: "Karmika Nagar / Sarada Nagar",        latitude: 17.8083773, longitude: 83.2085965, rating: 4.7 },
  { id: "gym-083", name: "Ozone Sports Hub",                     type: "gym", zone: "Pendurthi",      area: "Sujatha Nagar B Zone",                latitude: 17.8021059, longitude: 83.211007,  rating: 4.2 },
  { id: "gym-084", name: "Almighty Gym Gajuwaka",                type: "gym", zone: "Gajuwaka",       area: "Gajuwaka Main",                       latitude: 17.6871739, longitude: 83.2049219, rating: 4.9 },
  { id: "gym-085", name: "SS Fitness World Gajuwaka",            type: "gym", zone: "Gajuwaka",       area: "Chaitanya Nagar / Old Gajuwaka",      latitude: 17.6829748, longitude: 83.2054148, rating: 4.6 },
  { id: "gym-086", name: "Cross Road Fitness Gajuwaka",          type: "gym", zone: "Gajuwaka",       area: "Indira Colony / Kanithi Rd",          latitude: 17.6841727, longitude: 83.2113716, rating: 4.9 },
  { id: "gym-087", name: "Indian Gold's Fitness Gym",            type: "gym", zone: "Gajuwaka",       area: "Pedagantyada",                        latitude: 17.6691041, longitude: 83.2079225, rating: 5.0 },
  { id: "gym-088", name: "Fitness Hub Gym Gajuwaka",             type: "gym", zone: "Gajuwaka",       area: "BC Rd / Gajuwaka",                    latitude: 17.6829884, longitude: 83.2159142, rating: 5.0 },
  { id: "gym-089", name: "The Mighty Gym",                       type: "gym", zone: "Gajuwaka",       area: "Pedagantyada / Vempalla Nagar",       latitude: 17.6737449, longitude: 83.205145,  rating: 4.8 },
  { id: "gym-090", name: "Metroflex Gym",                        type: "gym", zone: "Gajuwaka",       area: "Gonthinavanipalem",                   latitude: 17.6768946, longitude: 83.1964493, rating: 5.0 },
  { id: "gym-091", name: "Rams Fitness360",                      type: "gym", zone: "Gajuwaka",       area: "BHPV Township / Akkireddypalem",      latitude: 17.7100148, longitude: 83.2055247, rating: 4.9 },
  { id: "gym-092", name: "Fitness 11",                           type: "gym", zone: "Gajuwaka",       area: "Sri Nagar / Kotha Dibbapalem",        latitude: 17.679948,  longitude: 83.1837736, rating: 4.8 },
  { id: "gym-093", name: "Sri Sai National Gym",                 type: "gym", zone: "Gajuwaka",       area: "Chaitanya Nagar / Vantalu",           latitude: 17.6821129, longitude: 83.2057239, rating: 4.8 },
  { id: "gym-094", name: "NE Fitness Unisex Gym",                type: "gym", zone: "Gajuwaka",       area: "Kurmannapalem / Sri Sai Ganesh Nagar",latitude: 17.6996413, longitude: 83.1587698, rating: 4.9 },
  { id: "gym-095", name: "VR Fitness Gym Kurmannapalem",         type: "gym", zone: "Gajuwaka",       area: "Kurmannapalem",                       latitude: 17.6896485, longitude: 83.1666769, rating: 4.7 },
  { id: "gym-096", name: "My Fitness Gym Aganampudi",            type: "gym", zone: "Gajuwaka",       area: "Aganampudi / Prasanthinagar",         latitude: 17.6849339, longitude: 83.1377058, rating: 4.9 },
  { id: "gym-097", name: "U Fit Sheela Nagar",                   type: "gym", zone: "Gajuwaka",       area: "Sheela Nagar",                        latitude: 17.7168208, longitude: 83.2034654, rating: 4.9 },
  { id: "gym-098", name: "Hardhik New Fitness Zone",             type: "gym", zone: "Gajuwaka",       area: "Vadlapudi / Kurmannapalem",           latitude: 17.6922832, longitude: 83.170176,  rating: 4.8 },
  { id: "gym-099", name: "Arnold Strong Gym Bheemili",           type: "gym", zone: "Bheemili",       area: "Bheemili Old Bus Stand",              latitude: 17.8919305, longitude: 83.4530105, rating: 5.0 },
  { id: "gym-100", name: "Gains Fitness Club",                   type: "gym", zone: "Gajuwaka",       area: "Desa Pathrunipalem (south)",          latitude: 17.6390045, longitude: 83.1228986, rating: 4.9 },
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
export const GYM_COUNT = LOCATIONS.filter((l) => l.type === "gym").length;

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
