"use client";

// Shared product form. Used by both /admin/products/new and the edit
// view at /admin/products/[id]. Owns its own state; on submit it
// passes a clean diff (or full row, for create) up to the parent.

import { ChangeEvent, FormEvent, useEffect, useState } from "react";

import { AdminProductRow } from "@/lib/admin-shared";

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.18)";

export type ProductFormValues = {
  slug: string;
  name: string;
  price_inr: string;
  subscription_per_loaf_inr: string;
  weight: string;
  description: string;
  tagline: string;
  highlights: string; // textarea, one per line
  image_url: string;
  in_stock: boolean;
  is_active: boolean;
  sort_order: string;
};

export function emptyFormValues(): ProductFormValues {
  return {
    slug: "",
    name: "",
    price_inr: "",
    subscription_per_loaf_inr: "",
    weight: "",
    description: "",
    tagline: "",
    highlights: "",
    image_url: "",
    in_stock: true,
    is_active: true,
    sort_order: "",
  };
}

export function formValuesFromRow(row: AdminProductRow): ProductFormValues {
  return {
    slug: row.slug,
    name: row.name,
    price_inr: String(row.price_inr ?? ""),
    subscription_per_loaf_inr:
      row.subscription_per_loaf_inr === null
        ? ""
        : String(row.subscription_per_loaf_inr),
    weight: row.weight ?? "",
    description: row.description ?? "",
    tagline: row.tagline ?? "",
    highlights: (row.highlights ?? []).join("\n"),
    image_url: row.image_url ?? "",
    in_stock: row.in_stock,
    is_active: row.is_active,
    sort_order: String(row.sort_order ?? ""),
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
  const payload: Record<string, unknown> = {
    slug: v.slug.trim(),
    name: v.name.trim(),
    price_inr: Number(v.price_inr),
    weight: v.weight.trim() || null,
    description: v.description.trim() || null,
    tagline: v.tagline.trim() || null,
    highlights,
    image_url: v.image_url.trim() || null,
    in_stock: v.in_stock,
    is_active: v.is_active,
  };
  if (v.subscription_per_loaf_inr.trim() === "") {
    payload.subscription_per_loaf_inr = null;
  } else {
    payload.subscription_per_loaf_inr = Number(v.subscription_per_loaf_inr);
  }
  if (v.sort_order.trim() !== "") {
    payload.sort_order = Number(v.sort_order);
  }
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
      // adminFetch sets Content-Type to JSON which would break multipart,
      // so we call fetch directly. The admin_session cookie is sent
      // automatically as a same-origin credential.
      const res = await fetch("/api/admin/products/upload-image", {
        method: "POST",
        credentials: "same-origin",
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
          label="Subscription per loaf (₹)"
          hint="Leave blank to match the one-time price."
        >
          <Input
            type="number"
            value={values.subscription_per_loaf_inr}
            onChange={(v) => patch({ subscription_per_loaf_inr: v })}
            placeholder="135"
            min={0}
            step={1}
          />
        </Field>
      </div>

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

      <Field label="Highlights" hint="One per line.">
        <Textarea
          value={values.highlights}
          onChange={(v) => patch({ highlights: v })}
          rows={4}
          placeholder={"High protein\nSourdough fermented\n400g"}
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

