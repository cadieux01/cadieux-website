"use client";

// Shared chrome for the two kitchen reference-data screens
// (/admin/vendors and /admin/raw-materials).
//
// Exists only because those two pages are the same table-plus-modal shape and
// would otherwise carry ~150 identical lines each. It holds no behaviour and
// no data access — just the palette, a labelled input, and the status pill.
// Anything screen-specific stays in the screen.

import type { CSSProperties, ReactNode } from "react";

export const CREAM = "#FBF3D4";
export const CREAM_SOFT = "rgba(251,243,212,0.85)";
export const FADED = "rgba(251,243,212,0.6)";
export const BORDER = "rgba(251,243,212,0.18)";
export const GOLD = "#C8A951";
export const DANGER = "#EF4444";
export const DANGER_SOFT = "#FCA5A5";

export const primaryBtn: CSSProperties = {
  background: "transparent",
  border: `1px solid ${GOLD}`,
  color: CREAM,
  padding: "10px 18px",
  fontSize: 11,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  cursor: "pointer",
};

export const ghostBtn: CSSProperties = {
  ...primaryBtn,
  borderColor: BORDER,
  color: FADED,
};

export const tabBtn: CSSProperties = {
  background: "transparent",
  border: `1px solid ${BORDER}`,
  padding: "8px 16px",
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  cursor: "pointer",
};

export const linkBtn: CSSProperties = {
  background: "none",
  border: "none",
  color: GOLD,
  fontSize: 11,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  cursor: "pointer",
  padding: 0,
};

export const th: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: `1px solid ${BORDER}`,
  color: FADED,
  fontSize: 10,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  fontWeight: 400,
};

export const td: CSSProperties = {
  padding: "12px",
  borderBottom: `1px solid ${BORDER}`,
  color: CREAM_SOFT,
  fontSize: 13,
  verticalAlign: "top",
};

export const fieldLabel: CSSProperties = {
  display: "block",
  color: FADED,
  fontSize: 10,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  marginBottom: 6,
};

export const input: CSSProperties = {
  width: "100%",
  background: "rgba(0,0,0,0.25)",
  border: `1px solid ${BORDER}`,
  color: CREAM,
  padding: "10px 12px",
  fontSize: 13,
  fontFamily: "inherit",
};

export const errorBox: CSSProperties = {
  border: "1px solid rgba(239,68,68,0.5)",
  color: DANGER_SOFT,
  padding: "10px 12px",
  fontSize: 12,
  marginBottom: 16,
  lineHeight: 1.6,
};

export const hintText: CSSProperties = {
  color: FADED,
  fontSize: 11,
  lineHeight: 1.6,
  marginTop: 6,
};

export const modalWrap: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.7)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "60px 20px",
  overflowY: "auto",
  zIndex: 50,
};

export const modalCard: CSSProperties = {
  background: "#0B2E1C",
  border: `1px solid ${BORDER}`,
  padding: 28,
  width: "100%",
  maxWidth: 560,
};

export const modalTitle: CSSProperties = {
  color: CREAM,
  fontSize: 14,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  marginBottom: 22,
};

/**
 * A labelled text input or textarea.
 *
 * `disabled` carries a `hint` with it on purpose. The one field in these
 * screens that ever disables is the unit on a consumed material, and a field
 * that greys out without saying why is the failure this screen is meant to
 * avoid — so the component makes the explanation hard to forget rather than
 * optional.
 */
export function Field({
  label,
  value,
  onChange,
  required,
  maxLength,
  multiline,
  disabled,
  hint,
  placeholder,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  maxLength?: number;
  multiline?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
  placeholder?: string;
  type?: "text" | "number";
}) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={fieldLabel}>
        {label}
        {required ? " *" : ""}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          disabled={disabled}
          placeholder={placeholder}
          style={{ ...input, resize: "vertical", opacity: disabled ? 0.5 : 1 }}
        />
      ) : (
        <input
          value={value}
          type={type ?? "text"}
          inputMode={type === "number" ? "decimal" : undefined}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...input, opacity: disabled ? 0.5 : 1 }}
        />
      )}
      {hint ? <span style={hintText}>{hint}</span> : null}
    </label>
  );
}

export function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      style={{
        fontSize: 11,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: active ? CREAM_SOFT : FADED,
      }}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}
