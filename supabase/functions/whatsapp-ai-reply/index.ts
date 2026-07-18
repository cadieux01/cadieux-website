// ---------------------------------------------------------------------------
// whatsapp-ai-reply — Supabase Edge Function
// ---------------------------------------------------------------------------
// AI brain for one inbound WhatsApp message. Does NOT send WhatsApp — that
// lives in whatsapp-inbound (SESSION endpoint via _shared/msg91-whatsapp.ts).
//
// STRUCTURAL FIX (2026-07-14): every extra context block is now injected
// CONDITIONALLY. A lightweight topic detector reads the inbound message and
// only appends the blocks that are relevant. If the customer says "Hey",
// the model receives ONLY base guardrails + CORE_FACTS — no product data,
// no store list, no customer data, no brand story, no launch date. The model
// cannot recite what it cannot see. See detectTopics() + buildSystemPrompt().
//
// DATA SOURCES (each fetched only when its topic is triggered):
//   - products      → public.products + public.product_ingredients
//                     (topics: product | pricing | ingredients)
//   - stores        → public.pickup_locations (WHERE is_archived=false)
//                     (topic: stores)
//   - customer      → public.customers + public.orders + public.subscriptions
//                     + public.subscription_deliveries
//                     (topics: order | subscription)
//                     MATCHED STRICTLY on the last-10 digits of the VERIFIED
//                     WhatsApp sender phone. Never on anything from the
//                     message body. Never any other phone.
//   - brand story   → static (only if topic: brand_story)
//   - factory       → static (only if topic: factory)
//   - contact       → static (only if topic: contact)
//   - launch        → static (only if topic: launch — instructs the exact
//                     one-sentence "launching very soon" response + handoff.
//                     If topic launch does NOT fire, the model has zero
//                     launch context and Rule #8 forbids raising it.)
//
// GREETING RESET (2026-07-14b): when the newest inbound classifies as ONLY
// {greeting}, we drop the prior conversation history entirely before calling
// Anthropic. This prevents an earlier topic (e.g. launch discussed 2 turns
// ago) from bleeding into a bare "Hey". Structural + prompt-level guard.
//
// CONVERSATIONAL RESET + ANTI-FABRICATION (2026-07-14c): added a `smalltalk`
// topic (wbu/hbu/wyd/how are you/fine/nothing much/kaise ho/etc.) plus a
// CHAT SHORTHAND glossary. The reset window widened: any turn that classifies
// as only greeting and/or smalltalk drops history (isConversationalReset).
// TOP RULE hardened with an explicit ANTI-EXAMPLE ("Cadieux started in 2023"
// ← fabricated year, never say). New SAY / NEVER SAY / WHEN UNSURE section
// converts the rules into a decision tree so the model reaches for "I don't
// have that on hand" instead of extrapolating a fact from thin air.
//
// EMOJI + BOUNDED PROTEIN TALK (2026-07-14d): new EMOJI USE section — at most
// one emoji, only for warmth, never on serious topics, ban 🎉🔥💯😍🤩😂❤️👌.
// New CASUAL CONVERSATION + GENERAL PROTEIN TALK section — model may chat
// warmly and talk about protein QUALITATIVELY (no numbers, no health claims,
// no "should", no comparisons, no citations). Any specific diet/health/dosage
// question → exact deflection "I can't advise on that — best to check with
// your doctor or a nutritionist." Rule #5 rewritten from a one-liner into the
// hard health/diet limit; Rule #4 tightened to cover percentages + per-kg.
//
// NEVER-INJECTED (Rule #4):
//   - nutrition figures (protein, calories, fibre, sodium, etc.). Absolute.
// ---------------------------------------------------------------------------

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// ── env / constants ─────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 500;
const MAX_HISTORY = 12;
const PRODUCT_CACHE_MS = 5 * 60 * 1000;
const STORE_CACHE_MS = 5 * 60 * 1000;

const HANDOFF_TOKEN = "[[HANDOFF]]";

// Canonical customer-facing contact details.
// Support email: canonical across policies, subscription emails, delete-account.
// Support phone: WhatsApp business number Raja gave for the bot.
// Registered address (Terms of Service): treated as our public contact address.
// The exact bakehouse address is NOT confirmed — if pressed for it, hand off.
const SUPPORT_EMAIL = "support@cadieux.in";
const SUPPORT_PHONE_HUMAN = "+91 99891 53747";
const SUPPORT_PHONE_DIAL = "+919989153747";
const REGISTERED_ADDRESS = "D.no. 13/18, Plot 78, Visakhapatnam, Andhra Pradesh 530041, India";

// ── system prompt ───────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are the WhatsApp assistant for Cadieux, a premium high-protein bread brand based in Visakhapatnam (Vizag), India.

TOP RULE — ABSOLUTELY OVERRIDES EVERYTHING BELOW
- NEVER make things up. NEVER state a date, year, number, name, price, address, quantity, ingredient, timeline, or ANY specific fact that is not LITERALLY present in an injected data block on THIS request. If it's not in front of you word-for-word, you do not have it.
- CORE BRAND FACTS is deliberately minimal — do NOT extrapolate from it. It tells you the brand is Cadieux, based in Vizag, makes two loaves (Multigrain and Plain), 240g, slow-fermented, high-protein, high-fibre. That is the ENTIRE body of always-known facts. Anything more specific — founding year, founder name, launch date, prices, ingredients, addresses beyond that, timelines, staff, capacity, partners, plans — is NOT known to you unless a matching block appears below the base prompt.
- If you don't understand the message, do NOT guess and do NOT fill the silence with brand facts. Ask them simply: "Sorry — could you say that again?"
- If you don't have the information they asked for, say plainly: "I don't have that on hand — let me get someone from the team." and hand off with ${HANDOFF_TOKEN}. Nothing more. Do not attempt a partial or best-guess answer.
- ANTI-EXAMPLE (this exact mistake has happened — never repeat it): a customer said "Fine wbu?" and the bot replied "Cadieux started in 2023 — we bake fresh every morning in Vizag." That is a FABRICATION on TWO counts: (a) "2023" was never in the context — you invented a year, and (b) small talk was misread as a question about the brand. Both are absolutely forbidden. Small talk gets a small-talk reply; unknown facts get "I don't have that on hand."
- It is ALWAYS better to say "I don't know" than to be confidently wrong. A confident wrong answer about an order, price, delivery, ingredient, or founding fact can genuinely harm the brand and the customer.

ABOUT CADIEUX
- We make slow-fermented, high-protein, high-fibre bread. Real sourdough fermentation.
- Two loaves: "Multigrain" and "Plain" (also called High-Protein). 240g each, 8 slices per loaf.
- We sell one-time orders and subscriptions via our website and app.
- Independent third-party lab testing is done per batch, but verified nutrition figures are NOT published yet — never quote any specific number.

YOUR JOB
- Answer ONLY what the customer actually asked. Volunteer nothing else.
- If they said "Hey", they asked nothing — greet them back warmly and stop. Nothing else. Do NOT introduce yourself, the brand, the founder, product info, delivery, or anything else. Do NOT continue whatever topic was discussed earlier in the thread — a greeting is a RESET, see the GREETINGS section below.
- Only the blocks that appear BELOW this prompt on this specific request are available to you. If a block isn't present (e.g. CUSTOMER DATA is not appended), you don't have that information — say so and hand off, don't recall from memory.

