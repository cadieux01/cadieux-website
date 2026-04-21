export type CartItem = {
  productIndex: number;
  name: string;
  price: number;
  qty: number;
  orderType: "once" | "sub";
  weeks?: number;
  day?: string;
  time?: string;
};

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const TIMES = ["7 – 9 am", "9 – 11 am", "12 – 2 pm", "5 – 7 pm", "7 – 9 pm"];
export const SUB_WEEKS = [2, 3, 4, 6];

export const PRODUCTS = [
  {
    name: "Core Element Protein Bread",
    tags: ["Multi Grains", "No Maida"],
    price: 140,
    protein: "7.2g protein per slice",
    weight: "240g net weight",
    desc: "Ancient grains, seeds, and five distinct protein sources — slow-fermented, cold-proofed, and baked to lock in structure.",
    image: "/hero.jpg",
  },
  {
    name: "Plain High Protein Bread",
    tags: ["Sandwich Bread", "10 Slices"],
    price: 110,
    protein: "7.2g protein per slice",
    weight: "400g packet",
    desc: "Clean, everyday bread built for high protein without the fuss. Soft sandwich slices with no compromise on nutrition.",
    image: "/grains.png",
  },
];

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
  {
    num: "01",
    tag: "Mixing",
    tagColor: "#d0d8ff",
    title: "Spiral Blend",
    highlight: "4 min slow · 15–18 min fast",
    desc: "Every ingredient is placed in the bowl before the first rotation begins. We use a hook attachment and build structure in two stages — low speed to bind, high speed to develop the gluten network fully.",
  },
  {
    num: "02",
    tag: "Dough Temp",
    tagColor: "#f5e6c8",
    title: "Temperature Control",
    highlight: "24°C – 26°C",
    desc: "Dough temperature is checked before and after every mix. Staying within this window ensures the fermentation that follows runs at the right pace — not too fast, never sluggish.",
  },
  {
    num: "03",
    tag: "Fermentation",
    tagColor: "#c8e6d0",
    title: "Bulk Rest",
    highlight: "~15 minutes",
    desc: "After mixing, the dough is left undisturbed at room temperature. This short bulk ferment allows the gluten to relax and the cultures to begin their work quietly.",
  },
  {
    num: "04",
    tag: "Scale",
    tagColor: "#d0d8ff",
    title: "Precise Portioning",
    highlight: "240 g per loaf",
    desc: "Each portion is weighed precisely to 240g before going into the mould. At this size, even a small deviation changes the bake — so we weigh every single one.",
  },
  {
    num: "05",
    tag: "Proofing",
    tagColor: "#c8e6d0",
    title: "Final Proof",
    highlight: "40–50 min · 32°C / 75% RH",
    desc: "Smaller loaves proof faster. We hold at 32°C with 75% humidity and watch the rise carefully — pulling at the right moment keeps the crumb tight and even throughout.",
  },
  {
    num: "06",
    tag: "Bake",
    tagColor: "#f5d0d0",
    title: "Falling Temperature Bake",
    highlight: "230°C → 210°C over 30–35 min",
    desc: "A 240g loaf bakes quicker and needs a shorter window. We start at 230°C to set the crust, then step down by 20°C every ten minutes — done in 30 to 35 minutes, not a moment more.",
  },
];

export const VIZAG_AREAS = [
  "Bheemunipatnam",
  "Chinna Waltair",
  "Dwaraka Nagar",
  "Gajuwaka",
  "Kommadi",
  "Madhurawada",
  "MVP Colony",
  "Pendurthi",
  "Rushikonda",
  "Seethammadhara",
  "Waltair Uplands",
];

export const STORES: Record<string, { name: string; address: string }[]> = {
  Madhurawada: [
    { name: "Madhu Super Market", address: "Madhurawada, Visakhapatnam — Cadieux Stockist" },
  ],
  "MVP Colony": [
    { name: "Sunny's Mart", address: "MVP Colony, Visakhapatnam — Cadieux Stockist" },
  ],
  "Chinna Waltair": [
    { name: "Robin's Nutri Store", address: "Chinna Waltair, Visakhapatnam — Cadieux Stockist" },
  ],
};
