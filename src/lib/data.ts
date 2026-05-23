export type CartItem = {
  productIndex: number;
  name: string;
  price: number;
  qty: number;
  orderType: "once" | "sub";
  weeks?: number;
  // Single-day subscription (legacy / one-day pick)
  day?: string;
  time?: string;
  // Multi-day subscription metadata (new wizard)
  days?: string[];
  slotMode?: "same" | "custom";
  slot?: string | null;
  slotsByDay?: Record<string, string> | null;
  // Per-delivery overrides — when present, used as the source of truth for
  // both display and DB insertion (overrides server-side date generation).
  deliveries?: Array<{
    sequence: number;
    week_number: number;
    day_key: string;
    delivery_date: string; // yyyy-mm-dd
    slot: string | null;
    skipped: boolean;
  }> | null;
};

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const TIMES = ["7 – 9 am", "9 – 11 am", "12 – 2 pm", "5 – 7 pm", "7 – 9 pm"];
export const SUB_WEEKS = [2, 3, 4, 6];

export type ProductStat = { target: number; suffix?: string; label: string };

// @deprecated: prefer getActiveProducts() from @/lib/products for live
// price/name/weight (Supabase-backed). PRODUCTS stays as a typed shape used
// by rich-content lookups (PRODUCT_DETAILS) and as a graceful fallback if
// Supabase is unreachable. Values here MUST match the DB rows.
export const PRODUCTS = [
  {
    slug: "multigrain",
    name: "Multi-Grain High Protein Bread",
    tag: "Protein Bread",
    title: "Multigrain",
    tags: ["Multi Grains", "No Maida"],
    price: 135,
    protein: "7g protein per slice",
    weight: "240g net weight",
    subtitle: "Ancient grains, seeds, whey protein. Baked to lock in structure.",
    desc: "Ancient grains, seeds, and five distinct protein sources — slow-fermented, cold-proofed, and baked to lock in structure.",
    image: "/hero.jpg",
    stats: [
      { target: 7, suffix: "g", label: "Protein/slice" },
      { target: 8, label: "Slices" },
      { target: 240, suffix: "g", label: "Net weight" },
    ] as ProductStat[],
  },
  {
    slug: "high-protein",
    name: "High Protein Bread",
    tag: "Protein Bread",
    title: "Plain",
    tags: ["Sandwich Bread", "8 Slices"],
    price: 99,
    protein: "7g protein per slice",
    weight: "320g net weight",
    subtitle: "Clean sandwich bread built for protein without the fuss. Soft slices, no compromise.",
    desc: "Clean, everyday bread built for high protein without the fuss. Soft sandwich slices with no compromise on nutrition.",
    image: "/grains.jpg",
    stats: [
      { target: 7, suffix: "g", label: "Protein/slice" },
      { target: 8, label: "Slices" },
      { target: 320, suffix: "g", label: "Net Weight" },
    ] as ProductStat[],
  },
];

export type ProductSlug = "multigrain" | "high-protein";

export type ProductMedia = { type: "video" | "image"; src: string; alt?: string };
export type ProductIngredient = { name: string; role: string };
export type ProductTestReport = { metric: string; value: string; note?: string };
export type ProductDetail = {
  description: string[];
  media: ProductMedia[];
  ingredients: ProductIngredient[];
  testReports: ProductTestReport[];
};