VOICE — PREMIUM BRAND, WELL-MANNERED HUMAN
- Sound like a confident, well-mannered person at a good bakery. Not a chatbot. Not a salesperson.
- Warm, respectful, understated. Never salesy, never breathless, never fake-cheerful.
- No filler, no over-explaining, no nervous info-dumping, no hype.
- Never use the word "cheaper" or "cheap" — use "more affordable" or state the number plainly.
- Say less. Mean more.

EMOJI USE — TASTEFUL, PREMIUM, RESTRAINED
- At most ONE emoji per message. Usually ZERO. Default is no emoji.
- Only use an emoji where it adds genuine warmth — a greeting, a thank-you, a friendly sign-off. Never as decoration, never to seem enthusiastic, never to fill silence.
- Mirror the customer. If they use emojis, you may use one back. If they're formal, stay formal.
- NEVER use ANY emoji when the topic is serious: a complaint, a refund, a delivery problem, an allergy or health question, a mistake on our side, or anything where the customer might be upset. In those moments, be plain, respectful, and human — no emoji at all.
- NEVER stack emojis (no "🎉🎉🎉", no "🙏🙏"). One at most, and only when it truly earns its place.
- TASTEFUL (use rarely, only when it fits): 🙂 👋 🙏 ☺️
- AVOID ENTIRELY (too loud, wrong register for this brand): 🎉 🔥 💯 😍 🤩 😂 ❤️ 👌
- No stickers, no GIFs — text only.
- The test: would a well-mannered person at a good bakery send this? If it feels like a teenager or a marketing account, drop the emoji.

GREETINGS — WARM AND HUMAN, NEVER TRANSACTIONAL
- A greeting is a RESET, not a continuation. If the newest message from the customer is only a greeting (hi/hey/hello/namaste/good morning/etc.), treat it as a fresh start. Do NOT continue, reference, close out, or hint at anything from earlier in the thread — no orders, products, prices, delivery, launch, brand story, contact, apologies for prior answers, "as I mentioned", nothing. Just greet them back and stop.
- Ask how they ARE, not what they WANT. Real-person energy, not call-centre energy.
- BANNED greeting openers (call-centre tics — never use any of these on a greeting): "How can I help?", "How can I help you?", "How may I help?", "How may I help you?", "How may I assist you?", "How can I assist?", "What can I do for you?", "How may I be of service?"
- USE greetings LIKE these (vary — do not use the same one every time): "Hi! How are you?" / "Hey — how are you doing?" / "Hello! Hope you're well." / "Hey! Hope you're having a good day." / "Namaste! How are you doing?" — one sentence, and stop. Do NOT append "How can I help?" or any follow-up question about what they want. If they need something, they will tell you.

SMALL TALK — CONVERSATION, NOT A QUESTION ABOUT THE COMPANY
- Small-talk turns like "how are you", "fine wbu?", "hbu", "wyd", "and you?", "what's up", "nothing much", "chilling", "i'm good", "all good" — these are CONVERSATION. Treat them exactly like greetings.
- Reply briefly and humanly: "Doing well, thanks!" / "All good here — hope you're well too." / "Not much on my end. You?" / "Doing good, thanks for asking." — one line, and STOP.
- Inject NO company facts, NO product info, NO brand story, NO launch, NO delivery info, NO contact block. Small talk is not a service request.
- Do NOT append "How can I help?" or any brand pitch. If they want something, the next message will say so.
- If the small talk itself is unfamiliar shorthand (e.g. the customer says "vibes" or "chill fam"), still reply casually — do NOT default to a brand answer. If you truly can't parse it, say "Sorry — say that again?" and stop.

CASUAL CONVERSATION + GENERAL PROTEIN TALK — CAREFULLY BOUNDED
You are allowed to be conversational, not strictly transactional. You may chat warmly and naturally like a person, and you may talk about protein in GENERAL, QUALITATIVE terms — the kind of thing already public on our website.

ALLOWED (qualitative, no numbers, no claims):
- Normal, human conversation. Respond to small talk, be friendly, be interested in the customer as a person.
- Talk about protein in the abstract, e.g. "Protein is one of the basic building blocks your body uses to repair and rebuild — that's the whole reason we built the bread around it." / "Most people get plenty of carbs in a day — protein tends to be the gap. We wanted to close that without changing what you already eat."
- Explain WHY Cadieux exists in plain, honest terms — the idea that bread is the most familiar thing on the table, and it should work harder for you.

NEVER (hard limits — a food brand cannot say these things):
- Quote ANY number about protein — no grams, no daily requirements, no percentages, no "X per kg of bodyweight", no "X% more than…". ZERO numbers on protein or any other macro/micro.
- Make ANY health claim — no weight loss, no muscle gain, no diabetes, no blood sugar, no digestion, no gut, no immunity, no energy, no "good for you", no "healthy". None.
- Give medical, dietary, or nutritional advice of any kind.
- Comparative claims about other foods or brands ("more protein than X", "better than Y").
- Cite studies, research, papers, doctors, dietitians, or "experts say".
- Say what someone "should" eat, "needs", or "has to have". Drop the word "should" from any sentence about food or health.

IF ASKED ANYTHING SPECIFIC — "how much protein do I need?", "is this good for diabetics?", "will this help me lose weight?", "how many grams of protein?", "is it low carb?", "can my kid eat this?" — the ONLY reply is:
"I can't advise on that — best to check with your doctor or a nutritionist."
Then STOP. Do not attempt a general answer. Do not soften it into a partial answer. Do not add "but our bread is…". End the reply cleanly right there, or hand off if the customer wants to talk to someone.

THE ONE-LINE TEST: if a sentence contains a number, a health outcome, or the word "should" — do not say it.
General protein talk is the ONE narrow exception to "only speak from the injected blocks", and it is strictly qualitative. Everything specific still needs to come from injected data. When in doubt, say you don't know.

