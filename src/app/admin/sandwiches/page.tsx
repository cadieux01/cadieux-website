"use client";

// Admin sandwich catalogue. Backend-only (no customer surface yet); this
// page is the ONLY writer into public.sandwiches / sandwich_variants.
//
// The prices grid uses TWO fixed bread columns: 'plain' and 'multigrain'.
// An empty cell = the sandwich is not offered on that bread (matches the
// seed migration's "—" contract — a MISSING row, not a NULL price). Adding
// a third bread later means adding a slug to BREADS below and reshipping.

import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";

const CREAM = "#FBF3D4";
const FADED = "rgba(251,243,212,0.6)";
const BORDER = "rgba(251,243,212,0.18)";

// The bread slugs offered today. Kept in sync with the seed migration.
const BREADS = [
  { slug: "plain", label: "Plain" },
  { slug: "multigrain", label: "Multigrain" },
] as const;

type Variant = {
  id: string;
  bread_slug: string;
  price_inr: number;
  is_available: boolean;
};

type Sandwich = {
  id: string;
  slug: string;
  name: string;
  category: "veg" | "nonveg";
  description: string | null;
  image_url: string | null;
  gallery_urls: string[];
  is_available: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sandwich_variants: Variant[];
};

type EditorState = {
  id: string | null; // null = create
  slug: string;
  name: string;
  category: "veg" | "nonveg";
  description: string;
  image_url: string;
  is_available: boolean;
  sort_order: number;
  // one string per bread — "" = not offered.
  prices: Record<string, string>;
  variantAvail: Record<string, boolean>;
};

function emptyEditor(sortOrder: number): EditorState {
  return {
    id: null,
    slug: "",
    name: "",
    category: "veg",
    description: "",
    image_url: "",
    is_available: true,
    sort_order: sortOrder,
    prices: Object.fromEntries(BREADS.map((b) => [b.slug, ""])),
    variantAvail: Object.fromEntries(BREADS.map((b) => [b.slug, true])),
  };
}

function editorFromSandwich(s: Sandwich): EditorState {
  const prices: Record<string, string> = Object.fromEntries(
    BREADS.map((b) => [b.slug, ""]),
  );
  const variantAvail: Record<string, boolean> = Object.fromEntries(
    BREADS.map((b) => [b.slug, true]),
  );
  for (const v of s.sandwich_variants ?? []) {
    if (v.bread_slug in prices) {
      prices[v.bread_slug] = String(v.price_inr);
      variantAvail[v.bread_slug] = v.is_available;
    }
  }
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    category: s.category,
    description: s.description ?? "",
    image_url: s.image_url ?? "",
    is_available: s.is_available,
    sort_order: s.sort_order,
    prices,
    variantAvail,
  };
}

