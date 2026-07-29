"use client";

// Generic CRUD editor for the Phase-C content tables. One component drives
// product_stat_tiles, product_app_test_reports, behind_milestones,
// behind_stats and process_steps — they all share the same shape:
//   - a natural-key column (tile_key / report_key / step_key / …)
//   - one or more value columns (value, label, metric, body, …)
//   - sort_order (Up/Down)
//   - is_visible toggle
// The caller passes a `spec` describing the columns; we render an editable
// row per record + an "Add" footer. All mutations POST /api/admin/content
// with action: create | update | delete | reorder, gated by requirePin().
//
// Generic catch: keep the JSX flat (no fancy table) so the existing
// admin "code-y" aesthetic carries through.

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";

import { adminFetch, AdminFetchError, adminAuthHeaders } from "@/lib/admin-client";

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.18)";

export type ContentTable =
  | "content_strings"
  | "product_stat_tiles"
  | "product_app_test_reports"
  | "behind_milestones"
  | "behind_stats"
  | "process_steps";

export type FieldSpec = {
  key: string;
  label: string;
  // 'short' is a small input, 'long' is a textarea, 'image' is an optional
  // photo upload (reuses the product /upload-image route) that stores a
  // public URL string in the field.
  kind: "short" | "long" | "image";
  // Optional hint shown under the field on the create row.
  hint?: string;
  // If true, surface a soft warning when the value looks like a macro
  // (e.g. "22g", "58.6 cal") — for nutrition-compliance gating.
  warnMacros?: boolean;
  required?: boolean;
};

export type TableSpec = {
  table: ContentTable;
  productScoped: boolean;
  // The natural-key column (tile_key / report_key / step_key / etc).
  naturalKey: string;
  // Columns shown in each row, in render order.
  fields: FieldSpec[];
};

export type ContentRow = Record<string, unknown> & {
  id: string;
  sort_order: number;
  is_visible: boolean;
  locale: string;
};

function looksLikeMacro(s: string): boolean {
  return /\b\d+(\.\d+)?\s*(g|gram|grams|kcal|cal|mg|kj)\b/i.test(s);
}

