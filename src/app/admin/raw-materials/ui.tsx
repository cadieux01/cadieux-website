"use client";

// Presentation for /admin/raw-materials: the shared palette, the shared
// table/form styles, and the two pieces that carry the screen's one
// non-obvious rule — the THREE-state reorder badge and the materials table
// that renders it.
//
// WHY A SEPARATE MODULE AND NOT page.tsx: a Next.js App Router page file may
// export only `default` and a fixed set of route options. Any other named
// export fails the build with TS2344 ("not assignable to type 'never'"), so
// a component defined in page.tsx cannot be imported ANYWHERE — including by
// a harness that wants to render it without going through AdminShell's
// password gate. Moving them here is what makes the badge verifiable as
// rendered output instead of as an assertion about source.

import {
  classifyReorder,
  REORDER_LABEL,
  type ReorderState,
} from "@/lib/raw-materials";

export const CREAM = "#FBF3D4";
export const FADED = "rgba(251,243,212,0.6)";
export const BORDER = "rgba(251,243,212,0.18)";
export const DANGER = "#EF4444";
export const OK = "#4ADE80";
export const UNDECIDED = "#F59E0B";

export type MaterialRow = {
  material_id: string;
  code: string;
  name: string;
  unit: string;
  category: string | null;
  reorder_level: number | string | null;
  lead_time_days: number | null;
  vendor_id: string | null;
  is_active: boolean;
  current_qty: number | string | null;
  movement_count: number;
  last_movement_at: string | null;
  needs_reorder: boolean | null;
  vendor_name: string | null;
  vendor_is_active: boolean | null;
};

export function numberOrNull(value: number | string | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatQty(value: number | string | null): string {
  const n = numberOrNull(value);
  if (n === null) return "—";
  // Trim the view's three trailing decimals when they carry nothing.
  return String(Number(n.toFixed(3)));
}

// THE THREE STATES. `undecided` is not a styling afterthought: the view
// returns NULL for needs_reorder whenever reorder_level IS NULL, which means
// nothing was ever compared. Painting that the same as `ok` would assert
// "in stock" on the strength of a comparison that never happened, so it gets
// its own colour, a DASHED border, and a label that names the gap rather
// than a verdict.
export function ReorderBadge({ state }: { state: ReorderState }) {
  const palette: Record<
    ReorderState,
    { color: string; label: string; dashed: boolean }
  > = {
    below: { color: DANGER, label: "Reorder", dashed: false },
    ok: { color: OK, label: "OK", dashed: false },
    undecided: { color: UNDECIDED, label: "No reorder level", dashed: true },
  };
  const { color, label, dashed } = palette[state];
  return (
    <span
      title={REORDER_LABEL[state]}
      style={{
        display: "inline-block",
        color,
        border: `1px ${dashed ? "dashed" : "solid"} ${color}`,
        padding: "2px 8px",
        fontSize: "0.75rem",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export function MaterialTable({
  rows,
  emptyLabel,
  muted,
  onEdit,
  onToggleActive,
}: {
  rows: MaterialRow[];
  emptyLabel: string;
  muted?: boolean;
  onEdit: (row: MaterialRow) => void;
  onToggleActive: (row: MaterialRow, next: boolean) => void;
}) {
  if (rows.length === 0) {
    return emptyLabel ? (
      <p style={{ color: FADED, fontStyle: "italic" }}>{emptyLabel}</p>
    ) : null;
  }
  return (
    <div style={{ border: `1px solid ${BORDER}`, opacity: muted ? 0.7 : 1 }}>
      <table style={tableStyle}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={thStyle}>Code</th>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Unit</th>
            <th style={{ ...thStyle, textAlign: "right" }}>In stock</th>
            <th style={thStyle}>Reorder</th>
            <th style={thStyle}>Category</th>
            <th style={thStyle}>Vendor</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Lead</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const state = classifyReorder(row.needs_reorder);
            return (
              <tr
                key={row.material_id}
                style={{ borderTop: `1px solid ${BORDER}`, color: CREAM }}
              >
                <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>
                  {row.code}
                </td>
                <td style={tdStyle}>{row.name}</td>
                <td style={tdStyle}>{row.unit}</td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatQty(row.current_qty)}
                  {row.reorder_level !== null && (
                    <span style={{ color: FADED }}>
                      {" "}
                      / {formatQty(row.reorder_level)}
                    </span>
                  )}
                </td>
                <td style={tdStyle}>
                  <ReorderBadge state={state} />
                </td>
                <td style={tdStyle}>{row.category ?? "—"}</td>
                <td style={tdStyle}>
                  {row.vendor_name ?? "—"}
                  {row.vendor_name && row.vendor_is_active === false && (
                    <span style={{ color: UNDECIDED, fontSize: "0.75rem" }}>
                      {" "}
                      (inactive)
                    </span>
                  )}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {row.lead_time_days === null ? "—" : `${row.lead_time_days}d`}
                </td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => onEdit(row)}
                    style={rowBtnStyle}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleActive(row, !row.is_active)}
                    style={{
                      ...rowBtnStyle,
                      marginLeft: 6,
                      color: row.is_active ? DANGER : CREAM,
                    }}
                  >
                    {row.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
};

export const theadRowStyle: React.CSSProperties = {
  background: "rgba(251,243,212,0.05)",
  color: FADED,
  textAlign: "left",
  fontSize: "0.875rem",
  letterSpacing: "0.15em",
  textTransform: "uppercase",
};

export const thStyle: React.CSSProperties = { padding: "10px 12px" };
export const tdStyle: React.CSSProperties = { padding: "10px 12px" };

export const sectionHeadingStyle: React.CSSProperties = {
  color: FADED,
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  margin: "0 0 12px",
};

export const rowBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: CREAM,
  border: `1px solid ${BORDER}`,
  padding: "4px 10px",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  cursor: "pointer",
};

export const primaryBtnStyle: React.CSSProperties = {
  background: CREAM,
  color: "#1D1D1F",
  border: "none",
  padding: "8px 16px",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  cursor: "pointer",
};

export const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  marginBottom: 14,
  fontSize: "0.875rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: FADED,
};

export const inputStyle: React.CSSProperties = {
  background: "#1D1D1F",
  color: CREAM,
  border: `1px solid ${BORDER}`,
  padding: "10px 12px",
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
  letterSpacing: "0.02em",
  textTransform: "none",
};

export const hintStyle: React.CSSProperties = {
  color: FADED,
  fontSize: "0.75rem",
  letterSpacing: "0.02em",
  textTransform: "none",
  marginTop: 4,
};
