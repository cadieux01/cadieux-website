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
    price: 149,
    protein: "High protein content",
    weight: "240g net weight",
    subtitle: "Ancient grains, seeds, whey protein. Baked to lock in structure.",
    desc: "Ancient grains, seeds, and five distinct protein sources — slow-fermented, cold-proofed, and baked to lock in structure.",
    image: "/hero.jpg",
    stats: [
      { target: 8, label: "Slices" },
      { target: 240, suffix: "g", label: "Net weight" },
      { target: 6, suffix: "g", label: "Fibre/slice" },
    ] as ProductStat[],
  },
  {
    slug: "high-protein",
    name: "High Protein Bread",
    tag: "Protein Bread",
    title: "Plain",
    tags: ["Sandwich Bread", "8 Slices"],
    price: 109,
    protein: "High protein content",
    weight: "320g net weight",
    subtitle: "Clean sandwich bread built for protein without the fuss. Soft slices, no compromise.",
    desc: "Clean, everyday bread built for high protein without the fuss. Soft sandwich slices with no compromise on nutrition.",
    image: "/grains.jpg",
    stats: [
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
      "Rich in protein. Rich in fiber. No maida, no refined sugar, no shortcuts.",
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
      { name: "Oat bran", role: "Soluble fiber, supports gut health" },
      { name: "Linseed (flax)", role: "Omega-3 fatty acids" },
      { name: "Sunflower seeds", role: "Vitamin E and healthy fats" },
      { name: "Whey protein isolate", role: "Premium protein source" },
      { name: "Soy protein", role: "Plant-based protein" },
      { name: "Sea salt", role: "Controls fermentation, lifts flavour" },
    ],
    testReports: [
      { metric: "Protein", value: "High", note: "NABL-accredited lab verified" },
      { metric: "Dietary fiber", value: "Rich", note: "Lab verified" },
      { metric: "Added sugar", value: "None", note: "No refined sugar added" },
      { metric: "Ingredients", value: "Real", note: "Verified quality standards" },
    ],
  },
  "high-protein": {
    description: [
      "Plain is the everyday Cadieux — a soft, clean sandwich loaf that happens to carry serious protein.",
      "Same careful process as our multigrain, just a milder crumb built for daily use: toast, sandwiches, kids' lunches, late-night eggs.",
      "High in protein. Eight slices per loaf. Nothing hidden.",
    ],
    media: [
      { type: "video", src: "/product-video-06.mp4", alt: "Plain protein bread close-up" },
      { type: "video", src: "/bread-eating-01.mp4", alt: "Bread being enjoyed" },
      { type: "image", src: "/grains.jpg", alt: "Grains used" },
      { type: "image", src: "/hero.jpg", alt: "Loaf hero shot" },
    ],
    ingredients: [
      { name: "Whole wheat flour", role: "Primary flour — no maida" },
      { name: "Whey protein isolate", role: "Premium protein source, clean taste" },
      { name: "Rye sourdough starter", role: "Slow fermentation, better digestion" },
      { name: "Oat flour", role: "Soft crumb, soluble fiber" },
      { name: "Cold-pressed sunflower oil", role: "Keeps slices tender" },
      { name: "Honey (trace)", role: "Balances ferment — no refined sugar" },
      { name: "Sea salt", role: "Structure and flavour" },
    ],
    testReports: [
      { metric: "Protein", value: "High", note: "NABL-accredited lab verified" },
      { metric: "Net weight", value: "320 g", note: "Per packet · verified on line" },
      { metric: "Added sugar", value: "None", note: "Trace honey for ferment only" },
      { metric: "Slices per loaf", value: "8", note: "Precision-cut on every bake" },
    ],
  },
};

export type BlogPostType = {
  title: string;
  slug: string;
  brief: string;
  body: string;
  meta_description: string;
  primary_keyword: string;
  secondary_keywords?: string[];
  date: string;
  author: string;
  pillar: string;
  tier: number;
};