export function ContentTableEditor({
  spec,
  productId,
  locale,
  requirePin,
  title,
  subtitle,
}: {
  spec: TableSpec;
  productId?: string;
  locale: string;
  requirePin: () => Promise<string | null>;
  title: string;
  subtitle?: string;
}) {
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Per-row draft so edits feel local until Save is pressed.
  const [drafts, setDrafts] = useState<Record<string, Partial<ContentRow>>>({});
  // New-row form state.
  const blankNew = useCallback(() => {
    const o: Record<string, string> = {};
    for (const f of spec.fields) o[f.key] = "";
    o[spec.naturalKey] = "";
    return o;
  }, [spec]);
  const [newRow, setNewRow] = useState<Record<string, string>>(blankNew);

  const queryString = useCallback(() => {
    const p = new URLSearchParams();
    p.set("table", spec.table);
    p.set("locale", locale);
    if (spec.productScoped && productId) p.set("product_id", productId);
    return p.toString();
  }, [spec, productId, locale]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await adminFetch<{ rows: ContentRow[] }>(
        `/api/admin/content?${queryString()}`,
      );
      const list = res.rows ?? [];
      setRows(list);
      setDrafts({});
    } catch (e) {
      setLoadErr(
        e instanceof AdminFetchError ? e.message : "Failed to load",
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

  async function saveRow(id: string) {
    const patch = drafts[id];
    if (!patch || Object.keys(patch).length === 0) return;
    const ok = await withPin(async (grant) => {
      await adminFetch(`/api/admin/content`, {
        method: "POST",
        body: JSON.stringify({
          table: spec.table,
          action: "update",
          id,
          patch,
        }),
        headers: { "x-pin-grant": grant },
      });
    });
    if (ok) await load();
  }

  async function toggleVisible(row: ContentRow) {
    const ok = await withPin(async (grant) => {
      await adminFetch(`/api/admin/content`, {
        method: "POST",
        body: JSON.stringify({
          table: spec.table,
          action: "update",
          id: row.id,
          patch: { is_visible: !row.is_visible },
        }),
        headers: { "x-pin-grant": grant },
      });
    });
    if (ok) await load();
  }

  async function deleteRow(row: ContentRow) {
    const label = String(row[spec.naturalKey] ?? row.id);
    if (!window.confirm(`Delete ${spec.table} row "${label}"?`)) return;
    const ok = await withPin(async (grant) => {
      await adminFetch(`/api/admin/content`, {
        method: "POST",
        body: JSON.stringify({ table: spec.table, action: "delete", id: row.id }),
        headers: { "x-pin-grant": grant },
      });
    });
    if (ok) await load();
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const reordered = [...rows];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    setRows(reordered);
    const ok = await withPin(async (grant) => {
      await adminFetch(`/api/admin/content`, {
        method: "POST",
        body: JSON.stringify({
          table: spec.table,
          action: "reorder",
          orderedIds: reordered.map((r) => r.id),
        }),
        headers: { "x-pin-grant": grant },
      });
    });
    await load();
    if (!ok) return;
  }

  async function add() {
    // Trim everything; require natural key + every "required" field.
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(newRow)) {
      const tv = (v ?? "").trim();
      if (tv.length > 0) cleaned[k] = tv;
    }
    const missingKey = !cleaned[spec.naturalKey];
    const missingReq = spec.fields
      .filter((f) => f.required)
      .find((f) => !cleaned[f.key]);
    if (missingKey) {
      setErr(`${spec.naturalKey} is required`);
      return;
    }
    if (missingReq) {
      setErr(`${missingReq.label} is required`);
      return;
    }
    const payload: Record<string, unknown> = {
      table: spec.table,
      action: "create",
      locale,
      ...cleaned,
    };
    if (spec.productScoped && productId) payload.product_id = productId;
    const ok = await withPin(async (grant) => {
      await adminFetch(`/api/admin/content`, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "x-pin-grant": grant },
      });
    });
    if (ok) {
      setNewRow(blankNew());
      await load();
    }
  }

  function setDraftField(id: string, field: string, value: string) {
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? {}), [field]: value } }));
  }

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
      </div>
      {subtitle ? (
        <p
          className="mb-4"
          style={{
            color: FADED,
            fontFamily: "var(--font-body)",
            fontSize: "0.78rem",
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
          {rows.length === 0 ? (
            <p
              style={{
                color: FADED,
                fontFamily: "var(--font-body)",
                fontSize: "0.9rem",
                marginBottom: "1rem",
              }}
            >
              No rows yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-3 mb-6">
              {rows.map((r, i) => {
                const draft = drafts[r.id] ?? {};
                const changed = Object.keys(draft).length > 0;
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
                        <LabelCell label={spec.naturalKey}>
                          <code style={codeStyle}>
                            {String(r[spec.naturalKey] ?? "")}
                          </code>
                        </LabelCell>
                        {spec.fields.map((f) => {
                          const current =
                            (draft[f.key] as string | undefined) ??
                            (r[f.key] as string | null | undefined) ??
                            "";
                          const showWarn =
                            f.warnMacros && looksLikeMacro(String(current));
                          return (
                            <LabelCell key={f.key} label={f.label}>
                              {f.kind === "image" ? (
                                <ImageUpload
                                  value={String(current)}
                                  onChange={(url) =>
                                    setDraftField(r.id, f.key, url)
                                  }
                                  disabled={busy}
                                />
                              ) : f.kind === "long" ? (
                                <textarea
                                  value={current as string}
                                  onChange={(e) =>
                                    setDraftField(r.id, f.key, e.target.value)
                                  }
                                  rows={3}
                                  className="w-full px-3 py-2"
                                  style={fieldStyle}
                                />
                              ) : (
                                <input
                                  value={current as string}
                                  onChange={(e) =>
                                    setDraftField(r.id, f.key, e.target.value)
                                  }
                                  className="w-full px-3 py-2"
                                  style={fieldStyle}
                                />
                              )}
                              {showWarn ? (
                                <p style={warnStyle}>
                                  ⚠ Looks like a specific nutrition figure —
                                  hold back until lab-verified.
                                </p>
                              ) : null}
                            </LabelCell>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-3 justify-end flex-wrap">
                      <span
                        style={{
                          color: FADED,
                          fontFamily: "var(--font-body)",
                          fontSize: "0.72rem",
                          letterSpacing: "0.1em",
                        }}
                      >
                        sort {r.sort_order} · {locale}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleVisible(r)}
                        disabled={busy}
                        className="uppercase"
                        style={pillStyle(
                          r.is_visible ? GOLD : "#9ca3af",
                          busy,
                        )}
                      >
                        {r.is_visible ? "Visible" : "Hidden"}
                      </button>
                      {changed ? (
                        <button
                          type="button"
                          onClick={() => saveRow(r.id)}
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
                fontSize: "0.7rem",
                letterSpacing: "0.25em",
                color: GOLD,
                marginBottom: "0.5rem",
              }}
            >
              Add row
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <LabelCell label={`${spec.naturalKey} *`}>
                <input
                  value={newRow[spec.naturalKey] ?? ""}
                  onChange={(e) =>
                    setNewRow((s) => ({ ...s, [spec.naturalKey]: e.target.value }))
                  }
                  placeholder="lowercase-identifier"
                  className="w-full px-3 py-2"
                  style={fieldStyle}
                />
              </LabelCell>
              {spec.fields.map((f) => {
                const v = newRow[f.key] ?? "";
                const showWarn = f.warnMacros && looksLikeMacro(v);
                return (
                  <LabelCell
                    key={f.key}
                    label={`${f.label}${f.required ? " *" : ""}`}
                  >
                    {f.kind === "image" ? (
                      <ImageUpload
                        value={v}
                        onChange={(url) =>
                          setNewRow((s) => ({ ...s, [f.key]: url }))
                        }
                        disabled={busy}
                      />
                    ) : f.kind === "long" ? (
                      <textarea
                        value={v}
                        onChange={(e) =>
                          setNewRow((s) => ({ ...s, [f.key]: e.target.value }))
                        }
                        rows={3}
                        className="w-full px-3 py-2"
                        style={fieldStyle}
                      />
                    ) : (
                      <input
                        value={v}
                        onChange={(e) =>
                          setNewRow((s) => ({ ...s, [f.key]: e.target.value }))
                        }
                        className="w-full px-3 py-2"
                        style={fieldStyle}
                      />
                    )}
                    {f.hint ? <p style={hintStyle}>{f.hint}</p> : null}
                    {showWarn ? (
                      <p style={warnStyle}>
                        ⚠ Looks like a specific nutrition figure — hold back
                        until lab-verified.
                      </p>
                    ) : null}
                  </LabelCell>
                );
              })}
            </div>
            <div className="flex justify-end mt-3">
              <button
                type="button"
                onClick={() => void add()}
                disabled={busy}
                className="uppercase"
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "0.7rem",
                  letterSpacing: "0.25em",
                  color: GOLD,
                  border: `1px solid ${GOLD}`,
                  padding: "0.45rem 0.9rem",
                  background: "transparent",
                  opacity: busy ? 0.5 : 1,
                }}
              >
                + Add
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

// Optional photo upload for an 'image' field. Reuses the admin-gated
// product /upload-image route with a `process-steps/` prefix (same bucket,
// organised folder). Stores the returned public URL in the field; "Clear"
// resets it to "" which the API persists as NULL (text-only step).
function ImageUpload({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uErr, setUErr] = useState<string | null>(null);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setUErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("prefix", "process-steps");
      // Raw fetch (not adminFetch) so the browser sets the multipart
      // boundary; still attach the admin bearer via adminAuthHeaders.
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
        throw new Error(json.error || "Upload failed");
      }
      onChange(json.url);
    } catch (err) {
      setUErr(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const controlDisabled = disabled || busy;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value}
          alt=""
          style={{
            width: 46,
            height: 46,
            objectFit: "cover",
            border: `1px solid ${BORDER}`,
            flexShrink: 0,
          }}
        />
      ) : (
        <span style={{ ...hintStyle, marginTop: 0 }}>No photo</span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={pick}
        disabled={controlDisabled}
        style={{ display: "none" }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={controlDisabled}
        className="uppercase"
        style={pillStyle(GOLD, controlDisabled)}
      >
        {busy ? "Uploading…" : value ? "Replace" : "Upload"}
      </button>
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          disabled={controlDisabled}
          className="uppercase"
          style={pillStyle("#9ca3af", controlDisabled)}
        >
          Clear
        </button>
      ) : null}
      {uErr ? (
        <p style={{ ...warnStyle, color: "#fecaca", width: "100%" }}>{uErr}</p>
      ) : null}
    </div>
  );
}

function LabelCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className="uppercase"
        style={{
          color: FADED,
          fontFamily: "var(--font-body)",
          fontSize: "0.66rem",
          letterSpacing: "0.22em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const fieldStyle: React.CSSProperties = {
  border: `1px solid ${BORDER}`,
  background: "transparent",
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: "0.9rem",
};

const codeStyle: React.CSSProperties = {
  color: GOLD,
  fontFamily: "var(--font-body)",
  fontSize: "0.85rem",
  letterSpacing: "0.06em",
};

const hintStyle: React.CSSProperties = {
  color: FADED,
  fontFamily: "var(--font-body)",
  fontSize: "0.7rem",
  marginTop: "0.2rem",
};

const warnStyle: React.CSSProperties = {
  color: "#fbbf24",
  fontFamily: "var(--font-body)",
  fontSize: "0.7rem",
  marginTop: "0.2rem",
};

function arrowStyle(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-body)",
    fontSize: "0.65rem",
    lineHeight: 1.1,
    color: disabled ? "rgba(192,200,206,0.25)" : FADED,
    background: "transparent",
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    padding: "0.15rem 0.4rem",
  };
}

function pillStyle(color: string, busy: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-body)",
    fontSize: "0.62rem",
    letterSpacing: "0.25em",
    color,
    border: `1px solid ${color}`,
    padding: "0.3rem 0.65rem",
    background: "transparent",
    opacity: busy ? 0.5 : 1,
  };
}

// Pre-built table specs for the 5 generic content tables.
export const STAT_TILES_SPEC: TableSpec = {
  table: "product_stat_tiles",
  productScoped: true,
  naturalKey: "tile_key",
  fields: [
    { key: "value", label: "Value", kind: "short", required: true, warnMacros: true },
    { key: "label", label: "Label", kind: "short", required: true },
  ],
};

export const APP_REPORTS_SPEC: TableSpec = {
  table: "product_app_test_reports",
  productScoped: true,
  naturalKey: "report_key",
  fields: [
    { key: "metric", label: "Metric", kind: "short", required: true },
    { key: "value", label: "Value", kind: "short", required: true, warnMacros: true },
    { key: "note", label: "Note (optional)", kind: "short" },
  ],
};

export const BEHIND_MILESTONES_SPEC: TableSpec = {
  table: "behind_milestones",
  productScoped: false,
  naturalKey: "milestone_key",
  fields: [
    { key: "marker", label: "Marker (e.g. month/year)", kind: "short", required: true },
    { key: "label", label: "Label", kind: "short", required: true },
  ],
};

export const BEHIND_STATS_SPEC: TableSpec = {
  table: "behind_stats",
  productScoped: false,
  naturalKey: "stat_key",
  fields: [
    { key: "value", label: "Value", kind: "short", required: true },
    { key: "label", label: "Label", kind: "short", required: true },
  ],
};

export const PROCESS_STEPS_SPEC: TableSpec = {
  table: "process_steps",
  productScoped: false,
  naturalKey: "step_key",
  fields: [
    { key: "step_num", label: "Step number/marker", kind: "short", required: true },
    { key: "title", label: "Title", kind: "short", required: true },
    { key: "body", label: "Body", kind: "long", required: true },
    { key: "image_url", label: "Photo (optional)", kind: "image" },
  ],
};
