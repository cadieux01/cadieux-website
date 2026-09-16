"use client";

// Shared modal for viewing + appending internal notes on ONE owner
// (either an order or a subscription).
//
// Data:
//   • Loads GET  /api/admin/notes?order_id=…  or  ?subscription_id=…
//   • Appends POST /api/admin/notes with { owner_id, kind, body, author }
//   • Append-only — no edit / no delete. Every submit stacks a new row.
//
// UI is deliberately compact: a small header, the "New note" area (kind
// dropdown + textarea), then the timeline newest-first. Notes and calls
// are visually distinct so the log reads as a mixed stream at a glance.

import { useCallback, useEffect, useState } from "react";

import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { ensureAdminFirstName } from "@/lib/admin-first-name";
import {
  NOTE_BODY_MAX,
  NOTE_KIND_STYLE,
  asNoteKind,
  type NoteKind,
  type OrderNoteRow,
} from "@/lib/order-notes";

import Select from "@/components/ui/Select";
import { BORDER, BORDER_SUBTLE, CREAM, INK, TEXT_MUTED } from "./theme";

type OwnerRef =
  | { kind: "order"; id: string; label: string }
  | { kind: "subscription"; id: string; label: string };

type Props = {
  owner: OwnerRef;
  /** Called with the fresh count after every successful append so the
   *  parent list can refresh the row icon without a full re-fetch. */
  onCountChange?: (next: number) => void;
  /** Called when the operator closes the modal (X, Esc, or backdrop). */
  onClose: () => void;
};

const KIND_OPTIONS: { value: NoteKind; label: string }[] = [
  { value: "note", label: "Internal note" },
  { value: "call", label: "Call update" },
];

/**
 * IST-formatted timestamp. Fixed to Asia/Kolkata so the log reads the
 * same for every operator regardless of their device timezone.
 */
function formatIST(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function NotePanel({ owner, onCountChange, onClose }: Props) {
  const [notes, setNotes] = useState<OrderNoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<NoteKind>("note");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const q =
        owner.kind === "order"
          ? `order_id=${encodeURIComponent(owner.id)}`
          : `subscription_id=${encodeURIComponent(owner.id)}`;
      const res = await adminFetch<{ notes: OrderNoteRow[] }>(
        `/api/admin/notes?${q}`,
      );
      setNotes(res.notes ?? []);
    } catch (e) {
      setLoadError(
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not load notes.",
      );
    } finally {
      setLoading(false);
    }
  }, [owner.kind, owner.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const author = ensureAdminFirstName();
      const payload: Record<string, unknown> = {
        kind,
        body: trimmed,
      };
      payload[owner.kind === "order" ? "order_id" : "subscription_id"] =
        owner.id;
      if (author) payload.author = author;
      const res = await adminFetch<{ note: OrderNoteRow }>("/api/admin/notes", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setNotes((curr) => [res.note, ...curr]);
      setBody("");
      onCountChange?.(notes.length + 1);
    } catch (e) {
      setSaveError(
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to save note.",
      );
    } finally {
      setSaving(false);
    }
  }

  const remaining = NOTE_BODY_MAX - body.trim().length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Notes for ${owner.label}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        background: "rgba(29,29,31,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: INK,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 24px 60px -12px rgba(29,29,31,0.7)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "1.1rem 1.4rem",
            borderBottom: `1px solid ${BORDER_SUBTLE}`,
          }}
        >
          <h2
            className="uppercase"
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 300,
              color: CREAM,
              fontSize: "1.05rem",
              letterSpacing: "0.14em",
              margin: 0,
            }}
          >
            Notes · {owner.label}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notes"
            style={{
              background: "transparent",
              border: "1px solid rgba(251,243,212,0.25)",
              color: CREAM,
              width: 30,
              height: 30,
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            padding: "1rem 1.4rem",
            borderBottom: `1px solid ${BORDER_SUBTLE}`,
            display: "flex",
            flexDirection: "column",
            gap: "0.6rem",
          }}
        >
          <div style={{ maxWidth: 200 }}>
            <Select
              value={kind}
              onChange={(v) => setKind(v as NoteKind)}
              ariaLabel="Note kind"
              options={KIND_OPTIONS}
            />
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, NOTE_BODY_MAX))}
            onKeyDown={(e) => {
              // ⌘/Ctrl-Enter submits — matches every other admin textarea.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={
              kind === "call"
                ? "Summarise the call in one line…"
                : "Anything the next operator should know…"
            }
            rows={3}
            style={{
              width: "100%",
              background: "transparent",
              border: "1px solid rgba(251,243,212,0.3)",
              color: CREAM,
              fontFamily: "var(--font-body)",
              fontSize: "1rem",
              padding: "0.55rem 0.7rem",
              outline: "none",
              resize: "vertical",
              minHeight: 72,
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                color: remaining < 0 ? "#EF4444" : TEXT_MUTED,
                fontFamily: "var(--font-body)",
                fontSize: "0.75rem",
                letterSpacing: "0.05em",
              }}
            >
              {remaining} left
            </span>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving || body.trim().length === 0}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.875rem",
                letterSpacing: "0.22em",
                color: CREAM,
                background: INK,
                border: `1px solid ${CREAM}`,
                padding: "0.5rem 1rem",
                cursor:
                  saving || body.trim().length === 0 ? "not-allowed" : "pointer",
                opacity: saving || body.trim().length === 0 ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : "Add"}
            </button>
          </div>
          {saveError ? (
            <p role="alert" style={{ color: "#EF4444", fontSize: "0.9rem", margin: 0 }}>
              {saveError}
            </p>
          ) : null}
        </div>

        <div
          style={{
            padding: "1rem 1.4rem",
            overflowY: "auto",
            flex: 1,
          }}
        >
          {loading ? (
            <p style={{ color: TEXT_MUTED, margin: 0 }}>Loading…</p>
          ) : loadError ? (
            <p style={{ color: "#EF4444", margin: 0 }}>{loadError}</p>
          ) : notes.length === 0 ? (
            <p style={{ color: TEXT_MUTED, margin: 0 }}>
              No notes yet. Add the first one above.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {notes.map((n) => (
                <li
                  key={n.id}
                  style={{
                    padding: "0.7rem 0",
                    borderBottom: `1px solid ${BORDER_SUBTLE}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      marginBottom: 4,
                    }}
                  >
                    <span
                      className="uppercase"
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.18em",
                        color: NOTE_KIND_STYLE[asNoteKind(n.kind)].color,
                        border: `1px solid ${
                          NOTE_KIND_STYLE[asNoteKind(n.kind)].border
                        }`,
                        padding: "1px 6px",
                        borderRadius: 3,
                      }}
                    >
                      {NOTE_KIND_STYLE[asNoteKind(n.kind)].label}
                    </span>
                    <span
                      style={{
                        color: TEXT_MUTED,
                        fontSize: "0.8rem",
                      }}
                    >
                      {formatIST(n.created_at)}
                      {n.author ? ` · ${n.author}` : ""}
                    </span>
                  </div>
                  <div
                    style={{
                      color: CREAM,
                      fontFamily: "var(--font-body)",
                      fontSize: "1rem",
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {n.body}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