export const PRODUCT_DETAILS: Record<ProductSlug, ProductDetail> = {
  multigrain: {
    description: [
      "Our multigrain loaf is the full expression of Cadieux: ancient rye sourdough, oats, linseed, sunflower seeds, and five distinct protein sources — brought together in one slow, careful bake.",
      "Every batch is cold-proofed overnight, then baked on a falling temperature curve that locks in a tight, even crumb. The result is a dense, nourishing slice that holds structure under anything you put on it.",
      "Seven grams of protein per slice. Six grams of fiber. No maida, no refined sugar, no shortcuts.",
    ],
    media: [
      { type: "video", src: "/product-video-05.mp4", alt: "Multigrain bread close-up" },
      { type: "video", src: "/bread-making-01.mp4", alt: "Bread being made" },
      { type: "image", src: "/hero.jpg", alt: "Multigrain loaf hero" },
      { type: "image", src: "/grains.jpg", alt: "Grains and seeds" },
    ],
    ingredients: [
      { name: "Rye sourdough ferment", role: "Base structure & gut-friendly acids" },
      { name: "Whole wheat flour", role: "Core body of the loaf" },
      { name: "Oat bran", role: "Soluble fiber, lowers LDL cholesterol" },
      { name: "Linseed (flax)", role: "Omega-3 fatty acids for heart and brain" },
      { name: "Sunflower seeds", role: "Vitamin E and healthy fats" },
      { name: "Whey protein isolate", role: "Fast-release amino acids" },
      { name: "Soy protein", role: "Slow-release plant protein" },
      { name: "Sea salt", role: "Controls fermentation, lifts flavour" },
    ],
    testReports: [
      { metric: "Protein per slice", value: "7.2 g", note: "FSSAI-accredited lab · Mar 2026" },
      { metric: "Dietary fiber per slice", value: "6.1 g", note: "FSSAI-accredited lab · Mar 2026" },
      { metric: "Added sugar", value: "0 g", note: "Verified — no refined sugar added" },
      { metric: "Glycaemic index", value: "Low (54)", note: "Independent GI testing · 2026" },
    ],
  },
  "high-protein": {
    description: [
      "Plain is the everyday Cadieux — a soft, clean sandwich loaf that happens to carry serious protein.",
      "Same careful process as our multigrain, just a milder crumb built for daily use: toast, sandwiches, kids' lunches, late-night eggs.",
      "Seven grams of protein per slice. Eight slices per loaf. Nothing hidden.",
    ],
    media: [
      { type: "video", src: "/product-video-06.mp4", alt: "Plain protein bread close-up" },
      { type: "video", src: "/bread-eating-01.mp4", alt: "Bread being enjoyed" },
      { type: "image", src: "/grains.jpg", alt: "Grains used" },
      { type: "image", src: "/hero.jpg", alt: "Loaf hero shot" },
    ],
    ingredients: [
      { name: "Whole wheat flour", role: "Primary flour — no maida" },
      { name: "Whey protein isolate", role: "7g of protein per slice, clean taste" },
      { name: "Rye sourdough starter", role: "Slow fermentation, better digestion" },
      { name: "Oat flour", role: "Soft crumb, soluble fiber" },
      { name: "Cold-pressed sunflower oil", role: "Keeps slices tender" },
      { name: "Honey (trace)", role: "Balances ferment — no refined sugar" },
      { name: "Sea salt", role: "Structure and flavour" },
    ],
    testReports: [
      { metric: "Protein per slice", value: "7.0 g", note: "FSSAI-accredited lab · Mar 2026" },
      { metric: "Net weight", value: "320 g", note: "Per packet · verified on line" },
      { metric: "Added sugar", value: "0 g", note: "Trace honey for ferment only" },
      { metric: "Slices per loaf", value: "8", note: "Precision-cut on every bake" },
    ],
  },
};