export const BLOG_POSTS: BlogPostType[] = [
  // Tier 1 posts
  {
    title: "Where to Buy High-Protein Bread in Visakhapatnam",
    slug: "high-protein-bread-visakhapatnam",
    brief: "Visakhapatnam has exactly one place to find high-protein bread that's baked fresh every morning: our pickup points",
    body: `Visakhapatnam has exactly one place to find high-protein bread that's baked fresh every morning: our pickup points across the city, plus direct delivery to your door.

Most protein bread you'll find online ships from across the country — Delhi, Mumbai, Bangalore — which means it arrives days old. By the time it reaches your kitchen, the crumb has already begun to dry, the fermentation is stalled, and half the promise is already spent.

Cadieux is different because we bake here, in Vizag. Every loaf is built overnight and on your porch by dawn, still warm enough to feel the sourdough fermentation working through it.

## Pickup Locations

Our model is simple: baked fresh in small batches every morning, distributed to local retail partners who know their customers. Find us at select stores across MVP Colony, Madhurawada, and Chinna Waltair. Each location stocks both Plain and Multi-Grain.

The shelf window is 4–5 days from bake date. We stamp every loaf so you can verify freshness. No preservatives, no shelf-life tricks — just bread that is honest about what it is.

## Delivery to Your Door

We deliver across Vizag within 12 hours of a booking. Order by midnight for next-day morning delivery. Subscription keeps it even simpler: same day, same time, every week.

Distance-based fees apply (delivery logistics are real), but ordering a subscription locks in the lowest rate and ensures you never run out.

## Why Local Matters

A loaf shipped across India spends 3–5 days in transit. Cold chain breaks. Fermentation stalls. Moisture migrates. By the time it lands, it tastes like a loaf from last week, because it is one.

When you buy from us in Vizag, you're buying from the same day it was baked. Not yesterday. Not two days ago. Today.

That's what fresh bread means. Not a concept. Not a marketing claim. A physical fact you can taste.`,
    meta_description: "Where to find Cadieux high-protein bread in Vizag. Pickup locations, delivery zones, and how fresh local baking beats shipped national brands.",
    primary_keyword: "high protein bread Visakhapatnam",
    secondary_keywords: ["protein bread Vizag", "buy protein bread Vizag", "healthy bread Visakhapatnam"],
    date: "2026-06-22",
    author: "Sunny Raja",
    pillar: "Product-adjacent",
    tier: 1,
  },
  {
    title: "Multi-Grain vs Plain: Which Cadieux Loaf Fits Your Day",
    slug: "multigrain-vs-plain-cadieux",
    brief: "Both Cadieux loaves are built for the same mission: protein without compromise on taste. But they solve different problems.",
    body: `Both Cadieux loaves are built for the same mission: protein without compromise on taste. But they solve different problems.

## Multi-Grain: The Full Expression

Ancient grains. Seeds. Five protein sources. Dense, nourishing, structural — built to hold anything you put on it without collapsing into mush.

This is bread as architecture. Every slice carries the weight of what goes on top. Toast a slice with eggs and watch the rye sourdough hold firm. The seeds don't slide, the fermentation doesn't give. You get structure.

Multi-Grain is for people who eat bread as a platform. Who build things on top of it. Who want every nutritional note singing: fiber, omega-3s from linseed, minerals from ancient grains, steady amino acids from the protein.

Pairs with: avocado, sardines, roasted vegetables, soft cheese. Breakfast, lunch, or the 3 PM moment when you need something real.

## Plain: The Everyday Loaf

Clean. Soft. Built for the routine you already have. Toast, sandwiches, kids' lunches, late-night eggs on toast at 11 PM when you're not thinking about how many seeds are in there.

Plain is bread that doesn't make you work. It integrates. It becomes part of the day instead of announcing itself.

But don't mistake quiet for weak. Every slice carries serious protein, from whey isolate. Amino acids are there. Digestion is steady. You're getting what Multi-Grain delivers, just without the textural announcement.

Plain is for people who eat bread because it's part of the meal, not because they're studying the ingredients. It's the no-fuss answer.

Pairs with: anything. Butter and jam. Turkey and mustard. Eggs. Peanut butter. Works with your day, not against it.

## The Honest Truth

Both loaves win. Both are built the same way — overnight fermentation, cold proofing, falling-temperature bake. Both carry serious protein and fiber. Both taste like bread, not a supplement bar.

The only difference is texture and the story you want to feel in your mouth. One is bold. One is quiet. Both are right.

Try Multi-Grain if you're the person who reads ingredient labels for fun. Try Plain if you're the person who just wants good bread that happens to be high-protein. Or grab both and see what your body votes for after a week.

That's the only answer that matters anyway.`,
    meta_description: "Compare Cadieux Multi-Grain and Plain breads side-by-side. Macros, flavor, use-cases, and which one wins for your routine.",
    primary_keyword: "multigrain vs plain protein bread",
    secondary_keywords: ["cadieux multigrain", "cadieux plain", "which bread to choose"],
    date: "2026-06-22",
    author: "Sunny Raja",
    pillar: "Product-adjacent",
    tier: 1,
  },
  {
    title: "Protein Bread Delivery in Vizag: How It Works",
    slug: "protein-bread-delivery-vizag",
    brief: "Delivery in Vizag works because we control the bake and the route. No middleman. No delay. No cold chain breaks.",
    body: `Delivery in Vizag works because we control the bake and the route. No middleman. No delay. No cold chain breaks.

## How to Order

Visit cadieux.in/checkout. Choose Multi-Grain or Plain. Enter your delivery address. We instantly check serviceability — if you're within our delivery zone, you'll see available slots.

Slots open for delivery 12 hours from now onwards. A midnight booking gets bread at your door by noon the next day. The latest slot closes at 8 PM — books after that land the following day.

Distance-based delivery fee applies. Closer to our bakery in central Vizag, the fee is lower. Further out — Pendurthi, Gajuwaka — it's higher because logistics are real. We don't hide this. The fee is clear before you click.

## Why 12-Hour Lead Time

Fermentation can't be rushed. Cold-proof overnight, bake at dawn. Slice and pack by mid-morning. Load the delivery van by noon. You get bread that's 6–8 hours old, still warm from the oven.

If we promised same-day delivery, we'd have to bake without overnight rest. Fermentation wouldn't mature. Texture would collapse. We'd be shipping mediocre bread fast instead of quality bread slightly slower.

12 hours is the window where freshness and logistics align.

## Subscriptions: Set It and Forget It

Order once: you pay the full delivery fee each time. Subscribe and lock in a weekly recurring order on the same day/slot? Fee drops 15% and you never run out.

Subscriptions are weekly. You pick the day (Monday through Friday, morning or evening slot). We show up every week on that day. No thinking. No forgetting. Bread just arrives.

Change anytime. Pause for a week. Upgrade from Plain to Multi-Grain. The subscription admin panel is built for living life, not for contracts.

## Freshness Guarantee

Every loaf is stamped with the bake date. If your bread arrives and it's older than 3 days from bake, contact us. Full refund, no questions.

We've never had a claim. Because we control the whole chain: bake, pack, route. Freshness isn't a promise. It's a system built into operations.

That's why delivery is worth it. Not because it's convenient. Because it's fresh.`,
    meta_description: "How Cadieux bread delivery works in Visakhapatnam. Booking windows, slots, distance-based fees, and subscription benefits.",
    primary_keyword: "protein bread delivery Vizag",
    secondary_keywords: ["bread delivery Visakhapatnam", "fresh bread delivery Vizag", "cadieux subscription"],
    date: "2026-06-22",
    author: "Sunny Raja",
    pillar: "Product-adjacent",
    tier: 1,
  },
  {
    title: "Why Cadieux Bread Doesn't Compare Itself to Other Bread",
    slug: "why-cadieux-doesnt-compare",
    brief: "The philosophy behind Cadieux: why we don't benchmark against competitors. Bread as art, not commodity.",
    body: `I built Cadieux to be the answer to a question nobody was asking the right way.

Everyone else in the protein bread space says: "We have more protein than our competitor." "We're cheaper." "We're faster."

That's commodity thinking. That's the mindset that turned bread into something soulless in the first place.

Cadieux doesn't compare because comparison is the death of craftsmanship. The moment you start benchmarking against someone else's loaf, you've stopped making bread your way. You're making bread their way, but with one more gram of something.

## Bread is Art, Not Engineering

A competitor's loaf with an extra gram of whey protein isn't better bread. It's bread with more of one ingredient. That's engineering. That's adding.

Cadieux is built around subtraction. Remove the middleman. Remove the preservatives. Remove the dead time between bake and your kitchen. Remove the excuse to compromise.

What's left is just bread. But real bread. Built the way bread was built when it mattered — slowly fermented, cold-proofed, baked on a temperature curve that locks in structure and flavor.

The protein is there because we engineered the recipe to hold serious protein while staying bread. Not because we chased a number. The fiber is there because ancient grains happen to carry it. The taste is there because fermentation has had 18 hours to work.

We didn't add those things to beat someone else's specification sheet. They're there because we believe bread should be more than a vehicle for convenience.

## Why I Stopped Comparing

I spent the first three months of development doing exactly what every other brand does: looking at competitors' numbers. More protein than Brand X. Less sugar than Brand Y. Higher fiber than Brand Z.

Then I realized something. No one who actually cares about food uses comparison shopping to decide what to eat. You don't choose an apple because it has more vitamin C than a banana. You choose it because you want an apple.

The person who's going to buy Cadieux isn't comparing us to anyone else. They're asking: "Is this bread real? Can I trust it? Will it change how I feel?" Those aren't numbers. Those are feelings. Those are built into the process, not the specifications.

## The Right Question

So we stopped asking "How do we beat them?" and started asking "How do we make this bread irreplaceable?"

That's a different kind of work. It means showing up at 4 AM to bake. It means tasting every batch and throwing out anything that doesn't read right. It means telling customers no when they ask for a longer shelf life, because a longer shelf life means more compromise.

It means building in Vizag, serving Vizag, staying small, and refusing to scale faster than we can control quality.

That's not a strategy to win a comparison. That's a strategy to make comparison pointless.

If you're shopping by the numbers, we're probably not your bread. But if you're looking for bread that tastes like someone cared, that's built the way bread should be built, that proves it every time you taste it — we're the only choice.

Not because we're better on a spec sheet. Because we stopped using spec sheets a long time ago.`,
    meta_description: "The philosophy behind Cadieux: why we don't benchmark against competitors. Bread as art, not commodity.",
    primary_keyword: "premium high-protein bread philosophy",
    secondary_keywords: ["cadieux brand", "bread as art", "why cadieux"],
    date: "2026-06-22",
    author: "Sunny Raja",
    pillar: "The Cadieux Difference",
    tier: 1,
  },
  {
    title: "The 18-Month Build: How One Loaf Took 70 Parameters",
    slug: "the-18-month-build",
    brief: "The real story behind Cadieux: 18 months of trials, three NABL labs, and why every number mattered.",
    body: `The idea came in September 2024 in the middle of a fitness routine that had stopped feeling like anything but survival.

Same shake. Same eggs. Same bar. Every day. The routine was working — strength was building, body composition was shifting — but eating well had become mechanical. No pleasure. No texture. No variation without guilt.

I went looking for high-protein bread. Found it online. Tried a loaf shipped from Delhi. It arrived four days old, texture already compromised, taste like cardboard that happened to have protein added to it.

That moment should have been simple: buy from a different company. But I made the decision that would define the next 18 months: I'd build it instead.

## The First Hundred Trials

Building bread isn't like building a software product where you ship, get feedback, iterate. Bread has a rhythm. Overnight fermentation. Cold proof. Bake on a curve. The feedback loop is 24 hours minimum.

The first question was basic: what does high-protein bread taste like? Not as a concept. In reality. I had to bake it first, fail first.

The answer was: it doesn't taste like anything good, not at first. Whey protein is bitter. Soy protein is flat. Mix them into a dough without understanding fermentation and you get dense, bitter loaves that trap moisture and collapse into gum.

So I started measuring things. Sixty to seventy parameters on every batch.

The obvious ones: protein content, fiber, sugar, sodium. The obscure ones: protein structure, amino acid profile, absorption rates. How the crust develops under different temperatures. How the crumb holds moisture over time. How fermentation interacts with different protein sources.

I tasted every loaf. Threw away the ones that weren't right. Didn't matter that I'd spent all night baking them. If they weren't good, they weren't going anywhere.

## Three Independent Labs

At month six, I had loaves that tasted good. But I needed to know what I had actually built.

So I went to three different NABL-accredited labs. Not because one was enough, but because I didn't want to trust my process to a single data point.

Lab One tested protein and amino acid profiles. Lab Two tested absorption rates in digestive simulation. Lab Three tested fiber, sugar, sodium, and shelf-stability under different storage conditions.

The data came back. The bread I'd built was holding what I thought it was holding. Sometimes better. Sometimes I found unexpected gaps.

The labs also helped me understand something I didn't expect: most "high-protein" bread on the market doesn't optimize for absorption. They optimize for the number you can print on the package. What you actually absorb, what your body actually uses — that's a different measurement.

Cadieux was built for absorption. Real protein. Real utilization. Real results.

## Four States. Eighteen Months.

I traveled through Karnataka, Maharashtra, Telangana, and Andhra Pradesh talking to bakers, fermentation specialists, nutritionists overseas who understood protein digestibility. The information was fragmented. No one had put it together for bread yet.

By month 12, I had a loaf. It was right. It tasted right. The numbers were right. The process was right.

Then I had to run it through a production scale-up. What works in a home kitchen with obsessive attention doesn't always work at 50 loaves a day. Ovens have different quirks. Ingredient batches vary. Small adjustments cascade.

Months 12 through 18 were about making a craft process repeatable without losing its soul.

## Why It Took This Long

Because I couldn't ship mediocre bread and call it a business. Because "close enough" isn't how bread works. Because every customer deserves the same experience every time.

The industry standard is: ship, get feedback, iterate. That works for software. For bread, it means putting mediocre loaves in people's kitchens. It means building a customer base that tolerates compromise. It means starting your brand on weak foundations.

I chose different. I chose: perfect the process, then ship. No customer should ever wonder if this loaf is as good as the last one. Every loaf should be built the same way. Every loaf should work the same way.

18 months sounds like a long time. It's the time it takes to do it right.

The moment I ship the first less-than-perfect loaf is the moment I've admitted I'm okay with not caring. I'm not there yet. Maybe I never will be.

That's not efficiency. That's respect for the customer.`,
    meta_description: "The real story behind Cadieux: 18 months of trials, three NABL labs, and why every number mattered.",
    primary_keyword: "cadieux bread development story",
    secondary_keywords: ["how cadieux is made", "bread engineering", "quality standards"],
    date: "2026-06-22",
    author: "Sunny Raja",
    pillar: "Founder Story",
    tier: 1,
  },
  {
    title: "Healthy Bread in Visakhapatnam: A Local Buyer's Guide",
    slug: "healthy-bread-visakhapatnam-guide",
    brief: "Healthy bread in Vizag exists. You just have to know what you're looking for.",
    body: `Healthy bread in Vizag exists. You just have to know what you're looking for.

The category doesn't exist yet in most shops. Bread is bread. It all sits in one corner. But within that corner, there are loaves that are built differently, and loaves that are just sliced air with preservatives.

This is a local buyer's guide to identifying the difference.

## What to Read First: The Label

Start with the ingredient list, not the nutrition panel. Nutrition panels are required by law. Ingredient lists are where honesty lives.

Real healthy bread has a short ingredient list. Flour, salt, water, yeast, sourdough culture. Maybe seeds. Maybe ancient grains. Maybe a protein source.

If the ingredient list looks like a chemistry textbook — emulsifiers, dough conditioners, preservative cocktails, "natural flavoring" — that's industrial bread pretending to be wholesome. Move past it.

Count the ingredients. Cadieux has eight. Most shelf-stable industrial breads have 15+. Not all long lists are bad, but most are.

## What to Look For: Protein-to-Carb Ratio

The label will show protein and carbohydrates. Do a quick mental math:

A healthy protein bread should have at least 0.15g protein per 1g of carbs. So if a slice has 20g carbs, it should have at least 3g protein.

Most regular white bread has 2g protein and 30g carbs. That's 0.07. You're eating carbs with a protein afterthought.

Better bread flips that relationship.

## Fermentation: The Invisible Metric

You can't see fermentation on a label, but you can find evidence of it.

Look for words: "sourdough fermented," "long fermentation," "overnight proofed," "natural starter." These aren't marketing buzzwords — they're signals that the bread sat for time. Long fermentation breaks down phytic acid (which blocks mineral absorption) and pre-digests starches.

If the label says "rapid-rise" or "quick-bake," the bread had minimal fermentation. It'll taste airy. It'll digest fast. It'll leave you hungry.

## Sugar: The Hidden Problem

"No added sugar" is good. But read closer. Is there honey? Agave? Malt extract? These are sugars with fancy names.

Healthy bread has minimal added sugar because fermentation does the sweetening. A well-fermented loaf tastes sweet without needing to add anything.

Compare: regular bread might have 4g added sugar per loaf. Healthy bread has 0–1g. That's the difference between a loaf that keeps you steady and one that spikes your glucose.

## Shelf Life: A Red Flag

If a bread promises 3 weeks shelf life, it's full of preservatives. Real fermented bread keeps 4–5 days. That's it.

Some brands will add citric acid, calcium propionate, or enzyme cocktails to stretch shelf life. Those aren't poison, but they're not food either.

Buy bread that's honest about its lifespan.

## Local Is Better Than Imported

A loaf baked in Vizag yesterday is better than a loaf baked in Delhi five days ago, no matter what the label says.

Fermentation doesn't pause in transit. The cold chain breaks. The texture shifts. The nutrition is there but the living aspect is gone.

Local bakeries in Vizag who do proper fermentation are worth the search. We're one of them. But there are others worth finding.

The point: you have choices in Vizag. Use them.

## The Honest Test

Best test for healthy bread? Eat a slice. How do you feel 2 hours later? Steady energy or a crash? Satiated or hungry again?

Your body knows. Trust it more than you trust any label.`,
    meta_description: "What to look for in healthy bread in Vizag. Label reading guide, ingredient standards, and where to find quality options.",
    primary_keyword: "healthy bread Visakhapatnam",
    secondary_keywords: ["healthy bread Vizag", "best bread Visakhapatnam", "bread label guide"],
    date: "2026-06-22",
    author: "Sunny Raja",
    pillar: "Product-adjacent",
    tier: 1,
  },
  // Tier 2 posts (abbreviated for length - same structure)
  {
    title: "Protein Sources Beyond Chicken: 9 Foods That Pull Their Weight",
    slug: "protein-sources-beyond-chicken",
    brief: "Everyone asks the same question: where do you get protein without chicken getting boring? The answer isn't another meat.",
    body: `Everyone asks the same question: where do you get protein without chicken getting boring? The answer isn't another meat. It's understanding that protein density isn't confined to animal sources. It's distributed across foods you already know.

Ranked by practical utility for people who train: Whey Protein Isolate (30g per serving), Eggs (6g per egg), Paneer (25g per 100g), Lentils/Dal (9g per cooked cup), Greek Yogurt (10g per 100g), Sesame Seeds (9g per 30g serving), Soy Protein (20g per 50g serving), Chicken (35g per breast), Fish (25g per 100g).

The actual point: Protein doesn't require chicken. It requires density, repetition, and pairing. Bread is the carrier. Cadieux exists because protein makes sense on bread.`,
    meta_description: "Go beyond chicken for protein. 9 high-protein foods ranked by density, cost, and sustainability.",
    primary_keyword: "protein sources besides chicken",
    secondary_keywords: ["vegetarian protein", "protein alternatives", "high protein foods India"],
    date: "2026-06-21",
    author: "Sunny Raja",
    pillar: "Protein Education",
    tier: 2,
  },
  {
    title: "How to Read a Bread Label Without Getting Fooled",
    slug: "how-to-read-bread-label",
    brief: "Bread labels lie without lying. They tell the truth in a way that makes bad bread sound good. Here's how to read past the hype.",
    body: `Bread labels lie without lying. They tell the truth in a way that makes bad bread sound good.

Key things to check: Serving Size (most brands trick you with tiny serving sizes), Protein-to-Carb Ratio (divide protein by carbs; should be at least 0.15), Sugar Hiding (honey, agave, malt are still sugar), Fiber Tricks (added fiber vs whole grain fiber), Sodium Trap (check sodium levels), Ingredient Order, No Preservatives Claim, and Fermentation (trust words like sourdough fermented).

The test that never lies: Read the label. Check the ratio. Verify the fermentation. Then buy a loaf and eat it. Your body doesn't read labels. Trust your experience.`,
    meta_description: "Decode bread labels like a pro. Protein claims, carb tricks, and how to spot real bread vs marketing hype.",
    primary_keyword: "how to read bread label",
    secondary_keywords: ["bread nutrition label", "bread label claims", "high protein bread"],
    date: "2026-06-21",
    author: "Sunny Raja",
    pillar: "Protein Education",
    tier: 2,
  },
  {
    title: "Protein for People Who Lift Before Work",
    slug: "protein-early-morning-workout",
    brief: "You train at 5 AM. You work at 9 AM. Protein needs to arrive and get to work on time.",
    body: `You train at 5 AM. You work at 9 AM. Protein needs to arrive and get to work on time.

Pre-Workout (30 min before): One slice of bread with peanut butter (20 seconds, 12g protein).
Post-Workout (0-30 min): Two slices with eggs (4 minutes, 20g protein).
Waiting Period (2-3 hours post): Another slice with paneer (15-20g protein).

Total before 9 AM: 50g protein. By lunch, you're already hit your morning protein target. Bread is the carrier that makes 30 minutes of eating possible when you're rushing.`,
    meta_description: "Pre-workout + post-workout protein strategy for early morning training. What to eat, when, and why bread matters.",
    primary_keyword: "protein for early morning workout",
    secondary_keywords: ["pre workout breakfast", "post workout protein", "strength training nutrition"],
    date: "2026-06-21",
    author: "Sunny Raja",
    pillar: "Lifestyle",
    tier: 2,
  },
  {
    title: "The 30-Gram Breakfast: Built on Two Slices",
    slug: "protein-breakfasts-two-slices",
    brief: "30g protein at breakfast stops you from hunting for snacks at 10 AM. Two slices of bread plus something else. Done in under 7 minutes.",
    body: `30g protein at breakfast stops you from hunting for snacks at 10 AM.

Five options: Bread + Eggs (7 min, 30g), Bread + Paneer (5 min, 32g), Bread + Peanut Butter + Banana (4 min, 30g), Bread + Leftover Chicken (3 min, 42g), Bread + Greek Yogurt + Granola (5 min, 25g).

The rule: Two slices of high-protein bread is your baseline (12g). You need one more thing that's 18g+ to hit 30g. Pick one. Try it for a week. Watch the difference at 3 PM.`,
    meta_description: "Five complete high-protein breakfast ideas, all built on two slices of high-protein bread. Ready in under 7 minutes.",
    primary_keyword: "high protein breakfast ideas",
    secondary_keywords: ["30g protein breakfast", "quick breakfast", "breakfast recipes"],
    date: "2026-06-21",
    author: "Sunny Raja",
    pillar: "Lifestyle",
    tier: 2,
  },
  {
    title: "Protein Quality vs Protein Quantity: Why Absorption Wins",
    slug: "protein-quality-vs-quantity",
    brief: "Everyone counts grams. Nobody counts what their body actually uses. 20g of quality protein beats 30g of mediocre protein.",
    body: `Everyone counts grams. Nobody counts what their body actually uses.

Complete protein has all nine essential amino acids. Bioavailability is how much your body actually absorbs. Whey: 97-99% bioavailable. Eggs: 97%. Chicken: 93-98%. Lentils: 60-75%.

Your goal: amino acids reaching muscle tissue, not sitting in digestive system being poorly absorbed. Quality over quantity. The practical test: Eat 30g mediocre, eat 20g quality, track how you feel 3 hours later.`,
    meta_description: "Why 20g of quality protein beats 30g of mediocre protein. Understanding amino acid profiles and bioavailability.",
    primary_keyword: "protein quality absorption",
    secondary_keywords: ["complete protein", "amino acid profile", "protein bioavailability"],
    date: "2026-06-21",
    author: "Sunny Raja",
    pillar: "Protein Education",
    tier: 2,
  },
  {
    title: "Fibre and Protein in the Same Bite: Why It Matters",
    slug: "fibre-and-protein-same-bite",
    brief: "Protein fills you. Fiber keeps you full. When they arrive in the same bite, something shifts.",
    body: `Protein fills you. Fiber keeps you full. When they arrive in the same bite, something shifts.

Protein signals fullness (2-3 hours). Fiber slows digestion (3-4 hours). Together: both messages simultaneously. Fullness that lasts 4+ hours.

Regular white bread spikes glucose → insulin crash → hungry 90 min later. High-protein, high-fiber bread: glucose rises steadily → mild insulin → stable 3+ hours. No crash. No hunger.

One good meal beats three mediocre ones every time.`,
    meta_description: "Why combining fiber and protein in one food creates better satiety, slower digestion, and steadier energy.",
    primary_keyword: "fiber and protein together",
    secondary_keywords: ["satiety", "slow digestion", "stable energy", "fiber benefits"],
    date: "2026-06-21",
    author: "Sunny Raja",
    pillar: "Protein Education",
    tier: 2,
  },
  {
    title: "Eating Well When Your Day Is Already Full",
    slug: "eating-well-busy-professionals",
    brief: "You don't have time to meal prep. You have time for breakfast, lunch, and coffee. Eating well is built into your routine.",
    body: `You don't have time to meal prep. You have time for breakfast, lunch, and coffee.

Eating well isn't about perfection. It's about building it into your routine so it requires zero thinking.

Breakfast (same every day): Two slices Cadieux + eggs (30g, 4 min).
Lunch: Pre-made protein + bread (25g, no prep).
3 PM: Coffee + bread + peanut butter (16g).
Dinner: Takeout + bread (20g).
Total: 91g protein without adding time.

Busy people don't need time. They need one decision (what's breakfast every day?) and then habit does the work.`,
    meta_description: "Nutrition for busy people. How to eat well without adding complexity to your day. Built on routine, not planning.",
    primary_keyword: "nutrition for busy people",
    secondary_keywords: ["easy healthy eating", "quick nutrition", "busy professional meals"],
    date: "2026-06-21",
    author: "Sunny Raja",
    pillar: "Lifestyle",
    tier: 2,
  },
  {
    title: "Why Freshness Beats Shelf Life",
    slug: "freshness-vs-shelf-life",
    brief: "The bread industry solved shelf life 50 years ago. And in solving it, they killed bread.",
    body: `The bread industry solved shelf life 50 years ago. And in solving it, they killed bread.

Shelf life requires: preservatives, emulsifiers, dough conditioners, often extra sugar. Bread that lasts 3 weeks. Bread that's technically dead the moment it came out of the oven.

Freshness requires: 4-5 days max. No preservatives. No emulsifiers. What you get: loaf still settling, crumb developing, flavor deepening, texture needing no chemical intervention because it's still alive.

Fermented bread continues working 24-48 hours after baking. Starches breaking down. Amino acids more bioavailable. Bread still becoming better.

Cadieux chose: bake here, deliver within 24 hours. Inconvenient? Yes. Worth it? Ask your body at 2 PM how long it stays satiated from fresh bread vs bread shipped 5 days ago.`,
    meta_description: "Why local baking with a short shelf life is better than national distribution with preservatives. The tradeoff that matters.",
    primary_keyword: "fresh bread shelf life",
    secondary_keywords: ["local baking", "preservatives bread", "fresh vs packaged"],
    date: "2026-06-21",
    author: "Sunny Raja",
    pillar: "The Cadieux Difference",
    tier: 2,
  },
  // Keep the original 3 posts
  {
    title: "Why Protein Bread Is the Future of Everyday Eating",
    slug: "why-protein-bread-future",
    brief: "Most people don't realise their bread is working against them. The future isn't eating less — it's eating smarter.",
    body: `Most people grab bread without a second thought. Protein bread changes that equation entirely.

When you replace empty carbohydrates with high-quality protein sources — whey, oat protein, seeds, and ancient grains — the same slice of bread becomes something functional. It slows digestion, feeds muscle tissue, supports your immune system, and keeps hunger at bay far longer.

The shift doesn't require a new diet plan or a lifestyle overhaul. It just requires better bread.

Cadieux was created for exactly this reason. Choosing Cadieux over ordinary bread is one of those quiet decisions that change everything. Same routine. Better result. Every single day.`,
    meta_description: "Why protein bread is the future of everyday eating and how Cadieux is leading the way.",
    primary_keyword: "why protein bread matters",
    secondary_keywords: ["protein bread benefits", "future of bread", "high protein nutrition"],
    date: "2026-06-20",
    author: "Sunny Raja",
    pillar: "Protein Education",
    tier: 2,
  },
  {
    title: "The Ancient Grains We Swear By",
    slug: "ancient-grains-cadieux",
    brief: "Rye, oats, linseed, and sunflower seeds have been feeding people for thousands of years. We just brought them back together.",
    body: `For most of human history, bread was made from whatever grains grew nearby. These grains weren't just calories. They were dense in fibre, minerals, and slow-digesting carbohydrates.

At Cadieux, we've gone back. Rye sourdough ferment forms the base of every loaf. The fermentation process — slow, cold, and carefully timed — breaks down phytic acid and makes nutrients more bioavailable.

Linseeds bring omega-3 fatty acids. Oat bran lowers LDL cholesterol. Sunflower seeds add vitamin E and healthy fats.

These aren't ingredients we chose because they're trendy. They're ingredients that have proven themselves over thousands of years.`,
    meta_description: "The ancient grains used in Cadieux bread and why they matter for nutrition.",
    primary_keyword: "ancient grains bread",
    secondary_keywords: ["rye sourdough", "fermented grains", "nutritious bread"],
    date: "2026-06-20",
    author: "Sunny Raja",
    pillar: "Protein Education",
    tier: 2,
  },
  {
    title: "What Happens to Your Body When You Switch to Better Bread",
    slug: "body-changes-better-bread",
    brief: "The first week feels subtle. By week four, the difference is hard to ignore.",
    body: `Week one is usually the most surprising. People who switch to Cadieux often notice they're not as hungry mid-morning. The slice they had at breakfast is still working.

By week two, something else tends to shift. Digestion improves. The combination of oat bran, rye ferment, and linseeds feeds the gut microbiome in ways that refined bread simply doesn't.

Weeks three and four bring the changes that matter most. Cadieux provides meaningful muscle support with every meal. Amino acids are available after a workout, supporting recovery.

The cumulative effect isn't dramatic. It's quieter than that — more energy, less hunger, a body that's being consistently nourished rather than just filled.`,
    meta_description: "What happens to your body when you switch from regular bread to high-protein bread.",
    primary_keyword: "benefits of switching to protein bread",
    secondary_keywords: ["energy levels", "digestion improvement", "body composition"],
    date: "2026-06-20",
    author: "Sunny Raja",
    pillar: "Protein Education",
    tier: 2,
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
