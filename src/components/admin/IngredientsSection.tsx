"use client";

// Ingredients editor for the admin product detail page. Loads, adds,
// renames, reorders (up/down) and deletes rows in the product_ingredients
// table via /api/admin/products/[id]/ingredients. Every mutation is gated
// by the security PIN — requirePin() is owned by the parent page and passed
// down; the returned grant rides as the `x-pin-grant` header.

import { useCallback, useEffect, useState } from "react";

import { adminFetch, AdminFetchError } from "@/lib/admin-client";

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.18)";

type Ingredient = {
  id: string;
  product_id: string;
  name: string;
  sort_order: number;
};

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

  // Per-row draft names so renames are explicit (Save appears when changed).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await adminFetch<{ ingredients: Ingredient[] }>(
        `/api/admin/products/${productId}/ingredients`,
      );
      const list = res.ingredients ?? [];
      setRows(list);
      setDrafts(Object.fromEntries(list.map((r) => [r.id, r.name])));
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
    if (!name) {
      setErr("Enter an ingredient name");
      return;
    }
    const ok = await withPin(async (grant) => {
      await adminFetch(`/api/admin/products/${productId}/ingredients`, {
        method: "POST",
        body: JSON.stringify({ name }),
        headers: { "x-pin-grant": grant },
      });
    });
    if (ok) {
      setNewName("");
      await load();
    }
  }

  async function rename(id: string) {
    const name = (drafts[id] ?? "").trim();
    if (!name) {
      setErr("Name cannot be empty");
      return;
    }
    const ok = await withPin(async (grant) => {
      await adminFetch(
        `/api/admin/products/${productId}/ingredients/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name }),
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
        <p style={{ color: "#fecaca", fontFamily: "var(--font-body)" }}>
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
                fontSize: "0.9rem",
                marginBottom: "1rem",
              }}
            >
              No ingredients yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 mb-4">
              {rows.map((r, i) => {
                const changed = (drafts[r.id] ?? "") !== r.name;
                return (
                  <li
                    key={r.id}
                    className="flex items-center gap-2 p-2"
                    style={{
                      border: `1px solid ${BORDER}`,
                      background: "rgba(0,0,0,0.18)",
                    }}
                  >
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
                    <input
                      value={drafts[r.id] ?? ""}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [r.id]: e.target.value }))
                      }
                      className="flex-1 px-3 py-2"
                      style={{
                        border: `1px solid ${BORDER}`,
                        background: "transparent",
                        color: CREAM,
                        fontFamily: "var(--font-body)",
                        fontSize: "0.9rem",
                      }}
                    />
                    {changed ? (
                      <button
                        type="button"
                        onClick={() => rename(r.id)}
                        disabled={busy || !(drafts[r.id] ?? "").trim()}
                        className="uppercase"
                        style={{
                          fontFamily: "var(--font-body)",
                          fontSize: "0.62rem",
                          letterSpacing: "0.25em",
                          color: GOLD,
                          border: `1px solid ${GOLD}`,
                          padding: "0.3rem 0.65rem",
                          background: "transparent",
                          opacity: busy ? 0.5 : 1,
                        }}
                      >
                        Save
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => remove(r.id, r.name)}
                      disabled={busy}
                      className="uppercase"
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "0.62rem",
                        letterSpacing: "0.25em",
                        color: "#ef4444",
                        border: "1px solid #ef4444",
                        padding: "0.3rem 0.65rem",
                        background: "transparent",
                        opacity: busy ? 0.5 : 1,
                      }}
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addIngredient();
              }}
              placeholder="New ingredient name"
              className="flex-1 px-3 py-2"
              style={{
                border: `1px solid ${BORDER}`,
                background: "transparent",
                color: CREAM,
                fontFamily: "var(--font-body)",
                fontSize: "0.9rem",
              }}
            />
            <button
              type="button"
              onClick={() => void addIngredient()}
              disabled={busy || !newName.trim()}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.7rem",
                letterSpacing: "0.25em",
                color: GOLD,
                border: `1px solid ${GOLD}`,
                padding: "0.45rem 0.9rem",
                background: "transparent",
                opacity: busy || !newName.trim() ? 0.5 : 1,
              }}
            >
              + Add Ingredient
            </button>
          </div>
        </>
      )}

      {err ? (
        <p
          className="mt-3"
          style={{ color: "#fecaca", fontFamily: "var(--font-body)" }}
        >
          {err}
        </p>
      ) : null}
    </section>
  );
}

function arrowStyle(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-body)",
    fontSize: "0.6rem",
    lineHeight: 1.1,
    color: disabled ? "rgba(192,200,206,0.25)" : FADED,
    background: "transparent",
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    padding: "0 0.3rem",
  };
}
