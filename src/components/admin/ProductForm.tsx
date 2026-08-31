"use client";

// Shared product form. Used by both /admin/products/new and the edit
// view at /admin/products/[id]. Owns its own state; on submit it
// passes a clean diff (or full row, for create) up to the parent.

import { ChangeEvent, FormEvent, useEffect, useState } from "react";

import { adminAuthHeaders } from "@/lib/admin-client";
import { AdminProductRow } from "@/lib/admin-shared";
import { subscriptionUnitPrice, subscriptionSavingsInr } from "@/lib/subscription-pricing";

// Brand palette (only): Foundation Green, Grain Cream, Core Black.
// No greys, no plain whites, no legacy gold. These three colors carry
// every surface, text and border in the admin product form.
const FG = "#024628"; // Foundation Green — borders, labels, primary accent
const CREAM = "#FBF3D4"; // Grain Cream — input backgrounds, CTA text
const INK = "#1D1D1F"; // Core Black — body text, placeholders (at alpha)
// FG at 70% alpha for hint / secondary label copy. Still on-palette
// (rgba of Foundation Green), and stays legible on the ash canvas.
const FG_MUTED = "rgba(2, 70, 40, 0.7)";

// True when the URL is a product-video upload. Used by the media grid
// to pick <img> vs <video> preview. The uploader stamps a real
// extension (mp4/webm/mov/jpg/png/webp) so the string check is enough.
function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url);
}

// A single nutrition_per_slice row in form state. `key` is the JSON key
// (protein_g, calories, or a custom key); `value` is stored as a string
// so the input can be blank. Empty values are omitted on submit.
export type NutrientEntry = { key: string; value: string };

// Canonical nutrition keys the form always exposes. Custom keys already
// present in the DB row are appended after these so they stay editable.
const CANONICAL_NUTRIENT_KEYS = [
  "protein_g",
  "carbs_g",
  "fat_g",
  "fibre_g",
  "sugar_g",
  "calories",
] as const;

export type ProductFormValues = {
  slug: string;
  name: string;
  price_inr: string;
  // V10: admin sets a discount %, not a raw sub price. The subscription
  // price is derived (read-only preview) from price_inr × (1 − pct/100).
  subscription_discount_pct: string;
  weight: string;
  slices_per_loaf: string;
  description: string;
  tagline: string;
  highlights: string; // textarea, one per line
  image_url: string;
  gallery_urls: string; // textarea, one image URL per line (PDP gallery)
  in_stock: boolean;
  is_active: boolean;
  sort_order: string;
  // Subscription plan catalogue (consumed by /api/subscription-plans).
  is_subscription_plan: boolean;
  subscription_title: string;
  subscription_blurb: string;
  // Regulatory label paragraphs — free-form multiline.
  ingredients: string;
  allergens: string;
  // Per-slice nutrition rows. Order is: canonical keys first (always
  // shown even when blank), then any custom keys the DB already had,
  // then any keys the admin added via the "Add custom nutrient" button.
  nutrients: NutrientEntry[];
};

export function emptyFormValues(): ProductFormValues {
  return {
    slug: "",
    name: "",
    price_inr: "",
    subscription_discount_pct: "10",
    weight: "",
    slices_per_loaf: "",
    description: "",
    tagline: "",
    highlights: "",
    image_url: "",
    gallery_urls: "",
    in_stock: true,
    is_active: true,
    sort_order: "",
    is_subscription_plan: false,
    subscription_title: "",
    subscription_blurb: "",
    ingredients: "",
    allergens: "",
    nutrients: CANONICAL_NUTRIENT_KEYS.map((key) => ({ key, value: "" })),
  };
}