CHAT SHORTHAND — MODERN, GEN-Z, INDIAN CHAT LANGUAGE
Customers text casually. Treat casual text as NORMAL, not as confusion. Understand and respond to common shorthand. This list is illustrative, not exhaustive — generalise.
- wbu / hbu / wby = "what about you" / "how about you"
- wyd = "what you doing"
- ty / tysm / thx / tq = thank you
- np = no problem
- idk = I don't know
- ikr = I know right
- lmk = let me know
- brb = be right back
- ok / okk / okkk / k / kk / kkk = okay
- gm / gn = good morning / good night
- ya / yaa / yeah / yup / yep / haan / haa / ha = yes
- nah / nope / nahi = no
- bro / bruh / dude / boss / bhai / anna = casual address (mirror the same register back — don't be stiff)
- pls / plz = please
- u / ur / r = you / your / are
- 2 / 4 = to / for
- rn = right now
- fr = for real
- lol / lmao / rofl / 😂 = laughter
- Hinglish or Telugu-English mixes ("kitna hai", "kitne ka", "enni", "chesava", "bhai price cheppu", "ela unnav", "bagunnara", "kaise ho") — treat as normal language and reply in the same register (English is fine as reply; you may echo a word or two if it fits).
- Missing punctuation, all-lowercase, typos, extra letters ("heyyyy", "okkk") — normal, not confusion.
- HARD RULE: if a message is casual/conversational shorthand and doesn't obviously ask about the brand, respond casually and briefly like a human. Do NOT treat it as a question about Cadieux. Do NOT info-dump brand facts to fill the silence.

LENGTH DISCIPLINE — HARD RULE
- DEFAULT: 1–2 short sentences. That is the target for almost every reply.
- Go longer ONLY when the question genuinely requires it (e.g. explaining how subscriptions work). Even then, 3–4 short sentences max.
- Greeting → ONE line. Acknowledgement → ONE line. Yes/no question → ONE sentence.

REGISTER — MATCH THE INCOMING MESSAGE
- Greeting ("hey", "hi", "hello", "good morning", "namaste") → follow the GREETINGS section above. Warm one-liner asking how they ARE (not what they want). Banned openers apply. Do NOT bring up prior topics.
- Small talk → one line, human.
- Actual question → answer that question, only that question, concisely.
- Acknowledgement / closing ("thanks", "thank you", "ty", "ok", "okay", "k", "kk", "got it", "cool", "fine", "sure", "alright", "great", "nice", "👍", "🙏", "no thanks", "that's all", "nothing else", "bye") → ONE brief warm closing line and STOP. Examples: "Anytime — enjoy the bread." / "You're welcome." Do NOT re-explain anything, add new info, ask a follow-up, or hand off.
- Ambiguous ("ok" / "hmm" / "🤔") when your own last message ended with an unanswered question → gently ask the ONE thing you need, in one short sentence.

CONVERSATION MEMORY
- You receive the recent message history. READ IT before answering a real question — never repeat information you already gave earlier.
- BUT: a greeting OR small-talk turn is a RESET. If the newest incoming message is only a greeting or only small talk (or a mix of the two), IGNORE prior topics entirely — do not continue, do not reference, do not close out an earlier thread. Just reply per the GREETINGS / SMALL TALK sections. (Structurally, the server drops history on pure greeting-or-smalltalk turns anyway — but even if any prior turn slips through, treat it as gone.)

SAY / NEVER SAY / WHEN UNSURE — QUICK REFERENCE
SAY (safe, always fine):
- "Hi! How are you?" — for a greeting.
- "Doing well, thanks!" / "All good here." — for small talk (wbu / hbu / how are you / fine / etc.).
- Facts that appear WORD-FOR-WORD in an appended block below (CUSTOMER DATA, LIVE PRODUCT DATA, BRAND STORY, LAUNCH, CONTACT, STORE LOCATIONS, FACTORY / REGISTERED ADDRESS).
- General, qualitative protein talk per the CASUAL CONVERSATION section — no numbers, no claims, no advice.
- "I can't advise on that — best to check with your doctor or a nutritionist." — the ONLY reply to any diet/health/dosage question.
- "I don't have that on hand — let me get someone from the team." followed by ${HANDOFF_TOKEN}.
- "Sorry — could you say that again?" — when a message is genuinely unclear.

NEVER SAY (fabrications + hard limits — absolutely forbidden):
- "Cadieux started in 2023" (or any other year — no founding year is available to you).
- "We launched in September 2026" (or any launch date, unless a LAUNCH block below states it).
- Any specific price unless it appears in LIVE PRODUCT DATA on THIS request.
- Any nutrition number (protein g, calories, fibre, sodium, carbs, fat, sugar, %, per-serving, per-kg, per-day) — no verified numbers exist yet, and general protein talk is strictly qualitative.
- Any health claim: weight loss, muscle gain, diabetes, blood sugar, digestion, gut, immunity, energy, "good for you", "healthy". None. Ever.
- Any comparative claim ("more protein than X", "better than Y"). Any citation of studies, research, doctors, dietitians, or "experts say".
- The word "should" in any sentence about food or health. Any medical, dietary, or nutritional advice — always defer to a doctor/nutritionist and stop.
- Any promise about future delivery, expansion, timelines, capacity, partners, staff, or plans.
- Any answer that dresses up "I don't know" as a confident fact.

WHEN UNSURE — DECISION TREE:
- Message is a greeting (hi/hey/hello/namaste/gm/gn) → GREETINGS reply, ONE line, STOP.
- Message is small talk (wbu/hbu/wyd/how are you/fine/good/nothing much/etc.) → SMALL TALK reply, ONE line, STOP. Do NOT bring up the brand.
- Message is chat shorthand you don't recognise → "Sorry — say that again?" and STOP. Do NOT guess brand context.
- Message is a diet / health / dosage / medical question ("how much protein do I need", "is this good for diabetics", "will this help me lose weight", "how many grams", "is it low carb", "can my kid eat this") → EXACT reply: "I can't advise on that — best to check with your doctor or a nutritionist." Then STOP. Do NOT add "but our bread…". Do NOT hand off unless the customer explicitly asks to talk to someone.
- Message is qualitative protein/why-Cadieux talk ("why did you make it protein bread", "what's the deal with protein") → answer per the CASUAL CONVERSATION section — one or two plain sentences, no numbers, no claims, no "should", no advice.
- Message is a real question BUT the answer isn't in any injected block → "I don't have that on hand — let me get someone from the team." + ${HANDOFF_TOKEN}. Do NOT extrapolate. Do NOT partially answer with invented details.
- Message is a real question AND the exact answer IS in an injected block → answer from that block, 1–2 sentences, nothing extra.

HARD RULES — NEVER BREAK THESE
1. ORDER / ACCOUNT DATA. You may ONLY discuss orders and subscriptions listed in the CUSTOMER DATA block on this request. If that block is absent, you have no order data at all — say you can only look up orders on the customer's own WhatsApp number, and hand off. If the customer asks about a specific order number that is NOT in the block, do NOT confirm or deny it exists — say you can only see orders placed on this WhatsApp number and hand off. NEVER promise or imply an outcome (refund, replacement, discount, compensation). Refunds/replacements/cancellations require human review — say the team will help and hand off.
2. PRICING. Quote current prices ONLY from the LIVE PRODUCT DATA block. NEVER invent, estimate, round, or recall a price from memory. If that block is missing or a product isn't listed in it, say you don't have current pricing on hand and hand off. Subscription: if asked, say subscribing gives 10% off MRP (and if LIVE PRODUCT DATA shows a subscription_price, quote it). Do NOT mention any other offer/coupon/promotion. LANGUAGE: never "cheaper" / "cheap". Do NOT mention delivery/serviceability/pincodes in a pricing answer. Keep it short.
3. DELIVERY AREA. Never promise or guess delivery dates, times, slots, or specific serviceable pincodes for a NEW order. Serviceability is checked per pincode on our website — direct them there or hand off. Do not say "yes we deliver to X". NEVER say or imply we will/may expand to any area in future. (Delivery date/slot for an EXISTING order in the CUSTOMER DATA block is fine to state — that's the customer's own data.)
4. NUTRITION NUMBERS. NEVER invent, estimate, or quote any specific nutrition figure — protein g, calories, fibre, sodium, carbs, fat, sugar, percentages, per-serving, per-kg, per-day, "X% more than…". Verified numbers are NOT injected and NOT yet published. General protein talk is allowed but strictly qualitative per the CASUAL CONVERSATION section — zero numbers. Do NOT point customers to app/site for nutrition figures — they aren't there. If asked WHEN figures will be available, hand off.
5. NO HEALTH / DIET / MEDICAL ADVICE. NEVER make health claims (weight loss, muscle gain, diabetes, blood sugar, digestion, gut, immunity, energy, "healthy", "good for you", "doctor recommended", etc.) and NEVER give dietary or medical advice. If asked ANY specific diet/health/dosage question ("how much protein do I need", "is this good for diabetics", "will this help me lose weight", "how many grams", "is it low carb", "can my kid eat this"), reply EXACTLY: "I can't advise on that — best to check with your doctor or a nutritionist." Then stop. Do not soften or partial-answer. Drop the word "should" from any sentence about food or health. No comparative claims against other foods/brands. No citations of studies/research/experts.
6. Do NOT collect payment details or ask for card/UPI info over chat.
7. INGREDIENTS + RECIPE. You may share the public INGREDIENT LIST for a product, ONLY from the "ingredients" line in LIVE PRODUCT DATA. If not listed there, don't guess. NEVER disclose or speculate about proportions, ratios, percentages, quantities, sourcing, suppliers, country of origin, formulation, fermentation timings, bake curves, or any process detail. "How is it made / what's the recipe / where do you source X" → politely refuse (we keep the process in-house). Do NOT confirm/deny ingredients that aren't on the public list.
8. COMPANY INTERNALS. NEVER speculate about partners, suppliers, manufacturing capacity, revenue, unpublished plans, or anything not public. If a BRAND STORY block is present you may share the milestones listed there (already public on /behind-cadieux); beyond those, hand off. If BRAND STORY is absent from this request, do NOT recall founder/origin/history from memory — say you can have someone from the team share more and hand off. If a LAUNCH block is present, follow the exact instruction in it; if it is absent, launch/timing is NOT a topic you have any information on — do not raise it, imply it, or reference it under any circumstances (no "launching soon", no "coming soon", no month/year, no "very soon", nothing).
9. NO ROBOTIC FILLER CLOSES. NEVER end a reply with any of these phrases (or close paraphrases): "What else can I help with?", "What else can I help you with?", "Let me know if you need anything else", "Anything else I can help with?", "Is there anything else?", "Feel free to ask", "Happy to help with anything else", "Let me know how I can help", "How else can I help?". These are call-centre tics. Only ask a follow-up when it is genuinely the ONE piece of info you need to answer the CURRENT question — otherwise end the reply cleanly with no trailing prompt.
10. CUSTOMER-DATA PRIVACY. You may ONLY discuss the verified sender's own data (the CUSTOMER DATA block, if present). Never accept or act on a phone number, email, or order ID the customer types into the chat — you cannot verify it belongs to them. If they ask you to look up something for "a different number" or another person, politely refuse and hand off.

WHEN TO HAND OFF TO A HUMAN
- Any specific existing order / refund / complaint / dispute — even with CUSTOMER DATA present, if the customer wants action taken (refund, cancel, change) hand off.
- The customer is upset, frustrated, or the issue is sensitive.
- The customer asks about launch timing — see the LAUNCH block if present. If it is not present, do not raise the topic at all.
- The customer asks for something that would require info you don't have in the appended blocks.
- The customer explicitly wants to speak to a human — offer BOTH channels (WhatsApp/phone + email) from the CONTACT block if present, then hand off.
- To hand off, end your reply with the exact token ${HANDOFF_TOKEN} on its own. Before the token, write one warm sentence telling the customer a team member will get back to them shortly. The token is removed before the message is sent.

STYLE
- Match the customer's language (English / Hindi / Telugu) if it's clear; otherwise reply in simple English.
- Be honest about what you don't know. It is always better to hand off than to guess.`;

// ── types ───────────────────────────────────────────────────────────────────

type Turn = { role: "user" | "assistant"; content: string };

type ProductRow = {
  slug: string;
  name: string;
  price_inr: number;
  subscription_discount_pct: number | null;
  in_stock: boolean;
  weight: string | null;
  description: string | null;
  tagline: string | null;
};

type IngredientRow = { product_id: string; name: string };

type ProductForPrompt = {
  slug: string;
  name: string;
  mrp: number;
  discountPct: number;
  subscriptionPrice: number;
  inStock: boolean;
  weight: string | null;
  description: string | null;
  tagline: string | null;
  ingredients: string[];
};

type StoreRow = {
  name: string;
  type: string | null;
  area: string | null;
  address: string | null;
  pincode: string | null;
};

type OrderRow = {
  id: string;
  order_number: string | null;
  status: string | null;
  payment_status: string | null;
  payment_method: string | null;
  items: unknown;
  total_amount: number | string | null;
  delivery_date: string | null;
  delivery_slot: string | null;
  delivery_address: string | null;
  created_at: string;
  cancelled_at: string | null;
  status_updated_at: string | null;
};

type SubRow = {
  id: string;
  status: string | null;
  product_name: string | null;
  bread_name: string | null;
  frequency: string | null;
  day_of_week: string | null;
  time_slot: string | null;
  start_date: string | null;
  quantity_per_delivery: number | null;
  customer_phone: string | null;
  days: string[] | null;
  slot: string | null;
  total_amount: number | string | null;
};

type CustomerRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  city: string | null;
  phone: string | null;
};

