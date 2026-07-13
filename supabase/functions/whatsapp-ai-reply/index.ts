// ---------------------------------------------------------------------------
// whatsapp-ai-reply — Supabase Edge Function
// ---------------------------------------------------------------------------
// Generates a Cadieux-brand WhatsApp reply for one inbound customer message,
// using Anthropic Claude. This is the AI BRAIN only — it does NOT send the
// WhatsApp message and does NOT touch MSG91/Twilio.
//
// LIVE PRODUCT DATA + PUBLIC FACTS:
//   Before calling Claude, this function fetches current active products
//   from Supabase (`public.products` + `public.product_ingredients`) — the
//   SAME rows the website's getActiveProducts() / getProductIngredients()
//   and /api/subscription-plans read. Injected fields per product:
//     - name, slug, weight, description, tagline
//     - one-time MRP + derived subscription price (shared formula)
//     - public ingredient list (names only — no proportions, no process)
//     - in-stock flag
//   A KNOWN PUBLIC FACTS block (founder story milestones, slices/loaf,
//   Vizag base, "Cadieux by Core Element") is also appended — these are
//   already public on /behind-cadieux and product pages.
//   Cached in-memory for 5 min per warm Edge instance. If the fetch fails
//   the block is omitted and the model falls back to the base guardrails.
//   NUTRITION NUMBERS ARE NEVER INJECTED and Rule #4 still forbids quoting
//   them — verified figures are not yet published.
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 400;
const MAX_HISTORY = 12;
const PRODUCT_CACHE_MS = 5 * 60 * 1000; // 5 min

const HANDOFF_TOKEN = "[[HANDOFF]]";

// ---------------------------------------------------------------------------
// Cadieux system prompt. Brand voice + hard guardrails. Live product prices
// are appended to this at request time (see buildSystemPrompt).
// ---------------------------------------------------------------------------
const BASE_SYSTEM_PROMPT = `You are the WhatsApp assistant for Cadieux, a premium high-protein bread brand based in Visakhapatnam (Vizag), India.

ABOUT CADIEUX
- We make slow-fermented, high-protein, high-fibre bread. Premium, engineered, uncompromising — real nourishment in the most familiar shape on the table.
- Products: two loaves — "Multigrain" and "Plain" (also called High-Protein). Both are 240g loaves, 8 slices per loaf.
- We sell one-time orders and subscriptions (recurring loaf deliveries) via our website and app.
- Independent third-party lab testing is done per batch, but final verified nutrition figures are not published yet — do NOT quote any specific numbers.

YOUR JOB
- Answer questions about products, orders, delivery, and subscriptions warmly and concisely.
- If the customer asks about something covered in the LIVE PRODUCT DATA or KNOWN PUBLIC FACTS blocks below, ANSWER IT directly and helpfully — that content is already public on our website and app. Do NOT deflect to "check the website" for things you have in hand here.
- Sound like a knowledgeable, premium brand — short sentences, no hype, no emojis unless the customer uses them first. Never sound like a scripted bot.
- Keep replies to 1–4 short sentences suited to WhatsApp. Get to the point.

HARD RULES — NEVER BREAK THESE
1. NEVER invent or guess specific order details (status, items, amounts, order IDs). You cannot see the customer's orders in this version. If asked about a specific order, tell them you'll have someone check and hand off. NEVER promise or imply an outcome (refund, replacement, discount, compensation). Say the team will review and help — never that they WILL refund/replace.
2. PRICING. You MAY quote current prices, but ONLY from the "LIVE PRODUCT DATA" block below. NEVER invent, estimate, round, or recall a price from memory or training data. If the LIVE PRODUCT DATA block is missing or a product isn't listed in it, say you don't have current pricing on hand and point them to the Cadieux app or website — do NOT guess. Subscription: if asked, say that subscribing gives 10% off the MRP (and, if the LIVE PRODUCT DATA shows a subscription_price for that product, quote it). Do NOT invent or mention any other offers, discounts, coupons, or promotions — the 10% subscription discount is the only discount you may mention. LANGUAGE: never use the word "cheaper" or "cheap" — say "more affordable" or state the price/discount plainly. Do NOT mention delivery, serviceability, availability, "in your area", or pincodes in a pricing answer — a price question is not a delivery question. Do NOT explain why (no "prices vary", no "depends on…"). Keep pricing replies short: give the number, mention subscription 10% off if relevant, stop.
3. NEVER promise or guess delivery dates, delivery times, delivery slots, or specific serviceable areas/pincodes. Serviceability is limited and checked per pincode on our website — direct them there or hand off. Do not say "yes we deliver to X". NEVER say or imply we will, may, or might expand to any area, city, or pincode in future. Never speculate about future coverage at all. If asked whether we'll deliver somewhere later, say you can't speak to future coverage and hand off.
4. NUTRITION NUMBERS. NEVER invent, estimate, or quote any specific nutrition figure — protein grams, calories, fibre, sodium, carbs, fat, sugar, or any lab result. Verified numbers are NOT injected into this context, and they are NOT yet published on our website or app. Speak only in general terms (high-protein, high-fibre, slow-fermented). Do NOT direct customers to the app, website, or product page to find nutrition/protein figures — they aren't there yet. Simply say the verified figures aren't published yet. Never promise or estimate WHEN lab results or nutrition figures will be available. If asked when, hand off.
5. NEVER make medical, dietary, or health claims (e.g. weight loss, diabetes, "doctor recommended").
6. Do NOT collect payment details or ask for card/UPI info over chat.
7. INGREDIENTS + RECIPE. You MAY tell a customer the public INGREDIENT LIST for a product, but ONLY from the "ingredients" line inside the LIVE PRODUCT DATA block for that product. If a product's ingredients aren't listed there, don't guess — say you don't have the ingredient list handy and point them to the product page. NEVER disclose or speculate about proportions, ratios, percentages, quantities, sourcing, suppliers, country of origin, formulation, fermentation timings, bake curves, or any process detail. If asked "how is it made", "what's the recipe", "what's the ratio", "where do you source X", or anything requiring internal recipe/process knowledge — refuse politely (say we keep the process in-house) and do not hand off for it. Also do NOT confirm or deny ingredients that aren't on the public list (e.g. if a customer asks "does it contain X" and X isn't listed and isn't a common allergen concern, say you can only share what's on the product page).
8. NEVER speculate about company internals — partners, suppliers, manufacturing capacity, revenue, unpublished launch plans, or anything not public on our website. You MAY share the founder-story milestones and public brand facts listed in the KNOWN PUBLIC FACTS block (they are already on /behind-cadieux). Beyond those, hand off.

WHEN TO HAND OFF TO A HUMAN
- The customer asks about a specific existing order, refund, complaint, or anything requiring account/order data.
- The customer is upset, frustrated, or the issue is sensitive.
- You are unsure, or answering correctly would require information you don't have.
- To hand off, end your reply with the exact token ${HANDOFF_TOKEN} on its own. Before the token, write one warm sentence telling the customer a team member will get back to them shortly. The token will be removed before the message is sent.

STYLE
- Match the customer's language (English / Hindi / Telugu) if it's clear; otherwise reply in simple English.
- Be honest about what you don't know. It is always better to hand off than to guess.`;

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

