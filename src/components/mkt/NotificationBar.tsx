"use client";

// Inbox button + panel for /mkt. Reads logistics.notifications for the
// signed-in user through /api/mkt/notifications. Marks visible unread
// rows as read when the panel opens (one PATCH, not one per row).
//
// Polls every 60s so a notification written server-side (e.g. the
// task_notify_on_assign trigger from the migration) appears without a
// page refresh. No websocket here — the realtime surface is not worth
// the added authz surface for a Phase-1 inbox.

import { useCallback, useEffect, useRef, useState } from "react";
import { MKT } from "./theme";

type Notification = {
  id: string;
  type: string;
  title: string | null;
  message: string | null;
  related_id: string | null;
  is_read: boolean;
  created_at: string;
};

export function NotificationBar() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/mkt/notifications", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as {
        notifications: Notification[];
        unread: number;
      };
      setItems(j.notifications ?? []);
      setUnread(j.unread ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!panelRef.current) return;
      if (e.target instanceof Node && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Mark everything currently unread as read when the panel opens.
  // One PATCH, not one per row — a 50-row inbox mustn't fire 50
  // round-trips. The server respects RLS on each id individually.
  const openPanel = useCallback(async () => {
    setOpen(true);
    const unreadIds = items.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    try {
      const res = await fetch("/api/mkt/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: unreadIds }),
      });
      if (!res.ok) return;
      setItems((prev) =>
        prev.map((n) => (unreadIds.includes(n.id) ? { ...n, is_read: true } : n)),
      );
      setUnread(0);
    } catch {
      /* non-fatal; the next poll will refresh */
    }
  }, [items]);

  return (
    <div style={{ position: "relative" }} ref={panelRef}>
      <button
        type="button"
        onClick={open ? () => setOpen(false) : openPanel}
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        style={{
          position: "relative",
          padding: "0.3rem 0.6rem",
          border: `1px solid ${MKT.ash}`,
          borderRadius: 999,
          background: "#FFFFFF",
          color: MKT.ink,
          fontSize: "0.88rem",
          cursor: "pointer",
          transition: "background 140ms ease",
        }}
      >
        <span aria-hidden>🔔</span>
        {unread > 0 ? (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 18,
              height: 18,
              padding: "0 4px",
              borderRadius: 9,
              background: MKT.error,
              color: MKT.cream,
              fontSize: "0.7rem",
              lineHeight: "18px",
              textAlign: "center",
              fontWeight: 700,
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 0.5rem)",
            width: 340,
            maxHeight: "60vh",
            overflowY: "auto",
            background: "#FFFFFF",
            border: `1px solid ${MKT.ash}`,
            borderRadius: 10,
            boxShadow: MKT.cardShadow,
            padding: "0.5rem",
            zIndex: 20,
          }}
        >
          {error ? (
            <div
              style={{
                border: `1px solid ${MKT.error}`,
                background: MKT.errorBg,
                color: MKT.error,
                padding: "0.5rem 0.7rem",
                borderRadius: 6,
                fontSize: "0.85rem",
              }}
            >
              Failed to load: {error}
            </div>
          ) : items.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                color: MKT.mute,
                padding: "1.2rem 0.5rem",
                fontSize: "0.9rem",
              }}
            >
              Nothing new.
            </div>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "grid",
                gap: "0.3rem",
              }}
            >
              {items.map((n) => (
                <li
                  key={n.id}
                  style={{
                    padding: "0.5rem 0.6rem",
                    borderRadius: 6,
                    background: n.is_read ? "#FFFFFF" : MKT.hover,
                    border: `1px solid ${MKT.ash}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "0.4rem",
                      alignItems: "baseline",
                    }}
                  >
                    <strong
                      style={{
                        fontSize: "0.88rem",
                        color: MKT.ink,
                      }}
                    >
                      {n.title ?? n.type}
                    </strong>
                    <span style={{ color: MKT.mute, fontSize: "0.76rem" }}>
                      {formatRelative(n.created_at)}
                    </span>
                  </div>
                  {n.message ? (
                    <p style={{ margin: "0.2rem 0 0", color: MKT.ink, fontSize: "0.85rem" }}>
                      {n.message}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** "3h ago" / "yesterday" / "12 Nov". Intentionally local — the inbox
 *  is a short ephemeral list and a precise timestamp would compete
 *  for attention with the title. */
function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diffMin = Math.max(0, Math.floor((Date.now() - t) / 60_000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const hr = Math.floor(diffMin / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = new Date(t);
  const now = new Date();
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate() - 1
  ) {
    return "yesterday";
  }
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