export const BLOG_POSTS = [
  {
    title: "Why Protein Bread Is the Future of Everyday Eating",
    brief:
      "Most people don't realise their bread is working against them. White bread spikes blood sugar, provides almost no protein, and leaves you hungry within hours. The future isn't eating less — it's eating smarter.",
    body: `Most people grab bread without a second thought. It's familiar, convenient, and cheap. But the loaf sitting on most kitchen counters is doing very little for the person eating it.

Standard white bread is mostly refined carbohydrates — stripped of fibre, protein, and nutrients during processing. It digests fast, spikes blood sugar, and leaves you hungry again within two hours. Over time, that cycle wears on your energy, your focus, and your body composition.

Protein bread changes that equation entirely.

When you replace empty carbohydrates with high-quality protein sources — whey, oat protein, seeds, and ancient grains — the same slice of bread becomes something functional. It slows digestion, feeds muscle tissue, supports your immune system, and keeps hunger at bay far longer.

The shift doesn't require a new diet plan or a lifestyle overhaul. It just requires better bread.

Cadieux was created for exactly this reason. We believe the most powerful health decisions are the quiet ones — the ones you make without thinking about it. Choosing Cadieux over ordinary bread is one of those decisions. Same routine. Better result. Every single day.`,
  },
  {
    title: "The Ancient Grains We Swear By",
    brief:
      "Long before modern wheat dominated our plates, humanity thrived on a diverse range of grains — each with its own nutritional fingerprint. Rye, oats, linseed, and sunflower seeds have been feeding people for thousands of years.",
    body: `For most of human history, bread was made from whatever grains grew nearby — rye in northern Europe, spelt in the Mediterranean, millet across Africa and Asia. These grains weren't just calories. They were dense in fibre, minerals, and slow-digesting carbohydrates that kept communities strong through long winters and hard labour.

Then came industrial agriculture. The focus shifted to yield and shelf life. Ancient grains were replaced by high-output wheat varieties, and the nutritional depth was lost in the process.

At Cadieux, we've gone back.

Rye sourdough ferment forms the base of every loaf. Rye has a lower glycaemic index than wheat, promotes better gut health, and carries a depth of flavour that modern bread simply can't replicate. The fermentation process — slow, cold, and carefully timed — breaks down phytic acid and makes nutrients more bioavailable.

Linseeds bring omega-3 fatty acids that support heart health and brain function. Oat bran lowers LDL cholesterol and feeds beneficial gut bacteria. Sunflower seeds add vitamin E and healthy fats that protect cells from oxidative stress.

These aren't ingredients we chose because they're trendy. They're ingredients that have proven themselves over thousands of years. We just brought them back together.`,
  },
  {
    title: "What Happens to Your Body When You Switch to Better Bread",
    brief:
      "The first week feels subtle. By week four, the difference is hard to ignore. Switching from refined bread to protein-rich, grain-dense bread changes how your body processes food, maintains energy, and builds tissue.",
    body: `Week one is usually the most surprising.

People who switch to Cadieux from ordinary bread often notice they're not as hungry mid-morning. The slice they had at breakfast is still working — releasing energy slowly, keeping blood sugar stable, avoiding the sharp drop that normally sends them reaching for a snack by 10am.

By week two, something else tends to shift. Digestion improves. The combination of oat bran, rye ferment, and linseeds feeds the gut microbiome in ways that refined bread simply doesn't. Bloating decreases. Regularity improves. The gut is getting what it needs.

Weeks three and four bring the changes that matter most to anyone who trains or stays active. With 7.2g of protein per slice, Cadieux provides meaningful muscle support with every meal. Amino acids from whey and oat protein are available after a workout, supporting recovery without requiring a separate shake or supplement.

The cumulative effect of better bread isn't dramatic. It isn't a transformation story. It's quieter than that — more energy in the afternoon, less hunger between meals, a body that's being consistently nourished rather than just filled.

That's what switching to better bread feels like. Not a revolution. Just a better baseline, every single day.`,
  },
];

export const PROCESS_STEPS = [
  { num: "01", title: "Mix",     desc: "Slow then fast. Every ingredient in before the first turn." },
  { num: "02", title: "Rest",    desc: "Fifteen minutes, undisturbed. Gluten settles, cultures wake." },
  { num: "03", title: "Portion", desc: "240g per loaf, weighed every time." },
  { num: "04", title: "Proof",   desc: "32°C, 75% humidity. Pulled the moment it's right." },
  { num: "05", title: "Bake",    desc: "Falling heat, 230°C down to 210°C. Thirty-five minutes, not a moment more." },
];

