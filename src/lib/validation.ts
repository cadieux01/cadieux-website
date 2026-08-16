// Centralised zod schemas + helpers for validating user input on API routes.
//
// Validate at the boundary (server route handlers), fail closed (reject
// unknown shapes via .strict()), cap lengths (DoS + storage hygiene), and
// never trust client-supplied prices/totals — the checkout route still
// recomputes those server-side.
//
// Usage:
//   import { parseBody, SendSmsSchema } from "@/lib/validation";
//   const parsed = await parseBody(req, SendSmsSchema);
//   if (!parsed.ok) return parsed.response;
//   const data = parsed.data; // fully typed + sanitised

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// ── primitives ──────────────────────────────────────────────────────────────

// Indian mobile: accept "+91XXXXXXXXXX", "91XXXXXXXXXX", or 10-digit local.
// Normalises to the bare 10-digit local form (matches existing
// normalizePhone helpers across the codebase).
export const PhoneSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\D/g, ""))
  .refine((d) => d.length === 10 || (d.length === 12 && d.startsWith("91")), {
    message: "Invalid Indian mobile number",
  })
  .transform((d) => (d.length === 12 ? d.slice(2) : d));

export const OtpCodeSchema = z.string().trim().regex(/^\d{4,8}$/, "Invalid code");

// Free text destined for storage / display. Strips C0 control chars
// (which corrupt logs and can be used to mask payloads) then enforces
// length bounds. React escapes on render — this is defense-in-depth and
// storage hygiene, not the only sanitisation layer.
export function boundedText(max: number, min = 0) {
  return z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim())
    .pipe(z.string().min(min).max(max));
}

// Plain-text only — reject anything that looks like HTML/markup so a
// review reply can't slip script-like tokens past the renderer. Pairs
// with boundedText (length + control-char stripping).
export function plainText(max: number, min = 1) {
  return boundedText(max, min).refine((s) => !/[<>]/.test(s), {
    message: "HTML is not allowed",
  });
}

// ── product (admin PATCH /api/admin/products/[id]) ───────────────────────────
const SLUG = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case")
  .max(80);

// Shape-only check — the route still does its own slug collision check,
// price coercion, and audit recording. This rejects obviously bad shapes
// (wrong types, unknown keys, out-of-range numbers) before any DB work.
export const ProductUpdateSchema = z
  .object({
    slug: SLUG.optional(),
    name: boundedText(120, 1).optional(),
    price_inr: z.number().int().nonnegative().max(100000).optional(),
    subscription_per_loaf_inr: z
      .number()
      .int()
      .nonnegative()
      .max(100000)
      .nullable()
      .optional(),
    // V10: per-product subscription discount %, [0, 100]. The sub price is
    // derived from price_inr × (1 − pct/100); the raw column above is
    // vestigial and no longer written by the admin form.
    subscription_discount_pct: z.number().min(0).max(100).optional(),
    weight: boundedText(40).nullable().optional(),
    description: boundedText(4000).nullable().optional(),
    tagline: boundedText(200).nullable().optional(),
    highlights: z.array(boundedText(200)).max(20).optional(),
    image_url: z.string().url().max(2048).nullable().optional(),
    // Admin-curated PDP gallery — ordered list of public image URLs.
    gallery_urls: z.array(z.string().url().max(2048)).max(20).optional(),
    in_stock: z.boolean().optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(100000).optional(),
    // Subscription plan catalogue. Title/blurb are wizard-only display
    // strings (shorter than the product name + brand copy). is_subscription_plan
    // is the new DB-driven whitelist consumed by /api/subscription-plans.
    is_subscription_plan: z.boolean().optional(),
    subscription_title: boundedText(80).nullable().optional(),
    subscription_blurb: boundedText(200).nullable().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: "No fields to update" });

// ── review replies (POST /api/reviews/[id]/replies) ─────────────────────────
export const ReviewReplySchema = z
  .object({
    author_name: plainText(40, 1),
    body: plainText(1000, 1),
    // The POST route also accepts is_admin — but that flag is only
    // honoured when the request carries a valid admin session, so we
    // accept-and-ignore here (admin gate is enforced separately).
    is_admin: z.boolean().optional(),
  })
  .strict();

// ── transactional SMS trigger (/api/send-sms) ───────────────────────────────
// Mirrors the route's existing payload shape (phone, name, type, orderId,
// total, address, status). `type` is locked to the route's known set.
export const SendSmsSchema = z
  .object({
    phone: PhoneSchema,
    name: boundedText(80).optional(),
    type: z.enum(["order_placed", "status_change", "customer_edit"]),
    orderId: boundedText(64).optional(),
    // Human-facing OLF number (e.g. 'OLF7'). When supplied it replaces
    // the UUID-slice fallback that used to be embedded in every SMS body.
    orderNumber: boundedText(64).optional(),
    total: z.number().nonnegative().max(10_000_000).optional(),
    address: boundedText(500).optional(),
    status: boundedText(40).optional(),
  })
  .strict();

// ── transactional WhatsApp trigger (/api/send-whatsapp) ─────────────────────
export const SendWhatsappSchema = z
  .object({
    // Accept either field name, like the route does.
    phone: PhoneSchema.optional(),
    to: PhoneSchema.optional(),
    message: boundedText(2000, 1),
  })
  .strict()
  .refine((o) => !!(o.phone || o.to), {
    message: "phone or to is required",
    path: ["phone"],
  });

// ── helper: parse a request body against a schema ───────────────────────────
type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

export async function parseBody<T>(
  req: NextRequest,
  schema: z.ZodType<T>,
): Promise<ParseResult<T>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    // Return field-level error messages but NEVER echo the raw input —
    // that would reflect attacker-controlled data verbatim back to the
    // caller / logs.
    const fields = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Validation failed", fields },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: result.data };
}

// parseBodyFromObject — same as parseBody but accepts an already-parsed
// JSON value. Useful when a route needs to peek at the body (e.g. to
// switch on an `action` field) before validating it against a schema.
export function parseBodyFromObject<T>(
  json: unknown,
  schema: z.ZodType<T>,
): ParseResult<T> {
  const result = schema.safeParse(json);
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Validation failed", fields },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: result.data };
}
