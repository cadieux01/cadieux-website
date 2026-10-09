"use client";

// Column picker shown between "Export CSV" and the download.
//
// Shared by the orders and subscriptions boards so one tick list cannot
// grow two different behaviours. Deliberately NOT used by the customers
// or audit-log exports — those were left alone; see the note on their
// own export handlers if that ever changes.
//
// The choice is remembered per board in localStorage, because the
// operator's columns are a standing preference ("I never want the UUID,
// I always want the phone"), not a per-download decision. Keys, not
// headers, are persisted — see CsvColumnSpec.
//
// Styling is self-contained rather than importing the boards' modal
// constants: those are page-local consts duplicated across admin pages
// already, and importing one page's styling into a shared component
// would make every future restyle a cross-page edit.

import { useCallback, useMemo, useState } from "react";

import {
  defaultColumnKeys,
  type CsvColumnSpec,
} from "@/lib/admin-csv";

/** Saved tick list. Versioned so a future change of column vocabulary
 *  can invalidate old selections instead of silently honouring keys that
 *  no longer mean anything. */
const STORE_VERSION = 1;

function storeKey(board: string): string {
  return `cadieux_csv_cols_v${STORE_VERSION}_${board}`;
}

function readSaved(board: string): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storeKey(board));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    // A corrupt entry must not take the export down with it.
    return null;
  }
}

function writeSaved(board: string, keys: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storeKey(board), JSON.stringify(keys));
  } catch {
    // Private mode / quota. The export still works, it just forgets.
  }
}

/**
 * The tick list to open with: the saved choice, intersected with the
 * columns that actually exist now. A saved key for a column that has
 * since been removed is dropped rather than carried; a NEW column the
 * operator has never seen falls back to its own defaultOn rather than to
 * off, so adding a column does not silently omit it from everyone's
 * exports.
 */
function seedChoice<T>(
  board: string,
  specs: readonly CsvColumnSpec<T>[],
): Set<string> {
  const saved = readSaved(board);
  if (!saved) return new Set(defaultColumnKeys(specs));
  const live = new Set(specs.map((s) => s.key));
  const savedLive = saved.filter((k) => live.has(k));
  const unseen = specs
    .filter((s) => !saved.includes(s.key) && s.defaultOn)
    .map((s) => s.key);
  return new Set([...savedLive, ...unseen]);
}

export function CsvColumnPicker<T>({
  board,
  title,
  specs,
  busy,
  scopeHint,
  onCancel,
  onConfirm,
}: {
  /** Stable board id used for the saved selection: "orders" | "subscriptions". */
  board: string;
  title: string;
  specs: readonly CsvColumnSpec<T>[];
  busy: boolean;
  /** What the file will cover, so the operator sees the scope BEFORE the
   *  download rather than only in the file afterwards. */
  scopeHint: string;
  onCancel: () => void;
  onConfirm: (chosen: Set<string>) => void;
}) {
  // Seeded ONCE, at mount, deliberately not in an effect keyed on
  // `specs`: callers build their spec list inline, so its identity
  // changes every render and an effect would re-seed — and therefore
  // undo — each tick the operator makes. This component is only mounted
  // when the operator clicks Export, which is exactly when the saved
  // choice should be re-read, so mount-time seeding loses nothing.
  const [chosen, setChosen] = useState<Set<string>>(() =>
    seedChoice(board, specs),
  );

  const toggle = useCallback((key: string) => {
    setChosen((curr) => {
      const next = new Set(curr);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const allOn = useMemo(
    () => specs.every((s) => chosen.has(s.key)),
    [specs, chosen],
  );

  const confirm = useCallback(() => {
    writeSaved(board, Array.from(chosen));
    onConfirm(chosen);
  }, [board, chosen, onConfirm]);

  return (
    <div style={backdrop} onClick={busy ? undefined : onCancel}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <h3 style={titleStyle}>{title}</h3>
          <p style={scopeStyle}>{scopeHint}</p>
        </div>

        <div style={scrollBody}>
          <button
            type="button"
            onClick={() =>
              setChosen(
                allOn ? new Set() : new Set(specs.map((s) => s.key)),
              )
            }
            style={{ ...chip, marginBottom: "0.9rem" }}
          >
            {allOn ? "Untick all" : "Tick all"}
          </button>

          <ul style={list}>
            {specs.map((s) => (
              <li key={s.key} style={listItem}>
                <label style={labelStyle}>
                  <input
                    type="checkbox"
                    checked={chosen.has(s.key)}
                    onChange={() => toggle(s.key)}
                    style={{ marginRight: "0.6rem" }}
                  />
                  <span>
                    {s.header}
                    {s.hint ? <span style={hintStyle}>{s.hint}</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div style={footer}>
          <span style={countStyle}>
            {chosen.size} of {specs.length} columns
          </span>
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              style={chip}
            >
              Back
            </button>
            <button
              type="button"
              onClick={confirm}
              // Zero columns would produce a header-less file. Refuse
              // rather than download something unopenable.
              disabled={busy || chosen.size === 0}
              style={{
                ...chip,
                background: "rgba(251,243,212,0.15)",
                borderColor: "rgba(251,243,212,0.6)",
                opacity: busy || chosen.size === 0 ? 0.5 : 1,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy ? "Preparing…" : "Download CSV"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(29,29,31,0.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
  padding: "1rem",
};

const card: React.CSSProperties = {
  width: "100%",
  maxWidth: 460,
  background: "rgb(29,29,31)",
  border: "1px solid rgba(251,243,212,0.4)",
  borderRadius: 6,
  display: "flex",
  flexDirection: "column",
  maxHeight: "min(90vh, calc(100dvh - 2rem))",
  minHeight: 0,
  overflow: "hidden",
};

const header: React.CSSProperties = {
  flexShrink: 0,
  padding: "1.1rem 1.4rem 0.9rem",
  borderBottom: "1px solid rgba(251,243,212,0.18)",
};

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: "1.05rem",
  color: "#FBF3D4",
  margin: 0,
  letterSpacing: "0.04em",
};

const scopeStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.9rem",
  color: "rgba(251,243,212,0.7)",
  margin: "0.4rem 0 0",
  lineHeight: 1.4,
};

const scrollBody: React.CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  padding: "1.1rem 1.4rem",
};

const list: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
};

const listItem: React.CSSProperties = {
  padding: "0.3rem 0",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
  color: "rgba(251,243,212,0.9)",
  cursor: "pointer",
  lineHeight: 1.4,
};

const hintStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.82rem",
  color: "rgba(251,243,212,0.55)",
};

const footer: React.CSSProperties = {
  flexShrink: 0,
  padding: "0.9rem 1.4rem",
  borderTop: "1px solid rgba(251,243,212,0.18)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.6rem",
};

const countStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.85rem",
  color: "rgba(251,243,212,0.6)",
};

const chip: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.9rem",
  letterSpacing: "0.04em",
  padding: "0.45rem 0.9rem",
  background: "transparent",
  border: "1px solid rgba(251,243,212,0.4)",
  borderRadius: 4,
  color: "#FBF3D4",
  cursor: "pointer",
};
