// Order body validation + server-side price re-check.
//
// Extracted from /api/mobile/checkout so the same validator can later
// be applied to the legacy /api/checkout (which currently trusts the
// client-supplied total_amount). Pure functions, no I/O — the caller
// is responsible for fetching products and customer rows.

// Flat delivery fee added to every order. No free-delivery threshold.
// Mirrors the website's "Standard delivery — ₹50" line in the Shipping
// Policy. Treated as the source of truth for both /api/checkout and
// /api/mobile/checkout so the stored orders.total_amount and the
// payment-gateway charge always agree.
export const DELIVERY_FEE_INR = 50;

export type ClientOrderItem = {
  product_id: string;
  quantity: number;
  price_snapshot_inr: number;
};

export type ClientDeliveryAddress = {
  line1: string;
  area: string;
  city: string;
  pincode: string;
};

export type ClientOrderBody = {
  full_name: string;
  delivery_address: ClientDeliveryAddress;
  items: ClientOrderItem[];
};

export type ProductRow = {
  id: string;
  name: string;
  price_inr: number;
  is_active: boolean;
};

export type ItemSnapshot = {
  product_id: string;
  name: string;
  quantity: number;
  unit_price_inr: number;
  line_total_inr: number;
};

export type ValidationFailure = {
  ok: false;
  status: number;
  error: string;
  code?: string;
};

export type ValidationSuccess = {
  ok: true;
  fullName: string;
  addressString: string;
  items: ItemSnapshot[];
  total: number;
  itemsSummary: { name: string; quantity: number }[];
};

export type ValidationResult = ValidationSuccess | ValidationFailure;

const NAME_MIN = 2;
const NAME_MAX = 80;
const LINE1_MIN = 3;
const LINE1_MAX = 120;
const AREA_MIN = 2;
const AREA_MAX = 80;
const CITY_MIN = 2;
const CITY_MAX = 60;
const QTY_MIN = 1;
const QTY_MAX = 99;
const ITEMS_MAX = 20;

const PINCODE_RE = /^\d{6}$/;