export function formValuesFromRow(row: AdminProductRow): ProductFormValues {
  // Seed the nutrient rows: always show every canonical key (value from
  // the DB row when present, else blank), then append any custom keys
  // the DB already had so they stay editable and are never dropped.
  const dbNutri = row.nutrition_per_slice ?? {};
  const canonicalRows = CANONICAL_NUTRIENT_KEYS.map((key) => ({
    key,
    value:
      typeof dbNutri[key] === "number" && Number.isFinite(dbNutri[key])
        ? String(dbNutri[key])
        : "",
  }));
  const customRows = Object.entries(dbNutri)
    .filter(
      ([k, v]) =>
        !(CANONICAL_NUTRIENT_KEYS as readonly string[]).includes(k) &&
        typeof v === "number" &&
        Number.isFinite(v),
    )
    .map(([k, v]) => ({ key: k, value: String(v) }));

  return {
    slug: row.slug,
    name: row.name,
    price_inr: String(row.price_inr ?? ""),
    subscription_discount_pct:
      row.subscription_discount_pct === null ||
      row.subscription_discount_pct === undefined
        ? "10"
        : String(row.subscription_discount_pct),
    weight: row.weight ?? "",
    slices_per_loaf:
      row.slices_per_loaf === null || row.slices_per_loaf === undefined
        ? ""
        : String(row.slices_per_loaf),
    description: row.description ?? "",
    tagline: row.tagline ?? "",
    highlights: (row.highlights ?? []).join("\n"),
    image_url: row.image_url ?? "",
    gallery_urls: (row.gallery_urls ?? []).join("\n"),
    in_stock: row.in_stock,
    is_active: row.is_active,
    sort_order: String(row.sort_order ?? ""),
    is_subscription_plan: row.is_subscription_plan,
    subscription_title: row.subscription_title ?? "",
    subscription_blurb: row.subscription_blurb ?? "",
    ingredients: row.ingredients ?? "",
    allergens: row.allergens ?? "",
    nutrients: [...canonicalRows, ...customRows],
  };
}

// Serialise a ProductFormValues into the JSON payload the API expects.
// Numeric fields are parsed; empty strings become null where the API
// allows null, or are omitted entirely otherwise.
export function valuesToPayload(v: ProductFormValues): Record<string, unknown> {
  const highlights = v.highlights
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const gallery_urls = v.gallery_urls
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // Nutrition: drop empty values (unset keys), coerce to Number, drop
  // NaN / negative. Empty result → null so the PDP hides the section.
  const nutritionObj: Record<string, number> = {};
  for (const entry of v.nutrients) {
    const key = entry.key.trim();
    if (!key) continue;
    const raw = entry.value.trim();
    if (raw === "") continue;
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) continue;
    nutritionObj[key] = num;
  }
  const nutrition_per_slice: Record<string, number> | null =
    Object.keys(nutritionObj).length > 0 ? nutritionObj : null;

  const payload: Record<string, unknown> = {
    slug: v.slug.trim(),
    name: v.name.trim(),
    price_inr: Number(v.price_inr),
    weight: v.weight.trim() || null,
    description: v.description.trim() || null,
    tagline: v.tagline.trim() || null,
    highlights,
    image_url: v.image_url.trim() || null,
    gallery_urls,
    in_stock: v.in_stock,
    is_active: v.is_active,
    ingredients: v.ingredients.trim() || null,
    allergens: v.allergens.trim() || null,
    nutrition_per_slice,
  };
  {
    const raw = v.slices_per_loaf.trim();
    if (raw === "") {
      payload.slices_per_loaf = null;
    } else {
      const n = Number(raw);
      payload.slices_per_loaf = Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    }
  }
  // V10: send the discount %, not a raw sub price. Empty → default 10.
  {
    const raw = v.subscription_discount_pct.trim();
    const pct = raw === "" ? 10 : Number(raw);
    payload.subscription_discount_pct = Number.isFinite(pct) ? pct : 10;
  }
  if (v.sort_order.trim() !== "") {
    payload.sort_order = Number(v.sort_order);
  }
  payload.is_subscription_plan = v.is_subscription_plan;
  payload.subscription_title = v.subscription_title.trim() || null;
  payload.subscription_blurb = v.subscription_blurb.trim() || null;
  return payload;
}

