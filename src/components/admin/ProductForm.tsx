"use client";

// Shared product form. Used by both /admin/products/new and the edit
// view at /admin/products/[id]. Owns its own state; on submit it
// passes a clean diff (or full row, for create) up to the parent.

import { ChangeEvent, FormEvent, useEffect, useState } from "react";

import { adminAuthHeaders } from "@/lib/admin-client";
import { AdminProductRow } from "@/lib/admin-shared";
import { subscriptionUnitPrice, subscriptionSavingsInr } from "@/lib/subscription-pricing";

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.18)";

export type ProductFormValues = {
  slug: string;
  name: string;
  price_inr: string;
  // V10: admin sets a discount %, not a raw sub price. The subscription
  // price is derived (read-only preview) from price_inr × (1 − pct/100).
  subscription_discount_pct: string;
  weight: string;
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
};

export function emptyFormValues(): ProductFormValues {
  return {
    slug: "",
    name: "",
    price_inr: "",
    subscription_discount_pct: "10",
    weight: "",
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
  };
}

export function formValuesFromRow(row: AdminProductRow): ProductFormValues {
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
  };
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
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);

  useEffect(() => {
    setValues(initial);
  }, [initial]);

  function patch(p: Partial<ProductFormValues>) {
    setValues((v) => ({ ...v, ...p }));
  }

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadBusy(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // Raw fetch (not adminFetch) so the browser sets the multipart
      // boundary itself — but still attach the admin bearer token via
      // adminAuthHeaders so it authenticates when Safari drops the cookie.
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
      patch({ image_url: json.url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setUploadError(msg);
    } finally {
      setUploadBusy(false);
      // Reset the input so the same file can be re-selected after an error.
      e.target.value = "";
    }
  }

  // Gallery upload: accepts multiple files, uploads each through the same
  // admin-gated /upload-image route (service-role write server-side — the
  // browser never sees the service key), and appends each returned public
  // URL as a new line to the gallery textarea. Partial success is kept:
  // any files that uploaded before an error are still appended.
  async function handleGalleryUpload(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setGalleryBusy(true);
    setGalleryError(null);
    const added: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
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
    } catch (err) {
      setGalleryError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      if (added.length > 0) {
        setValues((v) => {
          const existing = v.gallery_urls.trim();
          const appended = added.join("\n");
          return {
            ...v,
            gallery_urls: existing ? `${existing}\n${appended}` : appended,
          };
        });
      }
      setGalleryBusy(false);
      e.target.value = "";
    }
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
            border: "1px solid #ef4444",
            color: "#fecaca",
            fontFamily: "var(--font-body)",
            fontSize: "0.85rem",
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Weight">
          <Input
            value={values.weight}
            onChange={(v) => patch({ weight: v })}
            placeholder="400 g"
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

      <Field label="Image">
        <div className="flex flex-col gap-3">
          {values.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={values.image_url}
              alt=""
              style={{
                maxWidth: 240,
                border: `1px solid ${BORDER}`,
              }}
            />
          ) : (
            <div
              style={{
                width: 240,
                height: 160,
                border: `1px dashed ${BORDER}`,
                color: FADED,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.75rem",
                fontFamily: "var(--font-body)",
              }}
            >
              No image
            </div>
          )}
          <Input
            value={values.image_url}
            onChange={(v) => patch({ image_url: v })}
            placeholder="https://… (or use the upload button)"
          />
          <div className="flex items-center gap-3">
            <label
              className="uppercase cursor-pointer"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.7rem",
                letterSpacing: "0.25em",
                color: GOLD,
                border: `1px solid ${GOLD}`,
                padding: "0.45rem 0.9rem",
                opacity: uploadBusy ? 0.5 : 1,
              }}
            >
              {uploadBusy ? "Uploading…" : "Upload image"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleUpload}
                disabled={uploadBusy}
                style={{ display: "none" }}
              />
            </label>
            {values.image_url ? (
              <button
                type="button"
                onClick={() => patch({ image_url: "" })}
                className="uppercase"
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "0.7rem",
                  letterSpacing: "0.25em",
                  color: FADED,
                  background: "transparent",
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
          {uploadError ? (
            <p style={{ color: "#fecaca", fontSize: "0.8rem" }}>
              {uploadError}
            </p>
          ) : null}
        </div>
      </Field>

      <Field
        label="Gallery images"
        hint="One image URL per line. These become the product page gallery (in order). Leave blank to keep the current gallery. Upload buttons come next."
      >
        <div className="flex flex-col gap-3">
          <GalleryPreview raw={values.gallery_urls} />
          <Textarea
            value={values.gallery_urls}
            onChange={(v) => patch({ gallery_urls: v })}
            rows={4}
            placeholder={"https://…/photo-1.jpg\nhttps://…/photo-2.jpg"}
          />
          <div className="flex items-center gap-3">
            <label
              className="uppercase cursor-pointer"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.7rem",
                letterSpacing: "0.25em",
                color: GOLD,
                border: `1px solid ${GOLD}`,
                padding: "0.45rem 0.9rem",
                opacity: galleryBusy ? 0.5 : 1,
              }}
            >
              {galleryBusy ? "Uploading…" : "Upload gallery images"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleGalleryUpload}
                disabled={galleryBusy}
                style={{ display: "none" }}
              />
            </label>
          </div>
          {galleryError ? (
            <p style={{ color: "#fecaca", fontSize: "0.8rem" }}>
              {galleryError}
            </p>
          ) : null}
        </div>
      </Field>

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
        style={{ border: `1px solid ${BORDER}` }}
      >
        <span
          className="uppercase"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.72rem",
            letterSpacing: "0.25em",
            color: GOLD,
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
            fontSize: "0.75rem",
            letterSpacing: "0.25em",
            color: GOLD,
            border: `1px solid ${GOLD}`,
            padding: "0.6rem 1.2rem",
            background: "transparent",
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

