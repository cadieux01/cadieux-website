"use client";

// Customer-facing "Updates" strip on /orders/[id].
//
// Renders the customer-visible order_notes rows returned by
// GET /api/orders/[id]/notes. Only 'edit' rows populated by the
// admin_edit_order RPC land here (the endpoint filters
// customer_visible=true, and only edit rows carry that flag).
//
// The endpoint is ownership-scoped — a session that doesn't own this
// order gets 404 (matches /api/orders/[id]'s posture). So if we get
// null or an empty list we just render nothing; no "no updates yet"
// noise, no error line for the common case.

import { useEffect, useState } from "react";

type CustomerNote = {
  id: string;
  kind: "note" | "call" | "edit";
  body: string;
  meta: unknown;
  created_at: string;
};

// IST formatter to match the rest of the tracking page.
function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

export function OrderUpdatesStrip({ orderId }: { orderId: string }) {
  const [notes, setNotes] = useState<CustomerNote[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(
          `/api/orders/${encodeURIComponent(orderId)}/notes`,
          { cache: "no-store", credentials: "include" },
        );
        if (!r.ok) return;
        const d = (await r.json()) as { notes?: CustomerNote[] };
        if (!cancelled) setNotes(d.notes ?? []);
      } catch {
        // Silent — this section is optional. A failed fetch just
        // means we render nothing, same as an empty list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (!notes || notes.length === 0) return null;

  return (
    <section
      style={{
        marginTop: 24,
        padding: "16px 18px",
        background: "#FBF3D4",
        border: "1px solid rgba(2,70,40,0.2)",
        borderRadius: 8,
      }}
    >
      <h3
        style={{
          margin: "0 0 10px",
          fontFamily: "var(--font-body)",
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: "0.4em",
          textTransform: "uppercase",
          color: "#024628",
        }}
      >
        Updates
      </h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {notes.map((n) => (
          <li
            key={n.id}
            style={{
              padding: "10px 0",
              borderBottom: "1px solid rgba(2,70,40,0.15)",
            }}
          >
            <p
              style={{
                margin: 0,
                fontFamily: "var(--font-body)",
                fontSize: 15,
                fontWeight: 300,
                color: "#024628",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}
            >
              {n.body}
            </p>
            <p
              style={{
                margin: "4px 0 0",
                fontFamily: "var(--font-body)",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "0.25em",
                textTransform: "uppercase",
                color: "rgba(2,70,40,0.55)",
              }}
            >
              {formatWhen(n.created_at)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
