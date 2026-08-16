"use client";

// Customer detail. Reads /api/admin/customers/[id] which returns the
// customer row, full order history, full subscription list, and any
// push tokens registered.
//
// "Send manual email" opens a modal that POSTs to
// /api/admin/customers/[id]/send-email (Resend-backed, admin-token
// gated). Last 5 sent emails are loaded via GET on the same route and
// rendered in a collapsible history strip.

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { ContactActions } from "@/components/admin/ContactActions";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatOrderNumber } from "@/lib/order-number";
import {
  formatDate,
  formatDateTime,
  formatINR,
} from "@/lib/admin-formatting";

type CustomerDetail = {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  pincode?: string | null;
  delivery_address?: string | null;
  created_at: string;
};

type OrderRow = {
  id: string;
  /** DB-trigger-assigned OLF number. Null on legacy pre-trigger rows. */
  order_number?: string | null;
  total_amount: number | null;
  status: string | null;
  delivery_address: string | null;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
};

type AddressRow = {
  id: string;
  label: string;
  full_name: string;
  line1: string;
  area: string;
  city: string;
  pincode: string;
  is_default: boolean;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
};

type SubRow = {
  id: string;
  product_name: string;
  total_weeks: number;
  status: string;
  payment_status: string;
  total_amount: number;
  created_at: string;
  frequency: string;
};

type PushToken = {
  token: string;
  platform: string | null;
  updated_at: string | null;
};

type DetailResponse = {
  customer: CustomerDetail;
  orders: OrderRow[];
  addresses: AddressRow[];
  subscriptions: SubRow[];
  push_tokens: PushToken[];
};

type AdminEmailRow = {
  id: string;
  subject: string;
  body: string;
  template: string | null;
  sent_at: string;
  message_id: string | null;
};

