// The newest note on a row, shown inline in the Status column.
//
// WHY IT IS IN THE STATUS COLUMN AND NOT BEHIND THE NOTE ICON. The status
// word alone ("Pending confirmation") says what the system thinks; the note
// says what a human found out. "Did not lift the call" and "Customer asked to
// reschedule" are both still pending_confirmation, and the difference decides
// whether anyone should ring that number again this hour. Behind an icon it
// is information nobody opens.
//
// Body is truncated to the chip; the full text, the kind and the author are
// on the title attribute, and everything is always in the panel. Colour is
// per kind — call amber, note muted, edit teal — from NOTE_KIND_STYLE, so a
// kind cannot read one colour here and another in the panel.

import {
  NOTE_KIND_STYLE,
  truncateNoteBody,
  type NoteKind,
} from "@/lib/order-notes";
import { formatCallChipTime } from "@/lib/admin-call-updates";

export type LastNote = {
  body: string;
  author: string | null;
  created_at: string;
  kind: NoteKind;
};

/** Renders nothing when there is no note, so callers can pass an optional
 *  field straight in without a ternary at every site. */
export function LastNoteChip({ note }: { note?: LastNote | null }) {
  if (!note) return null;
  const style = NOTE_KIND_STYLE[note.kind];
  return (
    <div
      style={{
        marginTop: 6,
        display: "inline-block",
        padding: "3px 6px",
        border: `1px solid ${style.border}`,
        color: style.color,
        fontFamily: "var(--font-body)",
        fontSize: "0.75rem",
        lineHeight: 1.3,
        borderRadius: 3,
        maxWidth: 200,
      }}
      title={
        `${style.label}: ` +
        note.body +
        (note.author ? ` · ${note.author}` : "")
      }
    >
      {truncateNoteBody(note.body)}
      <span
        style={{
          display: "block",
          color: "rgba(251,243,212,0.55)",
          fontSize: "0.7rem",
          marginTop: 1,
        }}
      >
        {formatCallChipTime(note.created_at)}
      </span>
    </div>
  );
}