export function ProductForm({
  initial,
  submitLabel,
  onSubmit,
  busy,
  error,
}: {
  initial: ProductFormValues;
  submitLabel: string;
  onSubmit: (values: ProductFormValues) => Promise<void> | void;
  busy: boolean;
  error: string | null;
}) {
  const [values, setValues] = useState<ProductFormValues>(initial);

  useEffect(() => {
    setValues(initial);
  }, [initial]);

  function patch(p: Partial<ProductFormValues>) {
    setValues((v) => ({ ...v, ...p }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    void onSubmit(values);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 max-w-2xl">
      {error ? (
        <div
          className="p-3"
          style={{
            border: `1px solid ${FG}`,
            backgroundColor: CREAM,
            color: FG,
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      ) : null}

      <Field label="Name" required>
        <Input
          value={values.name}
          onChange={(v) => patch({ name: v })}
          placeholder="Multi-Grain High Protein Bread"
          required
        />
      </Field>

      <Field
        label="Slug"
        hint="URL-safe identifier. Auto-derived from name when blank on create."
      >
        <Input
          value={values.slug}
          onChange={(v) => patch({ slug: v })}
          placeholder="multigrain"
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="One-time price (₹)" required>
          <Input
            type="number"
            value={values.price_inr}
            onChange={(v) => patch({ price_inr: v })}
            placeholder="135"
            min={0}
            step={1}
            required
          />
        </Field>
        <Field
          label="Subscription discount (%)"
          hint="Applied to the MRP for subscription orders. Default 10."
        >
          <Input
            type="number"
            value={values.subscription_discount_pct}
            onChange={(v) => patch({ subscription_discount_pct: v })}
            placeholder="10"
            min={0}
            step={0.1}
          />
        </Field>
      </div>

      <SubPricePreview
        priceInr={values.price_inr}
        discountPct={values.subscription_discount_pct}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Weight">
          <Input
            value={values.weight}
            onChange={(v) => patch({ weight: v })}
            placeholder="400 g"
          />
        </Field>
        <Field
          label="Slices per loaf"
          hint="Optional. Displayed alongside per-slice nutrition."
        >
          <Input
            type="number"
            value={values.slices_per_loaf}
            onChange={(v) => patch({ slices_per_loaf: v })}
            placeholder="8"
            min={0}
            step={1}
          />
        </Field>
        <Field label="Sort order" hint="Lower numbers appear first.">
          <Input
            type="number"
            value={values.sort_order}
            onChange={(v) => patch({ sort_order: v })}
            placeholder="0"
            step={1}
          />
        </Field>
      </div>

      <Field label="Tagline">
        <Input
          value={values.tagline}
          onChange={(v) => patch({ tagline: v })}
          placeholder="Ancient grains, seeds, whey protein."
        />
      </Field>

      <Field label="Description">
        <Textarea
          value={values.description}
          onChange={(v) => patch({ description: v })}
          rows={4}
        />
      </Field>

      <Field
        label="Highlights"
        hint="One per line. Final trials are under process — do not enter specific nutrition figures until lab-verified."
      >
        <Textarea
          value={values.highlights}
          onChange={(v) => patch({ highlights: v })}
          rows={4}
          placeholder={"High protein\nSourdough fermented\n240g"}
        />
      </Field>

      <Field
        label="Ingredients"
        hint="Regulatory-label paragraph. Free-form multiline. Empty = section hidden on PDP."
      >
        <Textarea
          value={values.ingredients}
          onChange={(v) => patch({ ingredients: v })}
          rows={5}
          placeholder={"Whole wheat flour, oats, seeds (sunflower, flax, pumpkin), whey protein concentrate, sourdough starter, salt, water."}
        />
      </Field>

      <NutritionEditor
        entries={values.nutrients}
        onChange={(next) => patch({ nutrients: next })}
      />

      <Field
        label="Allergen info"
        hint="Free-form multiline. Empty = section hidden on PDP."
      >
        <Textarea
          value={values.allergens}
          onChange={(v) => patch({ allergens: v })}
          rows={3}
          placeholder={"Contains: wheat, milk. May contain traces of tree nuts and soy."}
        />
      </Field>

      <MediaUploader
        imageUrl={values.image_url}
        galleryRaw={values.gallery_urls}
        onChange={(next) => patch(next)}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Checkbox
          label="In stock"
          checked={values.in_stock}
          onChange={(v) => patch({ in_stock: v })}
          hint="Uncheck to disable Add-to-Cart while keeping the product visible."
        />
        <Checkbox
          label="Active"
          checked={values.is_active}
          onChange={(v) => patch({ is_active: v })}
          hint="Uncheck to hide from the public catalogue."
        />
      </div>

      {/* Subscription plan catalogue — toggles the product onto the
          /subscriptions/setup wizard. Title + blurb are the wizard-only
          display strings; per-loaf price comes from the field above. */}
      <div
        className="flex flex-col gap-4 p-4"
        style={{ border: `1px solid ${FG}`, borderRadius: 6 }}
      >
        <span
          className="uppercase"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.25em",
            fontWeight: 500,
            color: FG,
          }}
        >
          Subscription plan
        </span>
        <Checkbox
          label="Offer as a subscription plan"
          checked={values.is_subscription_plan}
          onChange={(v) => patch({ is_subscription_plan: v })}
          hint="When on, this product appears in the /subscriptions/setup wizard at the per-loaf price above."
        />
        {values.is_subscription_plan ? (
          <>
            <Field
              label="Wizard title"
              hint="Short label for the wizard picker (e.g. Multigrain). Defaults to the product name if blank."
            >
              <Input
                value={values.subscription_title}
                onChange={(v) => patch({ subscription_title: v })}
                placeholder="Multigrain"
              />
            </Field>
            <Field
              label="Wizard blurb"
              hint="One-line description shown under the title. Avoid nutrition figures until lab-verified."
            >
              <Input
                value={values.subscription_blurb}
                onChange={(v) => patch({ subscription_blurb: v })}
                placeholder="Ancient grains, seeds, whey protein."
              />
            </Field>
          </>
        ) : null}
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={busy}
          className="uppercase"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.25em",
            fontWeight: 500,
            color: CREAM,
            backgroundColor: FG,
            border: `1px solid ${FG}`,
            borderRadius: 6,
            padding: "0.7rem 1.4rem",
            opacity: busy ? 0.5 : 1,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

// Unified media uploader: images AND videos, multi-select + drag-drop,
// live thumbnail grid, per-tile delete + "make primary", per-batch
// progress. Treats the combined `[image_url, ...gallery_urls]` list as
// the ordered source of truth — index 0 is always the primary shown on
// the shop grid. Uploads go through the same admin-gated
// /api/admin/products/upload-image route; the service-role write stays
// server-side. Bucket + storage policies are untouched.
function MediaUploader({
  imageUrl,
  galleryRaw,
  onChange,
}: {
  imageUrl: string;
  galleryRaw: string;
  onChange: (next: { image_url: string; gallery_urls: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ i: number; total: number } | null>(
    null,
  );
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const gallery = galleryRaw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const combined: string[] = imageUrl ? [imageUrl, ...gallery] : gallery;

  // Serialise the combined ordered list back into (image_url, gallery_urls).
  // First item = primary, everything else joins the gallery in order.
  function serialize(list: string[]) {
    if (list.length === 0) {
      onChange({ image_url: "", gallery_urls: "" });
      return;
    }
    onChange({
      image_url: list[0],
      gallery_urls: list.slice(1).join("\n"),
    });
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setErr(null);
    const added: string[] = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        setProgress({ i: i + 1, total: files.length });
        const fd = new FormData();
        fd.append("file", files[i]);
        const res = await fetch("/api/admin/products/upload-image", {
          method: "POST",
          headers: adminAuthHeaders(),
          credentials: "include",
          body: fd,
        });
        const json = (await res.json().catch(() => ({}))) as {
          url?: string;
          error?: string;
        };
        if (!res.ok || !json.url) {
          throw new Error(json.error ?? `Upload failed (${res.status})`);
        }
        added.push(json.url);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      // Preserve partial success: any file that uploaded before an
      // error still gets appended so the operator doesn't lose work.
      if (added.length > 0) serialize([...combined, ...added]);
      setBusy(false);
      setProgress(null);
    }
  }

  function onFilePick(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    void uploadFiles(files);
    // Reset so the same file can be re-selected after an error.
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDrag(false);
    if (busy) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    void uploadFiles(files);
  }

  function removeAt(i: number) {
    serialize(combined.filter((_, idx) => idx !== i));
  }

  function promoteAt(i: number) {
    if (i === 0) return;
    const next = [...combined];
    const [pick] = next.splice(i, 1);
    next.unshift(pick);
    serialize(next);
  }

  return (
    <Field
      label="Media (photos + videos)"
      hint="First tile is the primary cover on the shop grid. Drag files onto the drop zone or click to pick multiple. Both images and videos are accepted."
    >
      <div className="flex flex-col gap-3">
        {combined.length > 0 ? (
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            }}
          >
            {combined.map((url, i) => {
              const video = isVideoUrl(url);
              return (
                <div
                  key={`${i}-${url}`}
                  style={{
                    border: `1px solid ${FG}`,
                    borderRadius: 6,
                    overflow: "hidden",
                    backgroundColor: CREAM,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {video ? (
                    <video
                      src={url}
                      muted
                      playsInline
                      preload="metadata"
                      style={{
                        width: "100%",
                        aspectRatio: "1 / 1",
                        objectFit: "cover",
                        display: "block",
                        backgroundColor: INK,
                      }}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt=""
                      style={{
                        width: "100%",
                        aspectRatio: "1 / 1",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  )}
                  <div
                    className="flex items-center justify-between"
                    style={{
                      padding: "0.35rem 0.5rem",
                      backgroundColor: FG,
                      color: CREAM,
                      fontFamily: "var(--font-body)",
                      fontSize: "0.875rem",
                      letterSpacing: "0.14em",
                      gap: "0.4rem",
                    }}
                  >
                    <span
                      className="uppercase"
                      style={{ fontWeight: 500 }}
                    >
                      {i === 0
                        ? video
                          ? "Primary · video"
                          : "Primary"
                        : video
                        ? `#${i + 1} · video`
                        : `#${i + 1}`}
                    </span>
                    <div className="flex gap-2">
                      {i !== 0 ? (
                        <button
                          type="button"
                          onClick={() => promoteAt(i)}
                          className="uppercase"
                          title="Make primary"
                          style={{
                            color: CREAM,
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            fontSize: "0.875rem",
                            letterSpacing: "0.14em",
                            cursor: "pointer",
                          }}
                        >
                          Make primary
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removeAt(i)}
                        className="uppercase"
                        title="Remove"
                        style={{
                          color: CREAM,
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          fontSize: "0.875rem",
                          letterSpacing: "0.14em",
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        <label
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className="uppercase cursor-pointer text-center block"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.22em",
            fontWeight: 500,
            color: FG,
            border: `2px dashed ${FG}`,
            borderRadius: 6,
            padding: "1.4rem 1rem",
            backgroundColor: drag ? CREAM : "rgba(251, 243, 212, 0.4)",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy && progress
            ? `Uploading ${progress.i} of ${progress.total}…`
            : combined.length === 0
            ? "Drop photos or videos here, or click to choose"
            : "Add more — drop files or click to choose"}
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={onFilePick}
            disabled={busy}
            style={{ display: "none" }}
          />
        </label>

        {err ? (
          <p
            style={{
              color: FG,
              fontFamily: "var(--font-body)",
              fontSize: "1rem",
              backgroundColor: CREAM,
              border: `1px solid ${FG}`,
              borderRadius: 6,
              padding: "0.5rem 0.75rem",
            }}
          >
            {err}
          </p>
        ) : null}
      </div>
    </Field>
  );
}

// Read-only derived subscription price preview. Mirrors exactly what the
// server (lib/subscription-pricing.ts) will charge — admins never type a
// raw sub price anymore.
function SubPricePreview({
  priceInr,
  discountPct,
}: {
  priceInr: string;
  discountPct: string;
}) {
  const mrp = Number(priceInr);
  const pct = discountPct.trim() === "" ? 10 : Number(discountPct);
  const valid = Number.isFinite(mrp) && mrp > 0 && Number.isFinite(pct);
  const input = { price_inr: mrp, subscription_discount_pct: pct };
  const unit = valid ? subscriptionUnitPrice(input) : 0;
  const savings = valid ? subscriptionSavingsInr(input) : 0;
  return (
    <div
      className="flex flex-col gap-1 p-3"
      style={{
        border: `1px solid ${FG}`,
        backgroundColor: CREAM,
        borderRadius: 6,
      }}
    >
      <span
        className="uppercase"
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.875rem",
          letterSpacing: "0.22em",
          fontWeight: 500,
          color: FG,
        }}
      >
        Subscription price (derived, read-only)
      </span>
      {valid ? (
        <span style={{ fontFamily: "var(--font-body)", color: INK, fontSize: "1rem" }}>
          ₹{unit.toFixed(2)} / loaf{" "}
          <span style={{ color: FG_MUTED }}>
            (MRP ₹{mrp} · save ₹{savings.toFixed(2)} · {pct}% off)
          </span>
        </span>
      ) : (
        <span style={{ fontFamily: "var(--font-body)", color: FG_MUTED, fontSize: "1rem" }}>
          Enter a valid one-time price to preview the subscription price.
        </span>
      )}
    </div>
  );
}

// Per-slice nutrition editor. Renders one row per entry (canonical keys
// first, then any custom keys the DB already had, then admin-added). The
// key input is disabled for canonical rows so a slip can't rename them.
// Empty values are omitted on submit (see valuesToPayload).
function NutritionEditor({
  entries,
  onChange,
}: {
  entries: NutrientEntry[];
  onChange: (next: NutrientEntry[]) => void;
}) {
  function updateAt(i: number, patch: Partial<NutrientEntry>) {
    onChange(entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function removeAt(i: number) {
    onChange(entries.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...entries, { key: "", value: "" }]);
  }
  return (
    <div className="flex flex-col gap-3">
      <span
        className="uppercase"
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.875rem",
          letterSpacing: "0.22em",
          fontWeight: 500,
          color: FG,
        }}
      >
        Nutrition per slice
      </span>
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "1rem",
          color: FG_MUTED,
        }}
      >
        Leave a value blank to omit that nutrient. All-blank = section hidden on PDP.
        Canonical keys (protein_g, carbs_g, fat_g, fibre_g, sugar_g, calories) stay in the payload as long as they have values.
      </span>
      <div className="flex flex-col gap-2">
        {entries.map((entry, i) => {
          const isCanonical = (CANONICAL_NUTRIENT_KEYS as readonly string[]).includes(
            entry.key,
          );
          return (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={entry.key}
                onChange={(e) => updateAt(i, { key: e.target.value })}
                placeholder="custom_key"
                disabled={isCanonical}
                className="px-3 py-2 outline-none"
                style={{
                  backgroundColor: CREAM,
                  color: INK,
                  caretColor: FG,
                  border: `1px solid ${FG}`,
                  borderRadius: 6,
                  fontFamily: "var(--font-body)",
                  fontSize: "1rem",
                  fontWeight: isCanonical ? 500 : 400,
                  opacity: isCanonical ? 0.85 : 1,
                  flex: "1 1 40%",
                  minWidth: 0,
                }}
              />
              <input
                type="number"
                value={entry.value}
                onChange={(e) => updateAt(i, { value: e.target.value })}
                placeholder="—"
                min={0}
                step="any"
                className="px-3 py-2 outline-none"
                style={{
                  backgroundColor: CREAM,
                  color: INK,
                  caretColor: FG,
                  border: `1px solid ${FG}`,
                  borderRadius: 6,
                  fontFamily: "var(--font-body)",
                  fontSize: "1rem",
                  flex: "1 1 30%",
                  minWidth: 0,
                }}
              />
              {isCanonical ? (
                <span
                  className="uppercase"
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "0.875rem",
                    letterSpacing: "0.2em",
                    fontWeight: 500,
                    color: FG,
                    padding: "0.3rem 0.6rem",
                  }}
                >
                  {entry.key === "calories" ? "kcal" : "g"}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="uppercase"
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "0.875rem",
                    letterSpacing: "0.2em",
                    color: FG,
                    background: "transparent",
                    border: `1px solid ${FG}`,
                    borderRadius: 6,
                    padding: "0.3rem 0.6rem",
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div>
        <button
          type="button"
          onClick={add}
          className="uppercase"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.25em",
            color: FG,
            border: `1px solid ${FG}`,
            borderRadius: 6,
            padding: "0.45rem 0.9rem",
            background: CREAM,
          }}
        >
          + Add custom nutrient
        </button>
      </div>
    </div>
  );
}

// ── primitives ──────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span
        className="uppercase"
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.875rem",
          letterSpacing: "0.22em",
          fontWeight: 500,
          color: FG,
        }}
      >
        {label}
        {required ? <span style={{ color: FG }}> *</span> : null}
      </span>
      {children}
      {hint ? (
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            color: FG_MUTED,
          }}
        >
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  placeholder,
  required,
  min,
  step,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  min?: number;
  step?: number;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      min={min}
      step={step}
      className="px-3 py-2 outline-none"
      style={{
        backgroundColor: CREAM,
        color: INK,
        caretColor: FG,
        border: `1px solid ${FG}`,
        borderRadius: 6,
        fontFamily: "var(--font-body)",
        fontSize: "1rem",
      }}
    />
  );
}

function Textarea({
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="px-3 py-2 outline-none resize-y"
      style={{
        backgroundColor: CREAM,
        color: INK,
        caretColor: FG,
        border: `1px solid ${FG}`,
        borderRadius: 6,
        fontFamily: "var(--font-body)",
        fontSize: "1rem",
      }}
    />
  );
}

function Checkbox({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 4 }}
      />
      <span>
        <span
          className="uppercase block"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.2em",
            fontWeight: 500,
            color: FG,
          }}
        >
          {label}
        </span>
        {hint ? (
          <span
            className="block"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "1rem",
              color: FG_MUTED,
            }}
          >
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