export default function CustomerDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? "");

  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [emails, setEmails] = useState<AdminEmailRow[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await adminFetch<DetailResponse>(
        `/api/admin/customers/${id}`,
      );
      setData(res);
    } catch (e) {
      if (e instanceof AdminFetchError) setError(e.message);
      else setError("Could not load customer.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadEmails = useCallback(async () => {
    if (!id) return;
    setEmailsLoading(true);
    try {
      const res = await adminFetch<{ emails: AdminEmailRow[] }>(
        `/api/admin/customers/${id}/send-email`,
      );
      setEmails(res.emails ?? []);
    } catch {
      // Audit table may not exist — degrade silently.
      setEmails([]);
    } finally {
      setEmailsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) {
      void load();
      void loadEmails();
    }
  }, [id, load, loadEmails]);

  const handleEmailSent = (msg: string) => {
    setEmailModalOpen(false);
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
    void loadEmails();
  };

  if (loading) {
    return (
      <AdminShell title="Customer" subtitle="Loading…">
        <Placeholder>Loading customer…</Placeholder>
      </AdminShell>
    );
  }
  if (error || !data) {
    return (
      <AdminShell title="Customer" subtitle="Not found">
        <Placeholder>{error ?? "Customer not found."}</Placeholder>
      </AdminShell>
    );
  }

  const c = data.customer;
  return (
    <AdminShell
      title={c.full_name ?? "Unnamed customer"}
      subtitle={c.phone ?? c.id}
      actions={
        <>
          {c.phone ? (
            <ContactActions
              phone={c.phone}
              customerName={c.full_name}
            />
          ) : null}
          <button
            type="button"
            onClick={() => setEmailModalOpen(true)}
            style={chipNeutral}
          >
            Send email
          </button>
          <Link href="/admin/customers" style={chipNeutral}>
            Back
          </Link>
        </>
      }
    >
      {toast ? (
        <div
          style={{
            border: "1px solid rgba(245,158,11,0.45)",
            background: "rgba(245,158,11,0.07)",
            color: "#fbf3d4",
            padding: "0.7rem 1rem",
            marginBottom: "1rem",
            fontFamily: "var(--font-body)",
            fontSize: "0.85rem",
            letterSpacing: "0.03em",
          }}
        >
          {toast}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <Card title="Profile">
          <KeyVal
            k="Phone"
            v={
              c.phone ? (
                <span className="inline-flex items-center gap-2 flex-wrap">
                  <span style={{ color: "#fbf3d4" }}>{c.phone}</span>
                  <ContactActions
                    phone={c.phone}
                    customerName={c.full_name}
                  />
                </span>
              ) : (
                "—"
              )
            }
          />
          <KeyVal k="City" v={c.city ?? "—"} />
          {c.pincode ? <KeyVal k="Pincode" v={c.pincode} /> : null}
          <KeyVal k="Joined" v={formatDate(c.created_at)} />
        </Card>

        <Card title="Lifetime stats">
          <KeyVal k="Total orders" v={String(data.orders.length)} />
          <KeyVal
            k="Total spent"
            v={formatINR(
              data.orders
                .filter((o) => (o.status ?? "").toLowerCase() !== "cancelled")
                .reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0),
            )}
          />
          <KeyVal
            k="Active subs"
            v={String(
              data.subscriptions.filter((s) => s.status === "active").length,
            )}
          />
        </Card>

        <Card title="Push tokens">
          {data.push_tokens.length === 0 ? (
            <p style={{ color: "rgba(192,200,206,0.55)", fontSize: "0.8rem" }}>
              No active tokens.
            </p>
          ) : (
            data.push_tokens.map((t) => (
              <KeyVal
                key={t.token}
                k={t.platform ?? "device"}
                v={formatDateTime(t.updated_at)}
              />
            ))
          )}
        </Card>
      </div>

      <h3 style={sectionHeading}>Subscriptions</h3>
      {data.subscriptions.length === 0 ? (
        <Placeholder>No subscriptions.</Placeholder>
      ) : (
        <Table headers={["Product", "Weeks", "Frequency", "Status", "Payment", "Amount", "Started"]}>
          {data.subscriptions.map((s) => (
            <tr key={s.id}>
              <td style={td}>{s.product_name}</td>
              <td style={td}>{s.total_weeks}</td>
              <td style={td}>{s.frequency}</td>
              <td style={td}><StatusBadge status={s.status} /></td>
              <td style={td}><StatusBadge status={s.payment_status} /></td>
              <td style={td}>{formatINR(s.total_amount)}</td>
              <td style={td}>{formatDate(s.created_at)}</td>
            </tr>
          ))}
        </Table>
      )}

      <h3 style={sectionHeading}>Email history</h3>
      {emailsLoading ? (
        <Placeholder>Loading email history…</Placeholder>
      ) : emails.length === 0 ? (
        <Placeholder>No admin emails sent yet.</Placeholder>
      ) : (
        <Table headers={["Subject", "Template", "Sent"]}>
          {emails.map((e) => (
            <tr key={e.id} title={e.body}>
              <td style={td}>{e.subject}</td>
              <td style={td}>{e.template ?? "—"}</td>
              <td style={td}>{formatDateTime(e.sent_at)}</td>
            </tr>
          ))}
        </Table>
      )}

      {emailModalOpen ? (
        <SendEmailModal
          customerId={id}
          customerName={c.full_name}
          onCancel={() => setEmailModalOpen(false)}
          onSent={handleEmailSent}
        />
      ) : null}

      <h3 style={sectionHeading}>Saved addresses</h3>
      {data.addresses.length === 0 ? (
        <Placeholder>No saved addresses.</Placeholder>
      ) : (
        <Table headers={["Label", "Recipient", "Address", "Pincode", "Default", "Location", "Saved"]}>
          {data.addresses.map((a) => (
            <tr key={a.id}>
              <td style={td}>{a.label}</td>
              <td style={td}>{a.full_name}</td>
              <td style={{ ...td, maxWidth: 260 }}>{a.line1}, {a.area}, {a.city}</td>
              <td style={td}>{a.pincode}</td>
              <td style={td}>{a.is_default ? "✓" : "—"}</td>
              <td style={td}>
                {a.latitude != null && a.longitude != null ? (
                  <a
                    href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={mapsLink}
                  >
                    Map ↗
                  </a>
                ) : "—"}
              </td>
              <td style={td}>{formatDate(a.created_at)}</td>
            </tr>
          ))}
        </Table>
      )}

      <h3 style={sectionHeading}>Order history</h3>
      {data.orders.length === 0 ? (
        <Placeholder>No orders yet.</Placeholder>
      ) : (
        <Table headers={["Order", "Total", "Status", "Address", "Location", "Created"]}>
          {data.orders.map((o) => (
            <tr key={o.id}>
              <td style={td}>{formatOrderNumber(o)}</td>
              <td style={td}>{formatINR(o.total_amount)}</td>
              <td style={td}><StatusBadge status={o.status} /></td>
              <td style={{ ...td, maxWidth: 300 }}>{o.delivery_address ?? "—"}</td>
              <td style={td}>
                {o.latitude != null && o.longitude != null ? (
                  <a
                    href={`https://www.google.com/maps?q=${o.latitude},${o.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={mapsLink}
                  >
                    Map ↗
                  </a>
                ) : "—"}
              </td>
              <td style={td}>{formatDateTime(o.created_at)}</td>
            </tr>
          ))}
        </Table>
      )}
    </AdminShell>
  );
}

function SendEmailModal({
  customerId,
  customerName,
  onCancel,
  onSent,
}: {
  customerId: string;
  customerName: string | null;
  onCancel: () => void;
  onSent: (msg: string) => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [template, setTemplate] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    setErr(null);
    setSending(true);
    try {
      await adminFetch(`/api/admin/customers/${customerId}/send-email`, {
        method: "POST",
        body: JSON.stringify({
          subject: subject.trim(),
          body: body.trim(),
          template: template.trim() || undefined,
        }),
      });
      onSent(
        `Email sent to ${customerName ?? "customer"}.`,
      );
    } catch (e) {
      if (e instanceof AdminFetchError) setErr(e.message);
      else setErr("Send failed.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={modalBackdrop} onClick={sending ? undefined : onCancel}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={modalTitle}>Send email · {customerName ?? "customer"}</h3>
        </div>
        <div style={modalScrollBody}>
          <label style={modalLabel}>
            Subject
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              disabled={sending}
              placeholder="A note from Cadieux"
              style={modalInput}
            />
          </label>
          <label style={modalLabel}>
            Body
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={10000}
              disabled={sending}
              rows={10}
              placeholder="Hi …"
              style={{ ...modalInput, fontFamily: "var(--font-body)", resize: "vertical" }}
            />
          </label>
          <label style={modalLabel}>
            Template tag (optional)
            <input
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              maxLength={64}
              disabled={sending}
              placeholder="e.g. follow_up, promo, recovery"
              style={modalInput}
            />
          </label>
          {err ? (
            <p style={{ color: "#fca5a5", fontSize: "0.8rem", margin: 0 }}>
              {err}
            </p>
          ) : null}
        </div>
        <div style={modalFooter}>
          <div style={modalActions}>
            <button
              type="button"
              onClick={onCancel}
              disabled={sending}
              style={chipNeutral}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || subject.trim().length === 0 || body.trim().length === 0}
              style={{
                ...chipPrimary,
                opacity: sending || subject.trim().length === 0 || body.trim().length === 0 ? 0.5 : 1,
              }}
            >
              {sending ? "Sending…" : "Send email"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid rgba(245,158,11,0.18)",
        padding: "1rem",
        borderRadius: 6,
      }}
    >
      <h4
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.62rem",
          letterSpacing: "0.25em",
          textTransform: "uppercase",
          color: "rgba(245,158,11,0.9)",
          margin: "0 0 0.6rem 0",
        }}
      >
        {title}
      </h4>
      {children}
    </div>
  );
}

function KeyVal({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "1rem",
        padding: "0.25rem 0",
        fontFamily: "var(--font-body)",
        fontSize: "0.82rem",
      }}
    >
      <span style={{ color: "rgba(192,200,206,0.55)" }}>{k}</span>
      <span style={{ color: "#fbf3d4", textAlign: "right" }}>{v}</span>
    </div>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid rgba(245,158,11,0.18)",
        borderRadius: 6,
        overflow: "hidden",
        marginBottom: "2rem",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr
            style={{
              background: "rgba(245,158,11,0.08)",
              color: "rgba(245,158,11,0.9)",
              textTransform: "uppercase",
              fontSize: "0.6rem",
              letterSpacing: "0.22em",
            }}
          >
            {headers.map((h) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px dashed rgba(245,158,11,0.2)",
        padding: "2rem 1rem",
        textAlign: "center",
        color: "rgba(192,200,206,0.55)",
        fontSize: "0.85rem",
        marginBottom: "2rem",
      }}
    >
      {children}
    </div>
  );
}

const sectionHeading: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.72rem",
  letterSpacing: "0.25em",
  textTransform: "uppercase",
  color: "rgba(245,158,11,0.85)",
  margin: "1.5rem 0 0.8rem",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.7rem 1rem",
  fontFamily: "var(--font-body)",
  fontWeight: 400,
  borderBottom: "1px solid rgba(245,158,11,0.15)",
};

const td: React.CSSProperties = {
  padding: "0.7rem 1rem",
  fontFamily: "var(--font-body)",
  color: "#fbf3d4",
  fontSize: "0.85rem",
  verticalAlign: "top",
  borderBottom: "1px solid rgba(245,158,11,0.06)",
};

const chipBase: React.CSSProperties = {
  padding: "0.35rem 0.85rem",
  border: "1px solid rgba(245,158,11,0.4)",
  fontFamily: "var(--font-body)",
  fontSize: "0.65rem",
  letterSpacing: "0.22em",
  background: "transparent",
  cursor: "pointer",
  textTransform: "uppercase",
  textDecoration: "none",
  display: "inline-block",
};

const chipPrimary: React.CSSProperties = {
  ...chipBase,
  color: "#f59e0b",
  borderColor: "rgba(245,158,11,0.55)",
};

const chipNeutral: React.CSSProperties = {
  ...chipBase,
  color: "rgba(245,158,11,0.85)",
};

const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(29,29,31,0.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
  padding: "1rem",
};

const modalCard: React.CSSProperties = {
  width: "100%",
  maxWidth: 540,
  background: "rgb(12,8,4)",
  border: "1px solid rgba(245,158,11,0.4)",
  borderRadius: 6,
  // 3-zone scrollable layout: sticky header + scrollable body + sticky footer
  display: "flex",
  flexDirection: "column",
  maxHeight: "min(90vh, calc(100dvh - 2rem))",
  minHeight: 0,
  overflow: "hidden",
};

const modalHeader: React.CSSProperties = {
  flexShrink: 0,
  padding: "1.1rem 1.4rem 0.9rem",
  background: "rgb(12,8,4)",
  borderBottom: "1px solid rgba(245,158,11,0.18)",
};

const modalScrollBody: React.CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  padding: "1.1rem 1.4rem",
};

const modalFooter: React.CSSProperties = {
  flexShrink: 0,
  padding: "0.9rem 1.4rem",
  background: "rgb(12,8,4)",
  borderTop: "1px solid rgba(245,158,11,0.18)",
};

const modalTitle: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: "1.05rem",
  color: "#fbf3d4",
  margin: 0,
  letterSpacing: "0.04em",
};

const modalLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
  margin: "0 0 0.9rem",
  fontFamily: "var(--font-body)",
  fontSize: "0.7rem",
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: "rgba(245,158,11,0.85)",
};

const modalInput: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(245,158,11,0.3)",
  color: "#fbf3d4",
  padding: "0.55rem 0.7rem",
  fontSize: "0.85rem",
  letterSpacing: "0.02em",
  outline: "none",
  textTransform: "none",
};

const modalActions: React.CSSProperties = {
  display: "flex",
  gap: "0.6rem",
  justifyContent: "flex-end",
};

const mapsLink: React.CSSProperties = {
  color: "#f59e0b",
  textDecoration: "underline",
  textUnderlineOffset: "2px",
  fontSize: "0.82rem",
  fontFamily: "var(--font-body)",
  whiteSpace: "nowrap",
};