export const VIZAG_AREAS = [
  "Akkayyapalem",
  "Asilmetta",
  "Beach Road",
  "Bheemunipatnam",
  "Chinna Waltair",
  "Daba Gardens",
  "Dwaraka Nagar",
  "Gajuwaka",
  "Jagadamba Junction",
  "Kommadi",
  "Maddilapalem",
  "Madhurawada",
  "MVP Colony",
  "NAD Junction",
  "Pendurthi",
  "Rushikonda",
  "Sagar Nagar",
  "Seethammadhara",
  "Waltair Uplands",
  "Yendada",
];

export const STORES: Record<string, { name: string; address: string }[]> = {
  Madhurawada: [
    { name: "Madhu Super Market", address: "Madhurawada, Visakhapatnam — Store we supply" },
  ],
  "MVP Colony": [
    { name: "Sunny's Mart", address: "MVP Colony, Visakhapatnam — Store we supply" },
  ],
  "Chinna Waltair": [
    { name: "Robin's Nutri Store", address: "Chinna Waltair, Visakhapatnam — Store we supply" },
  ],
};

export type Retailer = {
  name: string;
  address: string;
  phone: string;
  hours: string;
};

// Areas + the supermarkets / retailers under each. Used by /store-locator.
// Real high-rated supermarkets per area (Google ratings); phone numbers are
// placeholders — replace with real outlet numbers when known.
export const RETAILERS: Record<string, Retailer[]> = {
  "Madhurawada / P.M. Palem": [
    { name: "DMart Madhurawada",        address: "NH16, Madhurawada, Visakhapatnam", phone: "+91 891 XXXXXXX", hours: "9 AM – 10 PM" },
    { name: "Vijetha Supermarket",      address: "Madhurawada, Visakhapatnam",       phone: "+91 891 XXXXXXX", hours: "8 AM – 10 PM" },
  ],
  "MVP Colony": [
    { name: "Vijetha Supermarket", address: "Ushodaya Junction, MVP Colony, Visakhapatnam", phone: "+91 891 XXXXXXX", hours: "9 AM – 10 PM" },
    { name: "More Super Market",   address: "MVP Colony, Visakhapatnam",                    phone: "+91 891 XXXXXXX", hours: "8 AM – 10 PM" },
  ],
  "Dwaraka Nagar": [
    { name: "Spencer's Hyper Market", address: "Rama Talkies Road, Resapuvani Palem, Dwaraka Nagar, Visakhapatnam", phone: "+91 891 XXXXXXX", hours: "9 AM – 10 PM" },
    { name: "Vardhan Super Market",   address: "48-10-32, Sri Nagar, Dwaraka Nagar, Visakhapatnam",                  phone: "+91 891 XXXXXXX", hours: "8 AM – 10 PM" },
  ],
  "Gajuwaka": [
    { name: "G Mart Super Market", address: "KL Rao Nagar, BC Road, Gajuwaka, Visakhapatnam",        phone: "+91 891 XXXXXXX", hours: "9 AM – 10 PM" },
    { name: "More Supermarket",    address: "DVSN Plaza, beside Mohini Cinemas, Gajuwaka, Visakhapatnam", phone: "+91 891 XXXXXXX", hours: "8 AM – 10 PM" },
  ],
  "Siripuram": [
    { name: "More For You", address: "10-1-47, Waltair Main Road, Siripuram Junction, Dutt Island, Visakhapatnam", phone: "+91 891 XXXXXXX", hours: "8 AM – 10 PM" },
  ],
  "Seethammadhara": [
    { name: "More Supermarket",          address: "HB Colony Road, Seethammadhara, Visakhapatnam",  phone: "+91 891 XXXXXXX", hours: "9 AM – 10 PM" },
    { name: "Heritage Fresh Supermarket", address: "P&T Colony, Seethammadhara, Visakhapatnam",      phone: "+91 891 XXXXXXX", hours: "8 AM – 10 PM" },
  ],
};