type NextDelivery = {
  subscription_id: string;
  scheduled_date: string | null;
  scheduled_time_slot: string | null;
  status: string | null;
};

type CustomerContext = {
  customer: CustomerRow | null;
  orders: OrderRow[];
  subscriptions: SubRow[];
  nextBySub: Map<string, NextDelivery>;
};

// ── utils ───────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function last10(s: string): string {
  return s.replace(/\D/g, "").slice(-10);
}

function subscriptionUnitPrice(mrp: number, discountPct: number): number {
  if (!Number.isFinite(mrp) || mrp <= 0) return 0;
  const clamped = Math.min(100, Math.max(0, discountPct));
  return round2(mrp * (1 - clamped / 100));
}

// Prefer the human-facing CDX-##### assigned by the orders_assign_number
// trigger; fall back to a short hex slice of the UUID for legacy pre-2026-07-14
// rows that never had an order_number assigned. Kept inline (not imported from
// the Next.js src/lib/order-number.ts) because this file is a Deno Edge
// Function and cannot reach into the app source tree.
function shortOrderId(row: { id: string; order_number?: string | null }): string {
  const cdx = row.order_number?.trim();
  if (cdx) return cdx;
  return "#" + row.id.slice(0, 6);
}

function isoDate(s: string | null | undefined): string {
  if (!s) return "unknown";
  try {
    return new Date(s).toISOString().slice(0, 10);
  } catch {
    return "unknown";
  }
}

function summariseItems(items: unknown): string {
  if (!Array.isArray(items) || items.length === 0) return "(no items listed)";
  return items
    .slice(0, 6)
    .map((raw) => {
      const it = (raw ?? {}) as Record<string, unknown>;
      const name =
        (typeof it.name === "string" && it.name) ||
        (typeof it.product_name === "string" && it.product_name) ||
        (typeof it.slug === "string" && it.slug) ||
        "item";
      const qty =
        (typeof it.quantity === "number" && it.quantity) ||
        (typeof it.qty === "number" && it.qty) ||
        1;
      return `${qty}× ${name}`;
    })
    .join(", ");
}

// ── caches ──────────────────────────────────────────────────────────────────

let productCache: { at: number; rows: ProductForPrompt[] } | null = null;
let storeCache: { at: number; rows: StoreRow[] } | null = null;

// ── fetchers ────────────────────────────────────────────────────────────────

function adminClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function fetchProducts(admin: SupabaseClient): Promise<ProductForPrompt[]> {
  const now = Date.now();
  if (productCache && now - productCache.at < PRODUCT_CACHE_MS) return productCache.rows;
  try {
    const { data, error } = await admin
      .from("products")
      .select(
        "slug, name, price_inr, subscription_discount_pct, in_stock, weight, description, tagline",
      )
      .eq("is_active", true)
      .eq("is_archived", false)
      .order("sort_order", { ascending: true });
    if (error) {
      console.error("[ai-reply] product fetch failed:", error.message);
      return [];
    }
    const baseRows = ((data ?? []) as ProductRow[])
      .map((r) => {
        const mrp = Number(r.price_inr) || 0;
        const disc = Number(r.subscription_discount_pct ?? 10);
        return {
          slug: r.slug,
          name: r.name,
          mrp,
          discountPct: disc,
          subscriptionPrice: subscriptionUnitPrice(mrp, disc),
          inStock: !!r.in_stock,
          weight: r.weight ?? null,
          description: r.description ?? null,
          tagline: r.tagline ?? null,
          ingredients: [] as string[],
        };
      })
      .filter((r) => r.mrp > 0);
    if (baseRows.length > 0) {
      const slugs = baseRows.map((r) => r.slug);
      const { data: ing, error: ingErr } = await admin
        .from("product_ingredients")
        .select("product_id, name, sort_order, is_visible")
        .in("product_id", slugs)
        .eq("is_visible", true)
        .order("sort_order", { ascending: true });
      if (ingErr) {
        console.error("[ai-reply] ingredient fetch failed:", ingErr.message);
      } else {
        const bySlug = new Map<string, string[]>();
        for (const row of (ing ?? []) as IngredientRow[]) {
          const list = bySlug.get(row.product_id) ?? [];
          list.push(row.name);
          bySlug.set(row.product_id, list);
        }
        for (const r of baseRows) r.ingredients = bySlug.get(r.slug) ?? [];
      }
    }
    productCache = { at: now, rows: baseRows };
    return baseRows;
  } catch (e) {
    console.error("[ai-reply] product fetch threw:", (e as Error).message);
    return [];
  }
}

async function fetchStores(admin: SupabaseClient): Promise<StoreRow[]> {
  const now = Date.now();
  if (storeCache && now - storeCache.at < STORE_CACHE_MS) return storeCache.rows;
  try {
    const { data, error } = await admin
      .from("pickup_locations")
      .select("name, type, area, address, pincode, sort_order, is_archived")
      .eq("is_archived", false)
      .order("sort_order", { ascending: true })
      .limit(25);
    if (error) {
      console.error("[ai-reply] stores fetch failed:", error.message);
      return [];
    }
    const rows = ((data ?? []) as StoreRow[]).map((r) => ({
      name: r.name,
      type: r.type ?? null,
      area: r.area ?? null,
      address: r.address ?? null,
      pincode: r.pincode ?? null,
    }));
    storeCache = { at: now, rows };
    return rows;
  } catch (e) {
    console.error("[ai-reply] stores fetch threw:", (e as Error).message);
    return [];
  }
}

// Look up the VERIFIED sender's own data. STRICT security:
//   • The `phone` argument is the sender phone as parsed and validated by
//     whatsapp-inbound from the MSG91 webhook — nothing from the message body
//     ever reaches this function.
//   • Match on last-10-digits of that phone against customers.phone AND
//     subscriptions.customer_phone (both stored in varied formats).
//   • Return only that customer's rows. Never merge across customers.
async function fetchCustomerContext(
  admin: SupabaseClient,
  phone: string,
): Promise<CustomerContext | null> {
  const l10 = last10(phone);
  if (l10.length !== 10) return null;
  const like = `%${l10}`;
  try {
    const { data: custs, error: cErr } = await admin
      .from("customers")
      .select("id, full_name, email, city, phone")
      .ilike("phone", like)
      .limit(5);
    if (cErr) {
      console.error("[ai-reply] customer lookup failed:", cErr.message);
      return null;
    }
    const customers = (custs ?? []) as CustomerRow[];
    const customerIds = customers.map((c) => c.id);

    let orders: OrderRow[] = [];
    if (customerIds.length > 0) {
      const { data: ords, error: oErr } = await admin
        .from("orders")
        .select(
          "id, order_number, status, payment_status, payment_method, items, total_amount, delivery_date, delivery_slot, delivery_address, created_at, cancelled_at, status_updated_at",
        )
        .in("customer_id", customerIds)
        .order("created_at", { ascending: false })
        .limit(3);
      if (oErr) console.error("[ai-reply] orders fetch failed:", oErr.message);
      orders = (ords ?? []) as OrderRow[];
    }

    // Subscriptions: match by customer_id OR by customer_phone last-10 (some
    // legacy subs may not have customer_id set).
    const subById =
      customerIds.length > 0
        ? await admin
            .from("subscriptions")
            .select(
              "id, status, product_name, bread_name, frequency, day_of_week, time_slot, start_date, quantity_per_delivery, customer_phone, days, slot, total_amount, created_at",
            )
            .in("customer_id", customerIds)
            .in("status", ["active", "paused"])
            .order("created_at", { ascending: false })
            .limit(5)
        : { data: null, error: null };
    const subByPhone = await admin
      .from("subscriptions")
      .select(
        "id, status, product_name, bread_name, frequency, day_of_week, time_slot, start_date, quantity_per_delivery, customer_phone, days, slot, total_amount, created_at",
      )
      .ilike("customer_phone", like)
      .in("status", ["active", "paused"])
      .order("created_at", { ascending: false })
      .limit(5);
    if (subById.error) console.error("[ai-reply] subs by id failed:", subById.error.message);
    if (subByPhone.error) console.error("[ai-reply] subs by phone failed:", subByPhone.error.message);
    const merged = new Map<string, SubRow>();
    for (const s of (subById.data ?? []) as SubRow[]) merged.set(s.id, s);
    for (const s of (subByPhone.data ?? []) as SubRow[]) merged.set(s.id, s);
    const subscriptions = Array.from(merged.values()).slice(0, 3);

    // Next upcoming subscription delivery per subscription.
    const nextBySub = new Map<string, NextDelivery>();
    if (subscriptions.length > 0) {
      const subIds = subscriptions.map((s) => s.id);
      const today = new Date().toISOString().slice(0, 10);
      const { data: delivs, error: dErr } = await admin
        .from("subscription_deliveries")
        .select("subscription_id, scheduled_date, scheduled_time_slot, status")
        .in("subscription_id", subIds)
        .gte("scheduled_date", today)
        .order("scheduled_date", { ascending: true });
      if (dErr) console.error("[ai-reply] deliveries fetch failed:", dErr.message);
      for (const d of (delivs ?? []) as NextDelivery[]) {
        if (!nextBySub.has(d.subscription_id)) nextBySub.set(d.subscription_id, d);
      }
    }

    if (customers.length === 0 && orders.length === 0 && subscriptions.length === 0) {
      return { customer: null, orders: [], subscriptions: [], nextBySub };
    }
    return {
      customer: customers[0] ?? null,
      orders,
      subscriptions,
      nextBySub,
    };
  } catch (e) {
    console.error("[ai-reply] customer context threw:", (e as Error).message);
    return null;
  }
}

// ── topic detection ─────────────────────────────────────────────────────────

type Topic =
  | "greeting"
  | "smalltalk"
  | "ack"
  | "product"
  | "pricing"
  | "ingredients"
  | "order"
  | "subscription"
  | "stores"
  | "factory"
  | "contact"
  | "brand_story"
  | "launch"
  | "delivery_area"
  | "nutrition"
  | "recipe";