// Live thumbnail strip for the gallery textarea. Renders each non-empty
// line as a small preview so the operator sees exactly what the PDP will
// show, in order. Broken URLs simply fail to load (browser default).
function GalleryPreview({ raw }: { raw: string }) {
  const urls = raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (urls.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${i}-${src}`}
          src={src}
          alt=""
          style={{
            width: 88,
            height: 88,
            objectFit: "cover",
            border: `1px solid ${BORDER}`,
          }}
        />
      ))}
    </div>
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
      style={{ border: `1px solid ${BORDER}` }}
    >
      <span
        className="uppercase"
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.68rem",
          letterSpacing: "0.22em",
          color: FADED,
        }}
      >
        Subscription price (derived, read-only)
      </span>
      {valid ? (
        <span style={{ fontFamily: "var(--font-body)", color: CREAM, fontSize: "0.95rem" }}>
          ₹{unit.toFixed(2)} / loaf{" "}
          <span style={{ color: FADED }}>
            (MRP ₹{mrp} · save ₹{savings.toFixed(2)} · {pct}% off)
          </span>
        </span>
      ) : (
        <span style={{ fontFamily: "var(--font-body)", color: FADED, fontSize: "0.85rem" }}>
          Enter a valid one-time price to preview the subscription price.
        </span>
      )}
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
          fontSize: "0.7rem",
          letterSpacing: "0.22em",
          color: CREAM,
        }}
      >
        {label}
        {required ? <span style={{ color: GOLD }}> *</span> : null}
      </span>
      {children}
      {hint ? (
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.72rem",
            color: FADED,
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
      className="px-3 py-2 bg-transparent outline-none"
      style={{
        border: `1px solid ${BORDER}`,
        color: CREAM,
        fontFamily: "var(--font-body)",
        fontSize: "0.9rem",
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
      className="px-3 py-2 bg-transparent outline-none resize-y"
      style={{
        border: `1px solid ${BORDER}`,
        color: CREAM,
        fontFamily: "var(--font-body)",
        fontSize: "0.9rem",
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
            fontSize: "0.75rem",
            letterSpacing: "0.2em",
            color: CREAM,
          }}
        >
          {label}
        </span>
        {hint ? (
          <span
            className="block"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.72rem",
              color: FADED,
            }}
          >
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

