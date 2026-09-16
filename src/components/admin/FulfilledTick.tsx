// Green tick shown beside a row's OLF/OLS number when the record is
// fulfilled. Rendered inline (baseline-aligned) so it reads as a
// suffix on the number, not a separate column.
//
// Colour is a mid-green — dark enough to keep contrast on the cream
// row text without becoming a UI green that shouts "success toast".
// The check character is a Unicode heavy-check-mark (U+2714) because
// it renders on every host font we ship (DM Sans, system fallback,
// print) without pulling in an icon library. `aria-label` carries the
// meaning; the glyph is aria-hidden.

const FULFILLED_GREEN = "#3F8F5A";

export function FulfilledTick({ title = "Fulfilled" }: { title?: string }) {
  return (
    <span
      aria-label={title}
      title={title}
      style={{
        color: FULFILLED_GREEN,
        marginLeft: 6,
        fontSize: "0.95em",
        fontWeight: 700,
        display: "inline-block",
        lineHeight: 1,
      }}
    >
      <span aria-hidden="true">✔</span>
    </span>
  );
}