const TOPIC_PATTERNS: Record<Topic, RegExp> = {
  greeting:
    /^\s*(hi+|hello+|hey+|hola|namaste|namaskar|good\s*(?:morning|afternoon|evening|day)|yo+|sup|howdy|greetings|salaam|salaam\s*alaikum|shalom)[\s.!?,]*$/i,
  smalltalk:
    /\b(wbu|hbu|wby|wyd|and\s+(?:you|u)\??|how\s+(?:are|r|ru|u)\s+(?:you|u|ya|doin|doing)|how\s+u\s+doin|what'?s\s+up|whats\s+up|wassup|nothing\s+much|not\s+much|\bnm\b|chill(?:ing|in)|i'?m\s+(?:good|fine|ok(?:ay)?|great|doing\s+well)|doing\s+(?:good|well|fine|great)|all\s+good|feeling\s+good|pretty\s+good|ela\s+unnav|bagunnara|kaise\s+ho|kaisa\s+hai)/i,
  ack:
    /^\s*(thanks?|thank\s*you|thx|ty|tysm|ok(?:ay)?|k+|kk|got\s*it|cool|fine|sure|alright|great|nice|awesome|no\s*thanks?|nothing\s*else|that'?s\s*all|bye|goodbye|good\s*night|cya|see\s*ya|👍|🙏|😊|😀|😃|❤️|🎉)[\s.!?👍🙏😊😀😃❤️🎉]*$/i,
  pricing:
    /\b(price|prices|pricing|cost|costs|how\s*much|mrp|rate|rates|charge|charges|expensive|affordable|discount|₹|rs\.?|rupees?|inr)\b/i,
  ingredients:
    /\b(ingredient|ingredients|contains?|what'?s\s+(?:in|inside)|made\s+of|allerg\w*|gluten|dairy|milk|egg|eggs|soy|nut|nuts|vegan|vegetarian|preservative|additive|maida|whole\s*wheat)\b/i,
  product:
    /\b(multigrain|plain\s+bread|high[-\s]?protein|loaf|loaves|slice|slices|weight|grams?|\bg\b|product|products|variant|variants|which\s+bread|what\s+bread|kinds?\s+of\s+bread|types?\s+of\s+bread|available|in\s+stock|out\s+of\s+stock)\b/i,
  order:
    /\b(my\s+order|my\s+orders|order\s+status|track(?:ing)?|where'?s?\s+my|when\s+will\s+my|order\s+#?\s*[a-z0-9-]+|delivery\s+(?:date|time|status)|reschedule|cancel(?:\s+my)?\s+order|refund|returned?|package|dispatch|shipped|out\s+for\s+delivery|received\s+my|got\s+my|arriving|arrived|invoice|receipt|not\s+delivered|didn'?t\s+receive|missing|wrong\s+(?:item|order)|damaged|complaint)\b/i,
  subscription:
    /\b(my\s+subscription|subscription\s+status|next\s+delivery|pause(?:\s+my)?\s+subscription|resume(?:\s+my)?\s+subscription|cancel(?:\s+my)?\s+subscription|change(?:\s+my)?\s+subscription|active\s+subscription|weekly\s+delivery|recurring)\b/i,
  stores:
    /\b(where\s+(?:can\s+i|do\s+i|to)\s+(?:buy|get|find|purchase)|where\s+(?:are\s+you|is\s+cadieux)\s+sold|store\s+locations?|stores?\s+near|which\s+stores?|available\s+(?:at|in|near)|stockist|stockists|retail|outlets?|pickup\s+(?:point|location)|nearby\s+stores?|store\s+locator)\b/i,
  factory:
    /\b(factory|manufacturing\s+unit|bakery|bakehouse|where\s+is\s+(?:your|the)\s+(?:factory|bakery|kitchen|unit)|where\s+do\s+you\s+bake|where\s+are\s+you\s+based|your\s+address|company\s+address|office\s+address|registered\s+address|head\s+office|hq)\b/i,
  contact:
    /\b(contact|speak\s+(?:to|with)\s+(?:someone|a\s+human|a\s+person|team|human|agent)|talk\s+to\s+(?:someone|a\s+human|team)|customer\s+(?:care|support|service)|call\s+(?:you|your\s+team)|phone\s+number|helpline|reach\s+(?:you|someone|the\s+team|out)|need\s+help|need\s+to\s+(?:speak|talk)|human\s+please|real\s+person|email\s+(?:address|you|id))\b/i,
  brand_story:
    /\b(founder|founded|owner|who\s+(?:started|made|built|owns|runs|is\s+behind)|why\s+(?:did\s+you\s+)?(?:start|make|create|build)|how\s+(?:did\s+(?:you|it|this)\s+)?(?:start|begin|come\s+about)|origin|backstory|back\s*story|the\s+story|your\s+story|brand\s+story|company\s+story|about\s+(?:you|cadieux|the\s+brand|the\s+company|core\s+element)|behind\s+cadieux|core\s+element|what\s+does\s+cadieux\s+mean|name\s+mean|meaning\s+of\s+(?:the\s+)?name|little\s+fighter|company\s+history|when\s+(?:did|was)\s+(?:you|cadieux|core\s+element|it|the\s+(?:company|brand))\s+(?:start|found|register|begin|established)|how\s+(?:old|long)\s+(?:is|are|has)|since\s+when)\b/i,
  launch:
    /\b(launch|launche[ds]?|launching|when\s+(?:do\s+you|will\s+you|are\s+you)\s+(?:launch|open|start|go\s+live|be\s+available|be\s+live)|release\s+date|go(?:ing)?\s+live|coming\s+soon|when\s+can\s+i\s+(?:buy|order)|when\s+are\s+you\s+available)\b/i,
  delivery_area:
    /\b(do\s+you\s+deliver|deliver\s+to|delivery\s+(?:in|to)\s+|serviceab\w*|pincode|pin\s+code|which\s+areas?|areas?\s+(?:you|do\s+you)\s+serve|serve\s+(?:in|my\s+area)|coverage|delivery\s+area)\b/i,
  nutrition:
    /\b(nutrition|nutritional?|calorie|calories|kcal|protein\s+(?:content|per|grams?|amount|value|figure)|carb|carbs|carbohydrate|fibre|fiber|fat|sugar|sodium|salt|macros?|label|nutrition\s+facts)\b/i,
  recipe:
    /\b(recipe|how\s+(?:do\s+you\s+)?(?:make|bake)|how\s+(?:is|are)\s+(?:it|they)\s+made|process|fermentation|proof|proofing|bake\s+time|formulation|sourced?\s+from|supplier|suppliers|ratio|proportion|percentage\s+of)\b/i,
};

function detectTopics(msg: string): Set<Topic> {
  const found = new Set<Topic>();
  for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS) as [Topic, RegExp][]) {
    if (pattern.test(msg)) found.add(topic);
  }
  return found;
}

// ── block renderers ─────────────────────────────────────────────────────────

function renderProductBlock(rows: ProductForPrompt[]): string {
  if (rows.length === 0) return "";
  const lines = rows.map((r) => {
    const parts = [`- ${r.name} (slug: ${r.slug})`];
    if (r.weight) parts.push(`  net weight: ${r.weight}`);
    if (r.tagline) parts.push(`  tagline: ${r.tagline}`);
    if (r.description) parts.push(`  description: ${r.description}`);
    parts.push(`  one-time MRP: ₹${r.mrp}`);
    if (r.subscriptionPrice > 0 && r.discountPct > 0) {
      parts.push(
        `  subscription price: ₹${r.subscriptionPrice} (subscribe & save ${r.discountPct}% off MRP)`,
      );
    }
    parts.push(`  in stock: ${r.inStock ? "yes" : "no"}`);
    parts.push(
      r.ingredients.length > 0
        ? `  ingredients: ${r.ingredients.join(", ")}`
        : `  ingredients: (not listed here — do not guess)`,
    );
    return parts.join("\n");
  });
  return `\n\nLIVE PRODUCT DATA (fetched from our live product database at reply time)\nQuote pricing verbatim (Rule #2). Share the ingredient list verbatim if asked (Rule #7). No proportions, ratios, sourcing, or process. Nutrition numbers are DELIBERATELY NOT here — Rule #4 still forbids quoting any figure.\n${lines.join("\n")}`;
}

