"use client";

// Customer detail. Reads /api/admin/customers/[id] which returns the
// customer row, full order history, full subscription list, and any
// push tokens registered.
//
// "Send manual reminder email" is a placeholder button — no /api/admin
// route exists yet for ad-hoc admin email. The button surfaces a toast
// noting that and links the operator to the existing Resend cron.

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import {
  formatDate,
  formatDateTime,
  formatINR,
  telHref,
  whatsAppHref,
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
  total_amount: number | null;
  status: string | null;
  delivery_address: string | null;
  created_at: string;
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
  subscriptions: SubRow[];
  push_tokens: PushToken[];
};

export default function CustomerDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? "");

  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  const triggerReminderEmail = () => {
    // No /api/admin/customers/[id]/email route exists today. Surface
    // that fact instead of silently failing.
    setToast(
      "Email helper not wired yet. The Resend cron at /api/cron/subscription-reminders runs daily at 03:30 UTC. Wiring an ad-hoc admin email is a follow-up.",
    );
    setTimeout(() => setToast(null), 6000);
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
            <a
              href={whatsAppHref(c.phone)}
              target="_blank"
              rel="noopener noreferrer"
              style={chipPrimary}
            >
              WhatsApp
            </a>
          ) : null}
          <button
            type="button"
            onClick={triggerReminderEmail}
            style={chipNeutral}
          >
            Send manual reminder
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
          <KeyVal k="Phone" v={c.phone ? (
            <a href={telHref(c.phone)} style={{ color: "#fbf3d4" }}>
              {c.phone}
            </a>
          ) : "—"} />
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

      <h3 style={sectionHeading}>Order history</h3>
      {data.orders.length === 0 ? (
        <Placeholder>No orders yet.</Placeholder>
      ) : (
        <Table headers={["Order", "Total", "Status", "Address", "Created"]}>
          {data.orders.map((o) => (
            <tr key={o.id}>
              <td style={td}>#{o.id.slice(0, 8)}</td>
              <td style={td}>{formatINR(o.total_amount)}</td>
              <td style={td}><StatusBadge status={o.status} /></td>
              <td style={{ ...td, maxWidth: 360 }}>{o.delivery_address ?? "—"}</td>
              <td style={td}>{formatDateTime(o.created_at)}</td>
            </tr>
          ))}
        </Table>
      )}
    </AdminShell>
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
