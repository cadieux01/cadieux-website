"use client";

// Editor for the `content_strings` table. Different from the generic
// ContentTableEditor because:
//   - the natural key is (key, locale, product_id) — upsert semantics
//   - there is no sort_order; ordering is alphabetical by key
//   - product_id may be NULL (global string) or the product slug
//
// Loads rows for a given locale + scope (global or per-product) and
// renders one row per key with Save + Hide/Show + Delete. The "Add"
// footer upserts on (key, locale, product_id).

import { useCallback, useEffect, useMemo, useState } from "react";

import { adminFetch, AdminFetchError } from "@/lib/admin-client";

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.18)";

type Row = {
  id: string;
  key: string;
  locale: string;
  product_id: string | null;
  value: string | null;
  is_visible: boolean;
  page_slug: string | null;
  note: string | null;
};

function looksLikeMacro(s: string): boolean {
  return /\b\d+(\.\d+)?\s*(g|gram|grams|kcal|cal|mg|kj)\b/i.test(s);
}

export function ContentStringsSection({
  locale,
  productId,
  requirePin,
  title,
  subtitle,
  keyPrefixFilter,
}: {
  locale: string;
  // "__global__" for global strings (product_id IS NULL), or a product slug
  productId: string;
  requirePin: () => Promise<string | null>;
  title: string;
  subtitle?: string;
  // Optional client-side filter: only show keys starting with this prefix
  keyPrefixFilter?: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newNote, setNewNote] = useState("");

  const queryString = useCallback(() => {
    const p = new URLSearchParams();
    p.set("table", "content_strings");
    p.set("locale", locale);
    p.set("product_id", productId);
    return p.toString();
  }, [locale, productId]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await adminFetch<{ rows: Row[] }>(
        `/api/admin/content?${queryString()}`,
      );
      const list = res.rows ?? [];
      setRows(list);
      setDrafts(Object.fromEntries(list.map((r) => [r.id, r.value ?? ""])));
    } catch (e) {
      setLoadErr(
        e instanceof AdminFetchError ? e.message : "Failed to load strings",
      );
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function saveRow(r: Row) {
    const v = drafts[r.id] ?? "";
    const ok = await withPin(async (grant) => {
      await adminFetch(`/api/admin/content`, {
        method: "POST",
        body: JSON.stringify({
          table: "content_strings",
          action: "update",
          id: r.id,
          patch: { value: v },
        }),
        headers: { "x-pin-grant": grant },
      });
    });
    if (ok) await load();
  }

  async function toggleVisible(r: Row) {
    const ok = await withPin(async (grant) => {
      await adminFetch(`/api/admin/content`, {
        method: "POST",
        body: JSON.stringify({
          table: "content_strings",
          action: "update",
          id: r.id,
          patch: { is_visible: !r.is_visible },
        }),
        headers: { "x-pin-grant": grant },
      });
    });
    if (ok) await load();
  }

  async function deleteRow(r: Row) {
    if (!window.confirm(`Delete string "${r.key}"?`)) return;
    const ok = await withPin(async (grant) => {
      await adminFetch(`/api/admin/content`, {
        method: "POST",
        body: JSON.stringify({
          table: "content_strings",
          action: "delete",
          id: r.id,
        }),
        headers: { "x-pin-grant": grant },
      });
    });
    if (ok) await load();
  }

  async function addRow() {
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key) {
      setErr("Key is required");
      return;
    }
    if (keyPrefixFilter && !key.startsWith(keyPrefixFilter)) {
      setErr(`Key must start with "${keyPrefixFilter}"`);
      return;
    }
    const ok = await withPin(async (grant) => {
      await adminFetch(`/api/admin/content`, {
        method: "POST",
        body: JSON.stringify({
          table: "content_strings",
          action: "upsert",
          key,
          locale,
          product_id: productId === "__global__" ? null : productId,
          value,
          is_visible: true,
          note: newNote.trim() || null,
        }),
        headers: { "x-pin-grant": grant },
      });
    });
    if (ok) {
      setNewKey("");
      setNewValue("");
      setNewNote("");
      await load();
    }
  }

  const filtered = useMemo(() => {
    let list = rows;
    if (keyPrefixFilter) list = list.filter((r) => r.key.startsWith(keyPrefixFilter));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.key.toLowerCase().includes(q) ||
          (r.value ?? "").toLowerCase().includes(q),
      );
    }
    // Stable sort by key
    return [...list].sort((a, b) => a.key.localeCompare(b.key));
  }, [rows, search, keyPrefixFilter]);

  return (
    <section className="mt-2">
      <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
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
          {title}
        </h3>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter…"
          className="px-3 py-1"
          style={{
            border: `1px solid ${BORDER}`,
            background: "transparent",
            color: CREAM,
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            width: "200px",
          }}
        />
      </div>
      {subtitle ? (
        <p
          className="mb-4"
          style={{
            color: FADED,
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
          }}
        >
          {subtitle}
        </p>
      ) : (
        <div className="mb-4" />
      )}

      {loadErr ? (
        <p style={{ color: "#fecaca", fontFamily: "var(--font-body)" }}>
          {loadErr}
        </p>
      ) : loading ? (
        <p style={{ color: FADED, fontFamily: "var(--font-body)" }}>Loading…</p>
      ) : (
        <>
          {filtered.length === 0 ? (
            <p
              style={{
                color: FADED,
                fontFamily: "var(--font-body)",
                fontSize: "1rem",
                marginBottom: "1rem",
              }}
            >
              No strings yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-3 mb-6">
              {filtered.map((r) => {
                const draft = drafts[r.id] ?? "";
                const changed = draft !== (r.value ?? "");
                const showWarn = looksLikeMacro(draft);
                return (
                  <li
                    key={r.id}
                    className="p-3"
                    style={{
                      border: `1px solid ${BORDER}`,
                      background: r.is_visible
                        ? "rgba(0,0,0,0.18)"
                        : "rgba(120,30,30,0.12)",
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
                      <code
                        style={{
                          color: GOLD,
                          fontFamily: "var(--font-body)",
                          fontSize: "1rem",
                          letterSpacing: "0.04em",
                          wordBreak: "break-all",
                        }}
                      >
                        {r.key}
                      </code>
                      <span
                        style={{
                          color: FADED,
                          fontFamily: "var(--font-body)",
                          fontSize: "0.875rem",
                          letterSpacing: "0.1em",
                        }}
                      >
                        {r.locale}
                        {r.product_id ? ` · ${r.product_id}` : " · global"}
                      </span>
                    </div>
                    <textarea
                      value={draft}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [r.id]: e.target.value }))
                      }
                      rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 80)))}
                      className="w-full px-3 py-2"
                      style={{
                        border: `1px solid ${BORDER}`,
                        background: "transparent",
                        color: CREAM,
                        fontFamily: "var(--font-body)",
                        fontSize: "1rem",
                      }}
                    />
                    {showWarn ? (
                      <p
                        style={{
                          color: "#fbbf24",
                          fontFamily: "var(--font-body)",
                          fontSize: "1rem",
                          marginTop: "0.3rem",
                        }}
                      >
                        ⚠ Looks like a specific nutrition figure — hold back
                        until lab-verified.
                      </p>
                    ) : null}
                    {r.note ? (
                      <p
                        style={{
                          color: FADED,
                          fontFamily: "var(--font-body)",
                          fontSize: "1rem",
                          marginTop: "0.3rem",
                          fontStyle: "italic",
                        }}
                      >
                        {r.note}
                      </p>
                    ) : null}
                    <div className="flex items-center gap-2 mt-3 justify-end flex-wrap">
                      <button
                        type="button"
                        onClick={() => toggleVisible(r)}
                        disabled={busy}
                        className="uppercase"
                        style={pillStyle(r.is_visible ? GOLD : "#9ca3af", busy)}
                      >
                        {r.is_visible ? "Visible" : "Hidden"}
                      </button>
                      {changed ? (
                        <button
                          type="button"
                          onClick={() => saveRow(r)}
                          disabled={busy}
                          className="uppercase"
                          style={pillStyle(GOLD, busy)}
                        >
                          Save
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => deleteRow(r)}
                        disabled={busy}
                        className="uppercase"
                        style={pillStyle("#ef4444", busy)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Add row */}
          <div
            className="p-3"
            style={{
              border: `1px dashed ${BORDER}`,
              background: "rgba(0,0,0,0.12)",
            }}
          >
            <p
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.875rem",
                letterSpacing: "0.25em",
                color: GOLD,
                marginBottom: "0.5rem",
              }}
            >
              Add or upsert string
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span style={labelStyle}>key *</span>
                <input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder={keyPrefixFilter ? `${keyPrefixFilter}<...>` : "namespace.key"}
                  className="w-full px-3 py-2"
                  style={fieldStyle}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span style={labelStyle}>note (optional)</span>
                <input
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  className="w-full px-3 py-2"
                  style={fieldStyle}
                />
              </label>
              <label className="flex flex-col gap-1 md:col-span-2">
                <span style={labelStyle}>value</span>
                <textarea
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2"
                  style={fieldStyle}
                />
                {looksLikeMacro(newValue) ? (
                  <p
                    style={{
                      color: "#fbbf24",
                      fontFamily: "var(--font-body)",
                      fontSize: "1rem",
                      marginTop: "0.2rem",
                    }}
                  >
                    ⚠ Looks like a specific nutrition figure — hold back until
                    lab-verified.
                  </p>
                ) : null}
              </label>
            </div>
            <div className="flex justify-end mt-3">
              <button
                type="button"
                onClick={() => void addRow()}
                disabled={busy || !newKey.trim()}
                className="uppercase"
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "0.875rem",
                  letterSpacing: "0.25em",
                  color: GOLD,
                  border: `1px solid ${GOLD}`,
                  padding: "0.45rem 0.9rem",
                  background: "transparent",
                  opacity: busy || !newKey.trim() ? 0.5 : 1,
                }}
              >
                + Add / upsert
              </button>
            </div>
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