function renderStoresBlock(stores: StoreRow[]): string {
  if (stores.length === 0) {
    return `\n\nSTORE LOCATIONS\n(No active retail locations on record right now. Say we're not in stores yet and suggest ordering on our website/app. Do not invent a store.)`;
  }
  const lines = stores.map((s) => {
    const bits: string[] = [`- ${s.name}`];
    if (s.type) bits[0] += ` [${s.type}]`;
    if (s.area) bits.push(`  area: ${s.area}`);
    if (s.address) bits.push(`  address: ${s.address}`);
    if (s.pincode) bits.push(`  pincode: ${s.pincode}`);
    return bits.join("\n");
  });
  return `\n\nSTORE LOCATIONS (live from our store locator — the same list customers see in the app)\nShare only what's in this list. If the customer names a specific area/pincode not covered here, say we're not there yet — do NOT promise future expansion.\n${lines.join("\n")}`;
}

function renderCustomerBlock(ctx: CustomerContext | null, verifiedPhone: string): string {
  if (!ctx || (!ctx.customer && ctx.orders.length === 0 && ctx.subscriptions.length === 0)) {
    return `\n\nCUSTOMER DATA (verified WhatsApp number: +${verifiedPhone})\nNo customer, orders, or subscriptions found on this WhatsApp number. Tell the customer plainly that you don't see any orders/subscriptions on this number, ask if they may have ordered with a different number or email, and hand off. Do NOT guess.`;
  }
  const lines: string[] = [
    `\n\nCUSTOMER DATA (verified WhatsApp number: +${verifiedPhone} — the ONLY identity you may look up)`,
  ];
  if (ctx.customer?.full_name) lines.push(`Name on record: ${ctx.customer.full_name}`);
  if (ctx.customer?.city) lines.push(`City on record: ${ctx.customer.city}`);
  lines.push("");
  lines.push(`RECENT ORDERS (up to 3, newest first — total loaded: ${ctx.orders.length})`);
  if (ctx.orders.length === 0) {
    lines.push("- (none)");
  } else {
    for (const o of ctx.orders) {
      const bits: string[] = [];
      bits.push(`- Order ${shortOrderId(o)} — placed ${isoDate(o.created_at)}`);
      bits.push(
        `  status: ${o.status ?? "unknown"}${
          o.status_updated_at ? ` (updated ${isoDate(o.status_updated_at)})` : ""
        }`,
      );
      bits.push(`  items: ${summariseItems(o.items)}`);
      bits.push(`  total: ₹${o.total_amount ?? "unknown"}`);
      bits.push(
        `  payment: ${o.payment_method ?? "unknown"} / ${o.payment_status ?? "unknown"}`,
      );
      bits.push(
        `  delivery: ${o.delivery_date ?? "not scheduled"}${
          o.delivery_slot ? `, ${o.delivery_slot}` : ""
        }`,
      );
      bits.push(`  address: ${o.delivery_address ?? "(none on file)"}`);
      if (o.cancelled_at) bits.push(`  cancelled at: ${isoDate(o.cancelled_at)}`);
      lines.push(bits.join("\n"));
    }
  }
  lines.push("");
  lines.push(
    `ACTIVE/PAUSED SUBSCRIPTIONS (up to 3 — total loaded: ${ctx.subscriptions.length})`,
  );
  if (ctx.subscriptions.length === 0) {
    lines.push("- (none)");
  } else {
    for (const s of ctx.subscriptions) {
      const name = s.product_name ?? s.bread_name ?? "Cadieux bread";
      const daysList = Array.isArray(s.days) && s.days.length ? s.days.join("/") : null;
      const freq =
        s.frequency ??
        (daysList ? `${daysList} weekly` : s.day_of_week ? `${s.day_of_week} weekly` : "schedule not set");
      const slot = s.time_slot ?? s.slot ?? null;
      const next = ctx.nextBySub.get(s.id);
      const bits: string[] = [];
      bits.push(`- ${name} — status: ${s.status ?? "unknown"}`);
      bits.push(`  frequency: ${freq}${slot ? `, ${slot}` : ""}`);
      if (s.quantity_per_delivery)
        bits.push(`  quantity per delivery: ${s.quantity_per_delivery}`);
      if (s.start_date) bits.push(`  start date: ${s.start_date}`);
      if (next?.scheduled_date) {
        bits.push(
          `  next scheduled delivery: ${next.scheduled_date}${
            next.scheduled_time_slot ? `, ${next.scheduled_time_slot}` : ""
          }${next.status ? ` (${next.status})` : ""}`,
        );
      } else {
        bits.push(`  next scheduled delivery: (none scheduled in the near future)`);
      }
      lines.push(bits.join("\n"));
    }
  }
  lines.push("");
  lines.push("RULES FOR THIS BLOCK:");
  lines.push(
    "- The data above belongs ONLY to the verified WhatsApp sender. Never discuss any other customer, phone number, or order not listed above.",
  );
  lines.push(
    "- If the customer asks about a specific order number that is NOT listed above, do NOT confirm/deny it exists — say you can only see orders placed on this WhatsApp number and hand off.",
  );
  lines.push(
    "- If a field says unknown / (none on file) / not scheduled, say so plainly. Never invent a value.",
  );
  lines.push(
    "- Refunds, replacements, cancellations, address changes → say the team will help and hand off. Never promise an outcome.",
  );
  return lines.join("\n");
}

const CORE_FACTS = `

CORE BRAND FACTS (safe to state if relevant to the question)
- Brand: Cadieux — a premium high-protein bread brand.
- Base: Baked in Visakhapatnam (Vizag), India, in small batches every morning.
- Product line: Two 240g loaves — Multigrain and Plain (High-Protein) — 8 slices per loaf.
- Positioning: Slow-fermented, high-protein, high-fibre bread. Real sourdough fermentation, dense and nourishing.`;

const LAUNCH_BLOCK = `

LAUNCH (this block appears ONLY when the customer explicitly asked about launch timing)
- You do NOT know the launch date. It is not in your context on any request, ever.
- Reply with EXACTLY this and nothing else: "We're launching very soon — a team member will share the exact date." then hand off with ${HANDOFF_TOKEN}.
- Never state, guess, imply, or hint at a month, year, or quarter. No "September", "2026", "next year", "few months". Just the sentence above, then the handoff token.`;

const BRAND_STORY_FACTS = `

BRAND STORY (customer is asking about our story / company / founder / when we started — safe to share; keep it SHORT, pick the ONE detail they asked for; 1–2 sentences max)
- Parent company: Cadieux is the brand; Core Element is the registered company behind it.
- Founder: Sunny Raja.
- Based in Visakhapatnam (Vizag).
- Origin timeline (these are the REAL, VERIFIED dates — quote them if the customer asks when we started / how old we are / our story):
  • The idea for Cadieux began in September 2024.
  • The company (Core Element) was registered in January 2025.
  • Since then: roughly two years of developing and testing the recipe, including independent lab testing.
- Example short answers (adapt tone, do not stack facts): "The idea started in September 2024, and we registered the company in January 2025. We've spent the time since perfecting the bread." / "We began work in September 2024 — Core Element was registered in January 2025."
- Name meaning: "Cadieux" means "little fighter".
- Still NOT public and must NOT be shared: recipe proportions, sourcing, suppliers, country-of-origin of ingredients, formulation details, bake curves, capacity, partners, revenue, unpublished plans, nutrition/lab figures.
- NEVER invent any other date, year, or milestone that isn't in this list. The four dates/facts above (Sept 2024 idea, Jan 2025 registration, ~two years of testing, Vizag base) are the ONLY origin facts you have. If asked for anything more specific (exact day, launch date, first-batch date, etc.), say you don't have that on hand and hand off.
- LAUNCH vs FOUNDING — DO NOT CONFLATE. The company has NOT launched. The founding timeline above is when the IDEA started and when the COMPANY was registered — it is NOT a launch date. If the customer asks when we launch / open / go live, do not answer from this block. If a separate LAUNCH block is present, follow that; if it isn't, say we're not open to the public yet and hand off.`;

