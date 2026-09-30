"use client";

// Payment Exceptions — captured money this system refused to act on.
//
// Every row is a question about a specific sum that left a customer's account.
// Before this page existed the only trace was an alert email and a log line,
// both of which scroll away; the table was built to outlive them and this is
// the surface that makes it readable.
//
// THREE THINGS ARE ABSENT ON PURPOSE:
//   • no bulk resolve — a button that answers twenty rows at once answers them
//     without reading them, which is where these rows came from;
//   • no un-resolve and no delete — a correction is another note, appended;
//   • no payload in the list — it is Razorpay's raw event, with customer
//     contact details and card metadata, and it is fetched by id only when
//     someone opens "Raw event" on one row.

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatDateTime, formatINR } from "@/lib/admin-formatting";

type LinkedOrder = {
  id: string;
  order_number: string | null;
  total_amount: number | string | null;
  payment_status: string | null;
  status: string | null;
};

type ExceptionRow = {
  id: string;
  reason: "unattributed" | "amount_mismatch" | string;
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
  amount_paise: number;
  expected_amount_paise: number | null;
  received_at: string;
  resolved_at: string | null;
  resolved_note: string | null;
  orders: LinkedOrder[];
};

type Tab = "open" | "resolved";

const REASON_LABEL: Record<string, string> = {
  unattributed: "Unattributed",
  amount_mismatch: "Amount mismatch",
};

// What the reason means in one sentence, for whoever opens this page without
// having read the migration. The wording is the table's definition, not a
// paraphrase of the column name.
const REASON_BLURB: Record<string, string> = {
  unattributed:
    "Money arrived for something we cannot identify — the Razorpay order matches no order and no subscription.",
  amount_mismatch:
    "The order was found, but the captured amount is not the amount owed. Marking it paid would understate the debt.",
};

function rupees(paise: number | null): string {
  if (paise === null || !Number.isFinite(paise)) return "—";
  return formatINR(paise / 100);
}

