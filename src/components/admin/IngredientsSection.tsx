"use client";

// Ingredients editor for the admin product detail page. Loads, adds,
// renames, reorders (up/down) and deletes rows in the product_ingredients
// table via /api/admin/products/[id]/ingredients. Every mutation is gated
// by the security PIN — requirePin() is owned by the parent page and passed
// down; the returned grant rides as the `x-pin-grant` header.

import { useCallback, useEffect, useState } from "react";

import { adminFetch, AdminFetchError } from "@/lib/admin-client";

const CREAM = "#FBF3D4";
const FADED = "rgba(251,243,212,0.6)";
const BORDER = "rgba(251,243,212,0.18)";

type Ingredient = {
  id: string;
  product_id: string;
  name: string;
  sort_order: number;
  role: string | null;
  is_visible: boolean;
};

type Draft = { name: string; role: string };

export function IngredientsSection({
  productId,
  requirePin,
}: {
  productId: string;
  requirePin: () => Promise<string | null>;
}) {
  const [rows, setRows] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Per-row drafts (name + role) so edits feel local until Save is pressed.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await adminFetch<{ ingredients: Ingredient[] }>(
        `/api/admin/products/${productId}/ingredients`,
      );
      const list = res.ingredients ?? [];
      setRows(list);
      setDrafts(
        Object.fromEntries(
          list.map((r) => [r.id, { name: r.name, role: r.role ?? "" }]),
        ),
      );
    } catch (e) {
      setLoadErr(
        e instanceof AdminFetchError ? e.message : "Failed to load ingredients",
      );
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Run a mutation behind the PIN gate. Resolves false if the operator
  // cancels the PIN prompt.
  const withPin = useCallback(
    async (fn: (grant: string) => Promise<void>): Promise<boolean> => {
      const grant = await requirePin();
      if (!grant) return false;
      setErr(null);
      setBusy(true);
      try {
        await fn(grant);
        return true;
      } catch (e) {
        setErr(e instanceof AdminFetchError ? e.message : "Request failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [requirePin],
  );

  async function addIngredient() {
    const name = newName.trim();
    const role = newRole.trim();
    if (!name) {
      setErr("Enter an ingredient name");
      return;
    }
    const ok = await withPin(async (grant) => {
      await adminFetch(`/api/admin/products/${productId}/ingredients`, {
        method: "POST",
        body: JSON.stringify({ name, role: role || null }),
        headers: { "x-pin-grant": grant },
      });
    });
    if (ok) {
      setNewName("");
      setNewRole("");
      await load();
    }
  }

  async function saveRow(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    const name = (draft.name ?? "").trim();
    const role = (draft.role ?? "").trim();
    if (!name) {
      setErr("Name cannot be empty");
      return;
    }
    const ok = await withPin(async (grant) => {
      await adminFetch(
        `/api/admin/products/${productId}/ingredients/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name, role: role.length === 0 ? null : role }),
          headers: { "x-pin-grant": grant },
        },
      );
    });
    if (ok) await load();
  }

  async function toggleVisible(row: Ingredient) {
    const ok = await withPin(async (grant) => {
      await adminFetch(
        `/api/admin/products/${productId}/ingredients/${row.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ is_visible: !row.is_visible }),
          headers: { "x-pin-grant": grant },
        },
      );
    });
    if (ok) await load();
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete ingredient "${name}"?`)) return;
    const ok = await withPin(async (grant) => {
      await adminFetch(
        `/api/admin/products/${productId}/ingredients/${id}`,
        {
          method: "DELETE",
          headers: { "x-pin-grant": grant },
        },
      );
    });
    if (ok) await load();
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const reordered = [...rows];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    // Optimistic local order so the arrows feel instant; reload confirms.
    setRows(reordered);
    const ok = await withPin(async (grant) => {
      await adminFetch(
        `/api/admin/products/${productId}/ingredients/reorder`,
        {
          method: "POST",
          body: JSON.stringify({ orderedIds: reordered.map((r) => r.id) }),
          headers: { "x-pin-grant": grant },
        },
      );
    });
    // Whether it succeeded or the PIN was cancelled, reload to the truth.
    await load();
    if (!ok) return;
  }

  return (
    <section className="mt-2">
      <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
        <h3
          className="uppercase"
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 300,
            fontSize: "1.4rem",
            letterSpacing: "0.2em",
            color: CREAM,
          }}
        >
          Ingredients
        </h3>
      </div>

      {loadErr ? (
        <p style={{ color: "#EF4444", fontFamily: "var(--font-body)" }}>
          {loadErr}
        </p>
      ) : loading ? (
        <p style={{ color: FADED, fontFamily: "var(--font-body)" }}>
          Loading ingredients…
        </p>
      ) : (
        <>
          {rows.length === 0 ? (
            <p
              style={{
                color: FADED,
                fontFamily: "var(--font-body)",
                fontSize: "1rem",
                marginBottom: "1rem",
              }}
            >
              No ingredients yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 mb-4">
              {rows.map((r, i) => {
                const draft = drafts[r.id] ?? { name: r.name, role: r.role ?? "" };
                const changed =
                  draft.name !== r.name || draft.role !== (r.role ?? "");
                return (
                  <li
                    key={r.id}
                    className="p-3"
                    style={{
                      border: `1px solid ${BORDER}`,
                      background: r.is_visible
                        ? "rgba(29,29,31,0.18)"
                        : "rgba(239,68,68,0.12)",
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex flex-col">
                        <button
                          type="button"
                          aria-label="Move up"
                          disabled={busy || i === 0}
                          onClick={() => move(i, -1)}
                          style={arrowStyle(busy || i === 0)}
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          aria-label="Move down"
                          disabled={busy || i === rows.length - 1}
                          onClick={() => move(i, 1)}
                          style={arrowStyle(busy || i === rows.length - 1)}
                        >
                          ▼
                        </button>
                      </div>
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1">
                          <span style={labelStyle}>Name</span>
                          <input
                            value={draft.name}
                            onChange={(e) =>
                              setDrafts((d) => ({
                                ...d,
                                [r.id]: { ...draft, name: e.target.value },
                              }))
                            }
                            className="px-3 py-2"
                            style={fieldStyle}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span style={labelStyle}>Role (optional)</span>
                          <input
                            value={draft.role}
                            onChange={(e) =>
                              setDrafts((d) => ({
                                ...d,
                                [r.id]: { ...draft, role: e.target.value },
                              }))
                            }
                            placeholder="e.g. flour, seed, leaven"
                            className="px-3 py-2"
                            style={fieldStyle}
                          />
                        </label>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3 justify-end flex-wrap">
                      <button
                        type="button"
                        onClick={() => toggleVisible(r)}
                        disabled={busy}
                        className="uppercase"
                        style={pillStyle(r.is_visible ? CREAM : "rgba(251,243,212,0.7)", busy)}
                      >
                        {r.is_visible ? "Visible" : "Hidden"}
                      </button>
                      {changed ? (
                        <button
                          type="button"
                          onClick={() => saveRow(r.id)}
                          disabled={busy || !draft.name.trim()}
                          className="uppercase"
                          style={pillStyle(CREAM, busy)}
                        >
                          Save
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => remove(r.id, r.name)}
                        disabled={busy}
                        className="uppercase"
                        style={pillStyle("#EF4444", busy)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div
            className="p-3"
            style={{
              border: `1px dashed ${BORDER}`,
              background: "rgba(29,29,31,0.12)",
            }}
          >
            <p
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.875rem",
                letterSpacing: "0.25em",
                color: CREAM,
                marginBottom: "0.5rem",
              }}
            >
              Add ingredient
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
              <label className="flex flex-col gap-1">
                <span style={labelStyle}>Name *</span>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addIngredient();
                  }}
                  className="px-3 py-2"
                  style={fieldStyle}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span style={labelStyle}>Role (optional)</span>
                <input
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  placeholder="e.g. flour, seed, leaven"
                  className="px-3 py-2"
                  style={fieldStyle}
                />
              </label>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void addIngredient()}
                disabled={busy || !newName.trim()}
                className="uppercase"
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "0.875rem",
                  letterSpacing: "0.25em",
                  color: CREAM,
                  border: `1px solid ${CREAM}`,
                  padding: "0.45rem 0.9rem",
                  background: "transparent",
                  opacity: busy || !newName.trim() ? 0.5 : 1,
                }}
              >
                + Add Ingredient
              </button>
            </div>
          </div>
        </>
      )}

      {err ? (
        <p
          className="mt-3"
          style={{ color: "#EF4444", fontFamily: "var(--font-body)" }}
        >
          {err}
        </p>
      ) : null}
    </section>
  );
}

const fieldStyle: React.CSSProperties = {
  border: `1px solid ${BORDER}`,
  background: "transparent",
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
};

const labelStyle: React.CSSProperties = {
  color: FADED,
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
};

function arrowStyle(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-body)",
    fontSize: "1rem",
    lineHeight: 1.1,
    color: disabled ? "rgba(251,243,212,0.25)" : FADED,
    background: "transparent",
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    padding: "0.15rem 0.4rem",
  };
}

function pillStyle(color: string, busy: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-body)",
    fontSize: "0.875rem",
    letterSpacing: "0.25em",
    color,
    border: `1px solid ${color}`,
    padding: "0.3rem 0.65rem",
    background: "transparent",
    opacity: busy ? 0.5 : 1,
  };
}