function fail(
  status: number,
  error: string,
  code?: string,
): ValidationFailure {
  return { ok: false, status, error, code };
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Shape-and-bounds check on the request body. Does NOT call the DB.
 * Returns a normalized snapshot OR a failure descriptor with the
 * status / error / optional code that the route handler should send back.
 */
export function validateOrderBodyShape(
  raw: unknown,
):
  | { ok: true; body: ClientOrderBody; fullName: string; addressString: string }
  | ValidationFailure {
  if (!raw || typeof raw !== "object") {
    return fail(400, "Invalid request body.", "body");
  }
  const body = raw as Record<string, unknown>;

  // full_name
  if (!isString(body.full_name)) {
    return fail(400, "full_name is required.", "full_name");
  }
  const fullName = body.full_name.trim();
  if (fullName.length < NAME_MIN || fullName.length > NAME_MAX) {
    return fail(
      400,
      `full_name must be ${NAME_MIN}-${NAME_MAX} characters.`,
      "full_name",
    );
  }

  // delivery_address
  const addr = body.delivery_address;
  if (!addr || typeof addr !== "object") {
    return fail(400, "delivery_address is required.", "delivery_address");
  }
  const addrRec = addr as Record<string, unknown>;
  if (!isString(addrRec.line1)) {
    return fail(400, "delivery_address.line1 is required.", "line1");
  }
  if (!isString(addrRec.area)) {
    return fail(400, "delivery_address.area is required.", "area");
  }
  if (!isString(addrRec.city)) {
    return fail(400, "delivery_address.city is required.", "city");
  }
  if (!isString(addrRec.pincode)) {
    return fail(400, "delivery_address.pincode is required.", "pincode");
  }
  const line1 = addrRec.line1.trim();
  const area = addrRec.area.trim();
  const city = addrRec.city.trim();
  const pincode = addrRec.pincode.trim();
  if (line1.length < LINE1_MIN || line1.length > LINE1_MAX) {
    return fail(
      400,
      `line1 must be ${LINE1_MIN}-${LINE1_MAX} characters.`,
      "line1",
    );
  }
  if (area.length < AREA_MIN || area.length > AREA_MAX) {
    return fail(400, `area must be ${AREA_MIN}-${AREA_MAX} characters.`, "area");
  }
  if (city.length < CITY_MIN || city.length > CITY_MAX) {
    return fail(400, `city must be ${CITY_MIN}-${CITY_MAX} characters.`, "city");
  }
  if (!PINCODE_RE.test(pincode)) {
    return fail(400, "pincode must be exactly 6 digits.", "pincode");
  }

  // items
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return fail(400, "items must be a non-empty array.", "items");
  }
  if (body.items.length > ITEMS_MAX) {
    return fail(
      400,
      `Cart exceeds ${ITEMS_MAX} line items.`,
      "items_too_many",
    );
  }
  const items: ClientOrderItem[] = [];
  for (let i = 0; i < body.items.length; i++) {
    const raw = body.items[i] as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") {
      return fail(400, `items[${i}] is invalid.`, "items");
    }
    if (!isString(raw.product_id)) {
      return fail(400, `items[${i}].product_id is required.`, "items");
    }
    const productId = raw.product_id.trim();
    if (productId === "" || productId.length > 64) {
      return fail(400, `items[${i}].product_id is invalid.`, "items");
    }
    if (
      !isFiniteNumber(raw.quantity) ||
      raw.quantity < QTY_MIN ||
      raw.quantity > QTY_MAX ||
      !Number.isInteger(raw.quantity)
    ) {
      return fail(
        400,
        `items[${i}].quantity must be an integer between ${QTY_MIN} and ${QTY_MAX}.`,
        "items",
      );
    }
    if (
      !isFiniteNumber(raw.price_snapshot_inr) ||
      raw.price_snapshot_inr < 0
    ) {
      return fail(
        400,
        `items[${i}].price_snapshot_inr must be a non-negative number.`,
        "items",
      );
    }
    items.push({
      product_id: productId,
      quantity: raw.quantity,
      price_snapshot_inr: raw.price_snapshot_inr,
    });
  }

  const addressString = `${line1}, ${area}, ${city} - ${pincode}`;

  return {
    ok: true,
    body: {
      full_name: fullName,
      delivery_address: { line1, area, city, pincode },
      items,
    },
    fullName,
    addressString,
  };
}

/**
 * Reconciles client-supplied prices against authoritative `products` rows
 * fetched by the caller. On success, returns the items snapshot, the
 * server-computed total, and a short summary suitable for the response.
 * On any mismatch / missing / inactive product, returns a 400 failure.
 */
export function reconcilePrices(
  items: ClientOrderItem[],
  products: ProductRow[],
): ValidationResult {
  const productById = new Map(products.map((p) => [p.id, p]));

  const snapshot: ItemSnapshot[] = [];
  let total = 0;

  for (const item of items) {
    const product = productById.get(item.product_id);
    if (!product || !product.is_active) {
      return fail(
        400,
        `Product unavailable: ${item.product_id}`,
        "product_unavailable",
      );
    }
    const serverLine = product.price_inr * item.quantity;
    const clientLine = item.price_snapshot_inr * item.quantity;
    if (serverLine !== clientLine) {
      return fail(
        400,
        `Price mismatch: ${item.product_id} — please refresh and retry`,
        "price_mismatch",
      );
    }
    snapshot.push({
      product_id: item.product_id,
      name: product.name,
      quantity: item.quantity,
      unit_price_inr: product.price_inr,
      line_total_inr: serverLine,
    });
    total += serverLine;
  }

  return {
    ok: true,
    fullName: "", // filled in by the caller via spread; kept here for shape compat
    addressString: "",
    items: snapshot,
    total,
    itemsSummary: snapshot.map((s) => ({ name: s.name, quantity: s.quantity })),
  };
}

/**
 * Strips a leading +91 (and any whitespace) from an E.164 Indian number to
 * get the 10-digit local form the existing customers table uses. Tech
 * debt: planned migration to E.164 in a later hardening pass.
 */
export function toLocal10(phoneE164: string): string {
  return phoneE164.replace(/^\+?91/, "").replace(/\D/g, "");
}