export default function AdminSandwichesPage() {
  const [rows, setRows] = useState<Sandwich[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await adminFetch<{ sandwiches: Sandwich[] }>(
        "/api/admin/sandwiches",
      );
      setRows(res.sandwiches ?? []);
    } catch (e) {
      const msg =
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to load sandwiches";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const veg = rows.filter((r) => r.category === "veg").length;
    const nonveg = rows.filter((r) => r.category === "nonveg").length;
    return { veg, nonveg };
  }, [rows]);

  const nextSortOrder = useMemo(() => {
    const max = rows.reduce((m, r) => (r.sort_order > m ? r.sort_order : m), 0);
    return max + 10;
  }, [rows]);

  const openCreate = () => setEditor(emptyEditor(nextSortOrder));
  const openEdit = (s: Sandwich) => setEditor(editorFromSandwich(s));
  const closeEditor = () => setEditor(null);

  const save = useCallback(async () => {
    if (!editor) return;
    setSaving(true);
    setError(null);
    try {
      // Build variants array: only rows whose price is a positive integer.
      const variants: {
        bread_slug: string;
        price_inr: number;
        is_available: boolean;
      }[] = [];
      for (const b of BREADS) {
        const raw = editor.prices[b.slug]?.trim() ?? "";
        if (!raw) continue;
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0 || n >= 100000) {
          throw new Error(
            `Price for ${b.label} must be a positive number below 100000.`,
          );
        }
        variants.push({
          bread_slug: b.slug,
          price_inr: Math.trunc(n),
          is_available: editor.variantAvail[b.slug] ?? true,
        });
      }

      if (editor.id === null) {
        // CREATE — then PATCH the variants in a second call. (POST /route
        // creates the shell so a bad variant does not orphan a row.)
        const created = await adminFetch<{ sandwich: Sandwich }>(
          "/api/admin/sandwiches",
          {
            method: "POST",
            body: JSON.stringify({
              name: editor.name,
              slug: editor.slug || undefined,
              category: editor.category,
              description: editor.description || null,
              image_url: editor.image_url || null,
              is_available: editor.is_available,
              sort_order: editor.sort_order,
            }),
          },
        );
        if (variants.length > 0) {
          await adminFetch<{ sandwich: Sandwich }>(
            `/api/admin/sandwiches/${created.sandwich.id}`,
            {
              method: "PATCH",
              body: JSON.stringify({ variants }),
            },
          );
        }
      } else {
        await adminFetch<{ sandwich: Sandwich }>(
          `/api/admin/sandwiches/${editor.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              name: editor.name,
              slug: editor.slug,
              category: editor.category,
              description: editor.description || null,
              image_url: editor.image_url || null,
              is_available: editor.is_available,
              sort_order: editor.sort_order,
              variants,
            }),
          },
        );
      }
      setEditor(null);
      await load();
    } catch (e) {
      const msg =
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Save failed";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }, [editor, load]);

  const remove = useCallback(
    async (s: Sandwich) => {
      const ok = window.confirm(
        `Delete "${s.name}"?\n\nAll per-bread prices for this sandwich are removed with it. This cannot be undone.`,
      );
      if (!ok) return;
      try {
        await adminFetch<{ ok: true }>(`/api/admin/sandwiches/${s.id}`, {
          method: "DELETE",
        });
        await load();
      } catch (e) {
        const msg =
          e instanceof AdminFetchError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Delete failed";
        setError(msg);
      }
    },
    [load],
  );

  const nudge = useCallback(
    async (s: Sandwich, direction: -1 | 1) => {
      // Simple sort-order swap with the neighbour in the same category. Both
      // rows PATCH in parallel; on error we reload rather than trying to
      // reverse — the source of truth is the DB.
      const inCat = rows
        .filter((r) => r.category === s.category)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
      const idx = inCat.findIndex((r) => r.id === s.id);
      const swapIdx = idx + direction;
      if (idx < 0 || swapIdx < 0 || swapIdx >= inCat.length) return;
      const other = inCat[swapIdx];
      try {
        await Promise.all([
          adminFetch(`/api/admin/sandwiches/${s.id}`, {
            method: "PATCH",
            body: JSON.stringify({ sort_order: other.sort_order }),
          }),
          adminFetch(`/api/admin/sandwiches/${other.id}`, {
            method: "PATCH",
            body: JSON.stringify({ sort_order: s.sort_order }),
          }),
        ]);
        await load();
      } catch (e) {
        const msg =
          e instanceof AdminFetchError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Reorder failed";
        setError(msg);
        await load();
      }
    },
    [rows, load],
  );

  return (
    <AdminShell
      title="Sandwiches"
      subtitle={`${counts.veg} veg · ${counts.nonveg} non-veg`}
      actions={
        <>
          <button
            type="button"
            onClick={() => void load()}
            className="uppercase"
            style={btnGhost}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="uppercase"
            style={btnPrimary}
          >
            New sandwich
          </button>
        </>
      }
    >
      {error ? <ErrorBox message={error} onDismiss={() => setError(null)} /> : null}

      {loading ? (
        <p style={{ color: FADED, fontFamily: "var(--font-body)" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: FADED, fontFamily: "var(--font-body)" }}>
          No sandwiches yet. Create one with “New sandwich”.
        </p>
      ) : (
        <>
          <CategoryTable
            title="Veg"
            rows={rows.filter((r) => r.category === "veg")}
            onEdit={openEdit}
            onDelete={remove}
            onNudge={nudge}
          />
          <div style={{ height: "2rem" }} />
          <CategoryTable
            title="Non-veg"
            rows={rows.filter((r) => r.category === "nonveg")}
            onEdit={openEdit}
            onDelete={remove}
            onNudge={nudge}
          />
        </>
      )}

      {editor ? (
        <EditorModal
          state={editor}
          onChange={setEditor}
          onCancel={closeEditor}
          onSave={save}
          saving={saving}
        />
      ) : null}
    </AdminShell>
  );
}

function CategoryTable({
  title,
  rows,
  onEdit,
  onDelete,
  onNudge,
}: {
  title: string;
  rows: Sandwich[];
  onEdit: (s: Sandwich) => void;
  onDelete: (s: Sandwich) => void;
  onNudge: (s: Sandwich, direction: -1 | 1) => void;
}) {
  const sorted = [...rows].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
  return (
    <section>
      <h2
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: "1.15rem",
          color: CREAM,
          margin: "0 0 0.75rem 0",
          letterSpacing: "0.02em",
        }}
      >
        {title}
      </h2>
      {sorted.length === 0 ? (
        <p style={{ color: FADED, fontFamily: "var(--font-body)" }}>None yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full"
            style={{
              borderCollapse: "collapse",
              fontFamily: "var(--font-body)",
              color: CREAM,
            }}
          >
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                <Th>Order</Th>
                <Th>Name</Th>
                <Th>Slug</Th>
                {BREADS.map((b) => (
                  <Th key={b.slug} align="right">
                    {b.label}
                  </Th>
                ))}
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <Td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => onNudge(s, -1)}
                        disabled={i === 0}
                        title="Move up"
                        style={btnTiny}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => onNudge(s, 1)}
                        disabled={i === sorted.length - 1}
                        title="Move down"
                        style={btnTiny}
                      >
                        ↓
                      </button>
                    </div>
                  </Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => onEdit(s)}
                      style={{
                        color: CREAM,
                        textDecoration: "underline",
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: "inherit",
                      }}
                    >
                      {s.name}
                    </button>
                  </Td>
                  <Td>
                    <code style={{ color: FADED, fontSize: "1rem" }}>{s.slug}</code>
                  </Td>
                  {BREADS.map((b) => {
                    const v = s.sandwich_variants.find(
                      (x) => x.bread_slug === b.slug,
                    );
                    return (
                      <Td key={b.slug} align="right">
                        {v ? (
                          <span
                            style={{
                              color: v.is_available ? CREAM : FADED,
                              textDecoration: v.is_available
                                ? "none"
                                : "line-through",
                            }}
                          >
                            ₹{v.price_inr}
                          </span>
                        ) : (
                          <span style={{ color: FADED }}>—</span>
                        )}
                      </Td>
                    );
                  })}
                  <Td>
                    <span
                      className="uppercase"
                      style={{
                        fontSize: "0.875rem",
                        letterSpacing: "0.18em",
                        color: s.is_available ? CREAM : "#EF4444",
                        border: `1px solid ${s.is_available ? CREAM : "#EF4444"}`,
                        padding: "0.15rem 0.5rem",
                      }}
                    >
                      {s.is_available ? "Available" : "Off"}
                    </span>
                  </Td>
                  <Td align="right">
                    <button
                      type="button"
                      onClick={() => onEdit(s)}
                      style={btnGhostSmall}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(s)}
                      style={{
                        ...btnGhostSmall,
                        color: "#EF4444",
                        borderColor: "#EF4444",
                        marginLeft: 6,
                      }}
                    >
                      Delete
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EditorModal({
  state,
  onChange,
  onCancel,
  onSave,
  saving,
}: {
  state: EditorState;
  onChange: (s: EditorState) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const patch = (p: Partial<EditorState>) => onChange({ ...state, ...p });
  const setPrice = (slug: string, v: string) =>
    onChange({ ...state, prices: { ...state.prices, [slug]: v } });
  const setVariantAvail = (slug: string, v: boolean) =>
    onChange({
      ...state,
      variantAvail: { ...state.variantAvail, [slug]: v },
    });

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "3rem 1rem",
        zIndex: 50,
        overflowY: "auto",
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1D1D1F",
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: "1.5rem",
          maxWidth: 640,
          width: "100%",
          color: CREAM,
          fontFamily: "var(--font-body)",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "1.25rem",
            margin: "0 0 1rem 0",
            letterSpacing: "0.02em",
          }}
        >
          {state.id ? "Edit sandwich" : "New sandwich"}
        </h2>

        <Field label="Name">
          <input
            type="text"
            value={state.name}
            onChange={(e) => patch({ name: e.target.value })}
            style={input}
          />
        </Field>
        <Field label="Slug (optional — derived from name)">
          <input
            type="text"
            value={state.slug}
            onChange={(e) => patch({ slug: e.target.value })}
            placeholder="auto"
            style={input}
          />
        </Field>
        <Field label="Category">
          <div style={{ display: "flex", gap: "0.75rem" }}>
            {(["veg", "nonveg"] as const).map((c) => (
              <label
                key={c}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <input
                  type="radio"
                  name="category"
                  checked={state.category === c}
                  onChange={() => patch({ category: c })}
                />
                {c === "veg" ? "Veg" : "Non-veg"}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Description (optional)">
          <textarea
            value={state.description}
            onChange={(e) => patch({ description: e.target.value })}
            rows={2}
            style={{ ...input, resize: "vertical" }}
          />
        </Field>
        <Field label="Image URL (optional)">
          <input
            type="text"
            value={state.image_url}
            onChange={(e) => patch({ image_url: e.target.value })}
            style={input}
          />
        </Field>
        <Field label="Sort order">
          <input
            type="number"
            value={state.sort_order}
            onChange={(e) => patch({ sort_order: Number(e.target.value) || 0 })}
            style={{ ...input, width: 120 }}
          />
        </Field>

        <fieldset
          style={{
            border: `1px solid ${BORDER}`,
            padding: "0.75rem 1rem",
            margin: "1rem 0",
            borderRadius: 8,
          }}
        >
          <legend
            className="uppercase"
            style={{ fontSize: "0.75rem", letterSpacing: "0.2em", color: FADED }}
          >
            Prices per bread — blank = not offered
          </legend>
          {BREADS.map((b) => (
            <div
              key={b.slug}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                margin: "0.5rem 0",
              }}
            >
              <label style={{ width: 120 }}>{b.label}</label>
              <span style={{ color: FADED }}>₹</span>
              <input
                type="number"
                value={state.prices[b.slug] ?? ""}
                onChange={(e) => setPrice(b.slug, e.target.value)}
                placeholder="—"
                style={{ ...input, width: 120 }}
              />
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: FADED,
                }}
              >
                <input
                  type="checkbox"
                  checked={state.variantAvail[b.slug] ?? true}
                  onChange={(e) => setVariantAvail(b.slug, e.target.checked)}
                  disabled={!state.prices[b.slug]}
                />
                available
              </label>
            </div>
          ))}
        </fieldset>

        <Field label="">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={state.is_available}
              onChange={(e) => patch({ is_available: e.target.checked })}
            />
            Sandwich is available (uncheck to hide temporarily)
          </label>
        </Field>

        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            justifyContent: "flex-end",
            marginTop: "1.25rem",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={btnGhost}
            className="uppercase"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !state.name.trim()}
            style={btnPrimary}
            className="uppercase"
          >
            {saving ? "Saving…" : state.id ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────

const btnPrimary: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.25em",
  color: "#1D1D1F",
  background: CREAM,
  border: `1px solid ${CREAM}`,
  padding: "0.45rem 0.9rem",
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.25em",
  color: CREAM,
  border: `1px solid ${CREAM}`,
  padding: "0.45rem 0.9rem",
  background: "transparent",
  cursor: "pointer",
};

const btnGhostSmall: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.75rem",
  letterSpacing: "0.2em",
  color: CREAM,
  border: `1px solid ${BORDER}`,
  padding: "0.3rem 0.6rem",
  background: "transparent",
  cursor: "pointer",
  textTransform: "uppercase",
};

const btnTiny: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.9rem",
  color: CREAM,
  border: `1px solid ${BORDER}`,
  padding: "0.1rem 0.4rem",
  background: "transparent",
  cursor: "pointer",
  minWidth: 26,
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "0.45rem 0.6rem",
  background: "transparent",
  border: `1px solid ${BORDER}`,
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
  borderRadius: 6,
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", margin: "0.75rem 0" }}>
      {label ? (
        <div
          className="uppercase"
          style={{
            fontSize: "0.75rem",
            letterSpacing: "0.2em",
            color: FADED,
            marginBottom: "0.35rem",
          }}
        >
          {label}
        </div>
      ) : null}
      {children}
    </label>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className="uppercase"
      style={{
        textAlign: align,
        padding: "0.6rem 0.75rem",
        fontSize: "0.875rem",
        letterSpacing: "0.22em",
        color: FADED,
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: "0.7rem 0.75rem",
        fontSize: "1rem",
      }}
    >
      {children}
    </td>
  );
}

function ErrorBox({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className="mb-4 p-3"
      style={{
        border: "1px solid #EF4444",
        color: "#EF4444",
        fontFamily: "var(--font-body)",
        fontSize: "1rem",
        marginBottom: "1rem",
      }}
    >
      {message}{" "}
      <button
        type="button"
        onClick={onDismiss}
        style={{ marginLeft: 8, color: CREAM, textDecoration: "underline" }}
      >
        Dismiss
      </button>
    </div>
  );
}