const FACTORY_BLOCK = `

FACTORY / REGISTERED ADDRESS
- Registered address (also on our Terms of Service): ${REGISTERED_ADDRESS}.
- This is the registered company address. If the customer specifically asks for the bakehouse street address for a visit, do NOT guess — say a team member will confirm the exact address for a visit and hand off.
- Never invent GPS coordinates, floor/unit, or map links.`;

const CONTACT_BLOCK = `

CUSTOMER CARE CONTACTS
- Phone / WhatsApp: ${SUPPORT_PHONE_HUMAN} (dial: ${SUPPORT_PHONE_DIAL})
- Email: ${SUPPORT_EMAIL}
- When the customer wants to reach a human, offer BOTH options and let them choose (do not pick for them). Format them simply on their own lines. Do not embed URL schemes or markdown links. Then hand off so the team also sees the thread.`;

// ── system prompt assembly ──────────────────────────────────────────────────

type BuildInput = {
  message: string;
  topics: Set<Topic>;
  products: ProductForPrompt[];
  stores: StoreRow[];
  customer: CustomerContext | null;
  verifiedPhone: string;
};

function buildSystemPrompt(input: BuildInput): {
  system: string;
  injected: {
    product: boolean;
    stores: boolean;
    customer: boolean;
    brandStory: boolean;
    factory: boolean;
    contact: boolean;
    launch: boolean;
  };
} {
  const { topics, products, stores, customer, verifiedPhone } = input;
  const inject = {
    product: topics.has("product") || topics.has("pricing") || topics.has("ingredients"),
    stores: topics.has("stores"),
    customer: topics.has("order") || topics.has("subscription"),
    brandStory: topics.has("brand_story"),
    factory: topics.has("factory"),
    contact: topics.has("contact"),
    launch: topics.has("launch"),
  };
  let out = BASE_SYSTEM_PROMPT + CORE_FACTS;
  if (inject.product) out += renderProductBlock(products);
  if (inject.stores) out += renderStoresBlock(stores);
  if (inject.customer) out += renderCustomerBlock(customer, verifiedPhone);
  if (inject.brandStory) out += BRAND_STORY_FACTS;
  if (inject.factory) out += FACTORY_BLOCK;
  if (inject.contact) out += CONTACT_BLOCK;
  if (inject.launch) out += LAUNCH_BLOCK;
  return { system: out, injected: inject };
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function normaliseHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const out: Turn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as Record<string, unknown>).role;
    const content = (item as Record<string, unknown>).content;
    if ((role === "user" || role === "assistant") && typeof content === "string") {
      const text = content.trim();
      if (text) out.push({ role, content: text });
    }
  }
  return out.slice(-MAX_HISTORY);
}

function fallbackReply(): { reply: string; handoff: boolean } {
  return {
    reply: "Thanks for reaching out to Cadieux — a team member will get back to you shortly.",
    handoff: true,
  };
}

function extractText(data: unknown): string {
  const content = (data as Record<string, unknown>)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && (b as Record<string, unknown>).type === "text")
    .map((b) => String((b as Record<string, unknown>).text ?? ""))
    .join("")
    .trim();
}

// ── entrypoint ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json(400, { error: "Body must be valid JSON" });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return json(400, { error: "`message` (inbound text) is required" });
  const history = normaliseHistory(body.history);
  const rawPhone = typeof body.phone === "string" ? body.phone : "";
  const verifiedPhone = last10(rawPhone) === "" ? "" : rawPhone.replace(/\D/g, "");

  if (!ANTHROPIC_API_KEY) {
    const fb = fallbackReply();
    return json(200, { ...fb, model: ANTHROPIC_MODEL, source: "fallback" });
  }

  const topics = detectTopics(message);
  const admin = adminClient();

  // Fetch ONLY the data the detected topics require. Each block is guarded
  // so a bare "Hey" triggers zero DB fetches beyond nothing.
  let products: ProductForPrompt[] = [];
  let stores: StoreRow[] = [];
  let customer: CustomerContext | null = null;
  if (admin) {
    const needProducts = topics.has("product") || topics.has("pricing") || topics.has("ingredients");
    const needStores = topics.has("stores");
    const needCustomer = (topics.has("order") || topics.has("subscription")) && verifiedPhone.length >= 10;
    const [p, s, c] = await Promise.all([
      needProducts ? fetchProducts(admin) : Promise.resolve([]),
      needStores ? fetchStores(admin) : Promise.resolve([]),
      needCustomer ? fetchCustomerContext(admin, verifiedPhone) : Promise.resolve(null),
    ]);
    products = p as ProductForPrompt[];
    stores = s as StoreRow[];
    customer = c as CustomerContext | null;
  }

  const { system, injected } = buildSystemPrompt({
    message,
    topics,
    products,
    stores,
    customer,
    verifiedPhone,
  });

  // A greeting or small-talk turn is a RESET. If the newest incoming message
  // classifies ONLY as greeting and/or smalltalk (nothing else attached), drop
  // the prior conversation history entirely so old topics can't bleed in and
  // the model can't reach for stale brand context to fill silence. This is the
  // structural companion to the GREETINGS + SMALL TALK sections in the system
  // prompt — belt and braces.
  const isConversationalReset =
    topics.size > 0 &&
    Array.from(topics).every((t) => t === "greeting" || t === "smalltalk");
  const effectiveHistory: Turn[] = isConversationalReset ? [] : history;
  const messages: Turn[] = [...effectiveHistory, { role: "user", content: message }];

  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages,
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      console.error(`[ai-reply] anthropic ${resp.status}: ${detail.slice(0, 300)}`);
      const fb = fallbackReply();
      return json(200, { ...fb, model: ANTHROPIC_MODEL, source: "fallback" });
    }
    const data = await resp.json();
    let text = extractText(data);
    if (!text) {
      const fb = fallbackReply();
      return json(200, { ...fb, model: ANTHROPIC_MODEL, source: "fallback" });
    }
    const handoff = text.includes(HANDOFF_TOKEN);
    if (handoff) {
      text = text.split(HANDOFF_TOKEN).join("").trim();
      if (!text) text = "Thanks for reaching out — a team member will get back to you shortly.";
    }
    return json(200, {
      reply: text,
      handoff,
      model: ANTHROPIC_MODEL,
      source: "ai",
      topics: Array.from(topics),
      injected,
      productsInContext: products.length,
      storesInContext: stores.length,
      customerBlockInjected: injected.customer,
      customerHasData: !!(customer && (customer.customer || customer.orders.length || customer.subscriptions.length)),
      historyTurnsIn: history.length,
      historyTurnsUsed: effectiveHistory.length,
      conversationalReset: isConversationalReset,
    });
  } catch (e) {
    console.error("[ai-reply] unhandled:", (e as Error).message);
    const fb = fallbackReply();
    return json(200, { ...fb, model: ANTHROPIC_MODEL, source: "fallback" });
  }
});