export default function PaymentExceptionsPage() {
  const [tab, setTab] = useState<Tab>("open");
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [payloads, setPayloads] = useState<Record<string, string>>({});

  const load = useCallback(async (which: Tab) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch<{
        exceptions: ExceptionRow[];
        truncated: boolean;
      }>(
        `/api/admin/payment-exceptions${which === "resolved" ? "?resolved=1" : ""}`,
      );
      setRows(res.exceptions ?? []);
      setTruncated(Boolean(res.truncated));
    } catch (e) {
      setError(
        e instanceof AdminFetchError || e instanceof Error
          ? e.message
          : "Could not load payment exceptions.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  const addNote = async (row: ExceptionRow) => {
    const note = (notes[row.id] ?? "").trim();
    if (!note) {
      setRowErrors((e) => ({
        ...e,
        [row.id]: "A note is required — say what was done about the money.",
      }));
      return;
    }
    setRowErrors((e) => ({ ...e, [row.id]: "" }));
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      await adminFetch(`/api/admin/payment-exceptions/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ note }),
      });
      // Only clear the box once the note is stored. A 409 (someone else wrote
      // first) leaves the text where the operator typed it.
      setNotes((n) => ({ ...n, [row.id]: "" }));
      await load(tab);
    } catch (e) {
      setRowErrors((err) => ({
        ...err,
        [row.id]:
          e instanceof AdminFetchError || e instanceof Error
            ? e.message
            : "Could not save the note.",
      }));
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  };

  const toggleRaw = async (id: string) => {
    if (payloads[id]) {
      setPayloads((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
      return;
    }
    setPayloads((p) => ({ ...p, [id]: "Loading…" }));
    try {
      const res = await adminFetch<{ exception: { payload: unknown } }>(
        `/api/admin/payment-exceptions/${id}`,
      );
      setPayloads((p) => ({
        ...p,
        [id]: JSON.stringify(res.exception?.payload ?? null, null, 2),
      }));
    } catch (e) {
      setPayloads((p) => ({
        ...p,
        [id]:
          e instanceof AdminFetchError || e instanceof Error
            ? e.message
            : "Could not load the raw event.",
      }));
    }
  };

  return (
    <AdminShell
      title="Payment Exceptions"
      subtitle="Captured money nobody has decided about yet"
      actions={
        <button
          type="button"
          onClick={() => void load(tab)}
          disabled={loading}
          className="uppercase"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.25em",
            color: "#FBF3D4",
            border: "1px solid #FBF3D4",
            padding: "0.45rem 0.9rem",
            background: "transparent",
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      <div className="flex flex-wrap gap-2 mb-5">
        {(["open", "resolved"] as Tab[]).map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="uppercase"
              style={{
                background: active ? "rgba(251,243,212,0.15)" : "transparent",
                border: `1px solid ${active ? "rgba(251,243,212,0.7)" : "rgba(251,243,212,0.25)"}`,
                color: active ? "#FBF3D4" : "rgba(251,243,212,0.55)",
                padding: "6px 14px",
                fontFamily: "var(--font-body)",
                fontSize: "0.875rem",
                letterSpacing: "0.22em",
                cursor: "pointer",
              }}
            >
              {t}
            </button>
          );
        })}
      </div>

      {error ? (
        <div
          style={{
            border: "1px solid rgba(239,68,68,0.45)",
            padding: "0.8rem 1rem",
            color: "#EF4444",
            marginBottom: "1rem",
            fontSize: "1rem",
            fontFamily: "var(--font-body)",
          }}
        >
          {error}
        </div>
      ) : null}

      {truncated ? (
        <p style={{ ...mutedText, marginBottom: "1rem" }}>
          Showing the first 200 — oldest first, so the longest wait is never the
          one hidden.
        </p>
      ) : null}

      {loading ? (
        <p style={mutedText}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={mutedText}>
          {tab === "open"
            ? "Nothing unresolved. Every captured payment has been accounted for."
            : "Nothing resolved yet."}
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map((r) => {
            const mismatch =
              r.expected_amount_paise !== null &&
              r.expected_amount_paise !== r.amount_paise;
            const diff = mismatch
              ? r.amount_paise - (r.expected_amount_paise ?? 0)
              : 0;
            return (
              <div
                key={r.id}
                style={{
                  border: "1px solid rgba(251,243,212,0.18)",
                  background: "rgba(251,243,212,0.03)",
                  padding: "16px 18px",
                  display: "grid",
                  gap: 10,
                  fontFamily: "var(--font-body)",
                  color: "#FBF3D4",
                  fontSize: "1rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontWeight: 300,
                        fontSize: "1.15rem",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {rupees(r.amount_paise)} captured
                      {mismatch ? (
                        <span style={{ color: "#F59E0B" }}>
                          {" "}
                          · {rupees(r.expected_amount_paise)} owed (
                          {diff > 0 ? "+" : "−"}
                          {rupees(Math.abs(diff))})
                        </span>
                      ) : null}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        color: "rgba(251,243,212,0.6)",
                        fontSize: "1rem",
                      }}
                    >
                      {REASON_BLURB[r.reason] ?? r.reason}
                    </div>
                  </div>
                  <span
                    className="uppercase"
                    style={{
                      color: r.resolved_at ? "rgba(251,243,212,0.55)" : "#F59E0B",
                      border: `1px solid ${r.resolved_at ? "rgba(251,243,212,0.35)" : "#F59E0B"}`,
                      padding: "4px 12px",
                      fontSize: "0.875rem",
                      letterSpacing: "0.22em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {REASON_LABEL[r.reason] ?? r.reason}
                  </span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                    gap: 12,
                    paddingTop: 8,
                    borderTop: "1px solid rgba(251,243,212,0.1)",
                  }}
                >
                  <div>
                    <div style={smallLabel}>Arrived</div>
                    <div style={{ color: "rgba(251,243,212,0.8)" }}>
                      {formatDateTime(r.received_at)}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={smallLabel}>Razorpay payment</div>
                    <div style={monoText}>{r.razorpay_payment_id ?? "— none in the event"}</div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={smallLabel}>Razorpay order</div>
                    <div style={monoText}>{r.razorpay_order_id ?? "—"}</div>
                  </div>
                  <div>
                    <div style={smallLabel}>Our order</div>
                    {r.orders.length === 0 ? (
                      <div style={{ color: "rgba(251,243,212,0.5)" }}>
                        None found
                      </div>
                    ) : (
                      r.orders.map((o) => (
                        <div key={o.id}>
                          <a
                            href={`/admin/orders?q=${encodeURIComponent(o.order_number ?? o.id)}`}
                            style={{
                              color: "#7FD4C1",
                              textDecoration: "underline",
                            }}
                          >
                            {o.order_number ?? o.id.slice(0, 8)}
                          </a>
                          <span
                            style={{
                              color: "rgba(251,243,212,0.5)",
                              fontSize: "0.875rem",
                            }}
                          >
                            {" "}
                            · {o.status ?? "—"} / {o.payment_status ?? "—"}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {r.resolved_note ? (
                  <div
                    style={{
                      paddingTop: 8,
                      borderTop: "1px solid rgba(251,243,212,0.1)",
                    }}
                  >
                    <div style={smallLabel}>
                      Decision trail
                      {r.resolved_at
                        ? ` · closed ${formatDateTime(r.resolved_at)}`
                        : ""}
                    </div>
                    <div
                      style={{
                        whiteSpace: "pre-wrap",
                        color: "rgba(251,243,212,0.85)",
                      }}
                    >
                      {r.resolved_note}
                    </div>
                  </div>
                ) : null}

                <div
                  style={{
                    paddingTop: 8,
                    borderTop: "1px solid rgba(251,243,212,0.1)",
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div style={smallLabel}>
                    {r.resolved_at ? "Add a note" : "Resolve with a note"}
                  </div>
                  <textarea
                    value={notes[r.id] ?? ""}
                    onChange={(e) =>
                      setNotes((n) => ({ ...n, [r.id]: e.target.value }))
                    }
                    rows={2}
                    maxLength={1000}
                    placeholder={
                      r.resolved_at
                        ? "A correction or anything learned since — this is appended, nothing is overwritten."
                        : "What was done about this money, and why."
                    }
                    style={{
                      width: "100%",
                      background: "rgba(0,0,0,0.25)",
                      border: "1px solid rgba(251,243,212,0.22)",
                      color: "#FBF3D4",
                      fontFamily: "var(--font-body)",
                      fontSize: "1rem",
                      padding: "8px 10px",
                      resize: "vertical",
                    }}
                  />
                  {rowErrors[r.id] ? (
                    <div style={{ color: "#EF4444", fontSize: "1rem" }}>
                      {rowErrors[r.id]}
                    </div>
                  ) : null}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => void addNote(r)}
                      disabled={Boolean(busy[r.id])}
                      className="uppercase"
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "0.875rem",
                        letterSpacing: "0.22em",
                        color: "#FBF3D4",
                        border: "1px solid #FBF3D4",
                        background: "transparent",
                        padding: "6px 14px",
                        cursor: busy[r.id] ? "wait" : "pointer",
                        opacity: busy[r.id] ? 0.6 : 1,
                      }}
                    >
                      {busy[r.id]
                        ? "Saving…"
                        : r.resolved_at
                          ? "Add note"
                          : "Resolve"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleRaw(r.id)}
                      className="uppercase"
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "0.875rem",
                        letterSpacing: "0.22em",
                        color: "rgba(251,243,212,0.55)",
                        border: "1px solid rgba(251,243,212,0.25)",
                        background: "transparent",
                        padding: "6px 14px",
                        cursor: "pointer",
                      }}
                    >
                      {payloads[r.id] ? "Hide raw event" : "Raw event"}
                    </button>
                  </div>
                  {payloads[r.id] ? (
                    <pre
                      style={{
                        ...monoText,
                        maxHeight: 320,
                        overflow: "auto",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(251,243,212,0.15)",
                        padding: "10px 12px",
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {payloads[r.id]}
                    </pre>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}

const mutedText: React.CSSProperties = {
  color: "rgba(251,243,212,0.5)",
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
};

const smallLabel: React.CSSProperties = {
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "rgba(251,243,212,0.45)",
  marginBottom: 4,
};

// Razorpay ids are copied into another tab to look the payment up, so they are
// shown in full and in a face where 0 and O cannot be confused.
const monoText: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "0.875rem",
  color: "rgba(251,243,212,0.8)",
  wordBreak: "break-all",
};