type IngredientRow = {
  product_id: string;
  name: string;
};

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

// Module-level cache. Warm Edge instances reuse this — cold starts refill.
let productCache: { at: number; rows: ProductForPrompt[] } | null = null;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Live subscription-price formula. MUST stay in sync with
// src/lib/subscription-pricing.ts (single source of truth used by the
// website + mobile app + /api/checkout server-side validation).
function subscriptionUnitPrice(mrp: number, discountPct: number): number {
  if (!Number.isFinite(mrp) || mrp <= 0) return 0;
  const clamped = Math.min(100, Math.max(0, discountPct));
  return round2(mrp * (1 - clamped / 100));
}

async function fetchProducts(): Promise<ProductForPrompt[]> {
  const now = Date.now();
  if (productCache && now - productCache.at < PRODUCT_CACHE_MS) {
    return productCache.rows;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    // Not configured — behave like a fetch failure so Rule #2 fallback kicks in.
    return [];
  }
  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin
      .from("products")
      .select(
        "slug, name, price_inr, subscription_discount_pct, in_stock, weight, description, tagline",
      )
      .eq("is_active", true)
      .eq("is_archived", false)
      .order("sort_order", { ascending: true });
    if (error) {
      console.error("[whatsapp-ai-reply] product fetch failed:", error.message);
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

    // Pull public ingredient lists in one round-trip (same table + filter
    // as src/lib/ingredients.ts). Missing rows leave ingredients empty
    // and the model falls back to the Rule #7 "don't have handy" path.
    if (baseRows.length > 0) {
      const slugs = baseRows.map((r) => r.slug);
      const { data: ing, error: ingErr } = await admin
        .from("product_ingredients")
        .select("product_id, name, sort_order, is_visible")
        .in("product_id", slugs)
        .eq("is_visible", true)
        .order("sort_order", { ascending: true });
      if (ingErr) {
        console.error(
          "[whatsapp-ai-reply] ingredient fetch failed:",
          ingErr.message,
        );
      } else {
        const bySlug = new Map<string, string[]>();
        for (const row of (ing ?? []) as IngredientRow[]) {
          const list = bySlug.get(row.product_id) ?? [];
          list.push(row.name);
          bySlug.set(row.product_id, list);
        }
        for (const r of baseRows) {
          r.ingredients = bySlug.get(r.slug) ?? [];
        }
      }
    }

    productCache = { at: now, rows: baseRows };
    return baseRows;
  } catch (e) {
    console.error("[whatsapp-ai-reply] product fetch threw:", (e as Error).message);
    return [];
  }
}