// ──────────────────────────────────────────────────────────────────────────
// Web place_order validators (legacy /api/checkout).
//
// The legacy route used to trust client `total_amount` outright — a bad
// actor could pay ₹1 for a ₹99 loaf. The fix below mirrors the mobile
// route: clients must send `items` with slug + quantity, server fetches
// authoritative prices from the products table, recomputes the subtotal,
// and rejects on mismatch.
//
// Web carts can mix one-time products with subscriptions. We only run a
// strict per-line price check on `kind: "once"` items (those map 1:1 to
// products.price_inr). For `kind: "sub"` we trust the client-supplied
// line total here and defer to place_subscription's own validation in
// lib/subscription-pricing.ts — subscription pricing is a function of
// per-loaf price × qty × deliveryCount which doesn't fit the
// "price × quantity" per-line model used for one-time items.

export type ClientWebOrderItem = {
  slug: string;
  quantity: number;
  kind: "once" | "sub";
  line_total_inr: number;
};

const SLUG_RE = /^[a-z0-9-]{1,64}$/;

/**
 * Shape-and-bounds check on the `items` array the web client now sends
 * to /api/checkout?action=place_order. Pure — no DB access.
 */
export function validateWebOrderItemsShape(
  raw: unknown,
):
  | { ok: true; items: ClientWebOrderItem[] }
  | ValidationFailure {
  if (!Array.isArray(raw) || raw.length === 0) {
    return fail(400, "items must be a non-empty array.", "items");
  }
  if (raw.length > ITEMS_MAX) {
    return fail(400, `Cart exceeds ${ITEMS_MAX} line items.`, "items_too_many");
  }
  const items: ClientWebOrderItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] as Record<string, unknown> | null;
    if (!row || typeof row !== "object") {
      return fail(400, `items[${i}] is invalid.`, "items");
    }
    if (!isString(row.slug) || !SLUG_RE.test(row.slug)) {
      return fail(400, `items[${i}].slug is invalid.`, "items");
    }
    if (
      !isFiniteNumber(row.quantity) ||
      !Number.isInteger(row.quantity) ||
      row.quantity < QTY_MIN ||
      row.quantity > QTY_MAX
    ) {
      return fail(
        400,
        `items[${i}].quantity must be an integer between ${QTY_MIN} and ${QTY_MAX}.`,
        "items",
      );
    }
    if (row.kind !== "once" && row.kind !== "sub") {
      return fail(400, `items[${i}].kind must be "once" or "sub".`, "items");
    }
    if (
      !isFiniteNumber(row.line_total_inr) ||
      row.line_total_inr < 0
    ) {
      return fail(
        400,
        `items[${i}].line_total_inr must be a non-negative number.`,
        "items",
      );
    }
    items.push({
      slug: row.slug,
      quantity: row.quantity,
      kind: row.kind,
      line_total_inr: row.line_total_inr,
    });
  }
  return { ok: true, items };
}

export type WebProductRow = {
  slug: string;
  name: string;
  price_inr: number;
  is_active: boolean;
};

export type WebReconcileSuccess = {
  ok: true;
  subtotal: number;
};

/**
 * Server-side price recheck for web orders. For every `once` line, asserts
 * `product.price_inr * quantity === line_total_inr`. For `sub` lines, the
 * slug must exist + be active but we don't validate the line total here
 * (see comment block above). Returns the server-trusted subtotal.
 */
export function reconcileWebPrices(
  items: ClientWebOrderItem[],
  products: WebProductRow[],
): WebReconcileSuccess | ValidationFailure {
  const productBySlug = new Map(products.map((p) => [p.slug, p]));
  let subtotal = 0;
  for (const item of items) {
    const product = productBySlug.get(item.slug);
    if (!product || !product.is_active) {
      return fail(
        400,
        `Product unavailable: ${item.slug}`,
        "product_unavailable",
      );
    }
    if (item.kind === "once") {
      const expected = product.price_inr * item.quantity;
      if (expected !== item.line_total_inr) {
        return fail(
          400,
          `Price mismatch: ${item.slug} — please refresh and retry`,
          "price_mismatch",
        );
      }
      subtotal += expected;
    } else {
      // sub — trust the client line total, validated elsewhere.
      subtotal += item.line_total_inr;
    }
  }
  return { ok: true, subtotal };
}