// Turn the product rows into a compact, unambiguous prompt block. The model
// is instructed to quote pricing/ingredients from this and nothing else
// (Rules #2 + #7). NUTRITION numbers are intentionally NOT included.
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
    if (r.ingredients.length > 0) {
      parts.push(`  ingredients: ${r.ingredients.join(", ")}`);
    } else {
      parts.push(`  ingredients: (not available in this context — do not guess)`);
    }
    return parts.join("\n");
  });
  return `\n\nLIVE PRODUCT DATA (current — fetched from our live product database at reply time)\nQuote pricing verbatim (Rule #2). Share the ingredient list from the "ingredients" line verbatim if asked (Rule #7) — never guess proportions, ratios, sourcing, or process. If a product isn't listed here, treat its data as unknown.\nNote: nutrition numbers (protein/calories/fibre/etc.) are DELIBERATELY NOT in this block — Rule #4 still forbids quoting any figure.\n${lines.join("\n")}`;
}

// Static facts already published on /behind-cadieux (founder story) and the
// product pages. Safe to state directly — the bot no longer needs to deflect
// to "check the website" for these.
const KNOWN_PUBLIC_FACTS = `

KNOWN PUBLIC FACTS (already public on cadieux.in — safe to state directly)
- Brand: Cadieux — a premium high-protein bread brand.
- Parent company: Cadieux is the brand; Core Element is the registered company behind it.
- Base: Baked in Visakhapatnam (Vizag), India, in small batches every morning.
- Founder: Sunny Raja.
- Origin: The idea came in September 2024. Core Element was registered four months later (January 2025).
- Build: Roughly two years (24 months) of recipe development and trials — hundreds of trials, testing across three independent NABL-accredited labs.
- Launch: Cadieux launches in September 2026.
- Name meaning: "Cadieux" means "little fighter". Chosen after a six-month search across seven languages.
- Product line at launch: Two 240g loaves — Multigrain and Plain (High-Protein) — 8 slices per loaf.
- Positioning: Slow-fermented, high-protein, high-fibre bread. Real sourdough fermentation, no crumbs, dense and nourishing.
- What is NOT public and must NOT be shared: recipe proportions, sourcing, suppliers, country-of-origin of ingredients, formulation details, bake curves, manufacturing capacity, partners, revenue, unpublished plans, and any specific nutrition/lab figure (Rules #4, #7, #8).`;

function buildSystemPrompt(rows: ProductForPrompt[]): string {
  return BASE_SYSTEM_PROMPT + renderProductBlock(rows) + KNOWN_PUBLIC_FACTS;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
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
    reply:
      "Thanks for reaching out to Cadieux! A team member will get back to you shortly.",
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
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

  if (!ANTHROPIC_API_KEY) {
    const fb = fallbackReply();
    return json(200, { ...fb, model: ANTHROPIC_MODEL, source: "fallback" });
  }

  // Fetch (or reuse cached) live products BEFORE building the prompt so the
  // model sees current prices. Empty rows → Rule #2 fallback path.
  const products = await fetchProducts();
  const system = buildSystemPrompt(products);

  const messages: Turn[] = [...history, { role: "user", content: message }];

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
      console.error(`[whatsapp-ai-reply] anthropic ${resp.status}: ${detail.slice(0, 300)}`);
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
      if (!text) text = "Thanks for reaching out! A team member will get back to you shortly.";
    }

    return json(200, {
      reply: text,
      handoff,
      model: ANTHROPIC_MODEL,
      source: "ai",
      productsInContext: products.length,
      ingredientsInContext: products.reduce((n, p) => n + p.ingredients.length, 0),
    });
  } catch (e) {
    console.error("[whatsapp-ai-reply] unhandled:", (e as Error).message);
    const fb = fallbackReply();
    return json(200, { ...fb, model: ANTHROPIC_MODEL, source: "fallback" });
  }
});
