"use client";

// Customer-facing "Your Requests" page.
// Read-only aggregator that lists this customer's:
//   - order change requests (delivery / items)
//   - subscription change requests
//   - payment history
// All three streams come from GET /api/my-requests (cookie-auth scoped).
// New requests are still created from the order detail / subscription detail
// pages — this is a status / history view.

import { useEffect, useState } from "react";
import Link from "next/link";

import { formatOrderNumber } from "@/lib/order-number";

const GRAIN = "url(/grain.svg)";

type OrderChangeRequest = {
  id: string;
  order_id: string;
  type: string;
  status: string;
  requested_delivery_date: string | null;
  requested_delivery_slot: string | null;
  requested_delivery_address: string | null;
  requested_items: unknown | null;
  requested_total_amount: number | null;
  reason: string | null;
  admin_response: string | null;
  created_at: string;
  resolved_at: string | null;
  order: {
    id: string;
    order_number: string | null;
    status: string;
    total_amount: number;
    delivery_date: string | null;
    delivery_slot: string | null;
    delivery_address: string | null;
  } | null;
};

type SubscriptionChangeRequest = {
  id: string;
  subscription_id: string;
  delivery_id: string;
  requested_date: string | null;
  requested_time_slot: string | null;
  reason: string | null;
  status: string;
  admin_response: string | null;
  created_at: string;
  updated_at: string | null;
};

type PaymentRow = {
  order_id: string;
  order_number: string | null;
  status: string;
  total_amount: number;
  payment_status: string | null;
  payment_method: string | null;
  paid_at: string | null;
  razorpay_payment_id: string | null;
  created_at: string;
};

type Tab = "orders" | "subscriptions" | "payments";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDateOnly(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function statusColor(status: string): { bg: string; fg: string; border: string } {
  const s = (status || "").toLowerCase();
  if (s === "pending")
    return { bg: "transparent", fg: "#024628", border: "#024628" };
  if (s === "approved" || s === "paid" || s === "applied")
    return { bg: "#024628", fg: "#FBF3D4", border: "#024628" };
  if (s === "rejected" || s === "cancelled" || s === "failed")
    return { bg: "transparent", fg: "#991B1B", border: "#991B1B" };
  return { bg: "transparent", fg: "#024628", border: "#024628" };
}

function paymentLabel(p: PaymentRow): string {
  if (p.payment_status === "paid") return "Paid";
  if (p.payment_method === "cod") return "Cash on Delivery";
  if (p.payment_status === "failed") return "Failed";
  if (p.payment_status === "created") return "Awaiting payment";
  return "Awaiting payment";
}

export default function YourRequestsPage() {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("orders");
  const [orderCRs, setOrderCRs] = useState<OrderChangeRequest[]>([]);
  const [subCRs, setSubCRs] = useState<SubscriptionChangeRequest[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/my-requests", { credentials: "include" });
        if (res.status === 401) {
          if (!cancelled) {
            setAuthed(false);
            setLoading(false);
          }
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data?.ok) {
          setError(data?.error || "Failed to load requests");
          setLoading(false);
          return;
        }
        setOrderCRs(data.order_change_requests || []);
        setSubCRs(data.subscription_change_requests || []);
        setPayments(data.payments || []);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#C0C8CE",
        position: "relative",
        overflowX: "clip",
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: GRAIN,
          opacity: 0.04,
          mixBlendMode: "multiply",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <Link
        href="/"
        style={{
          position: "fixed",
          top: "calc(24px + env(safe-area-inset-top))",
          left: "calc(20px + env(safe-area-inset-left))",
          zIndex: 101,
          fontFamily: "var(--font-body)",
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          color: "#024628",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 16 }}>←</span> Cadieux
      </Link>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "100px clamp(24px,6vw,80px) 120px",
          maxWidth: 760,
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(48px,11vw,88px)",
            fontWeight: 300,
            color: "#024628",
            letterSpacing: "0.02em",
            lineHeight: 1,
          }}
        >
          Requests
        </h1>
        <p
          style={{
            margin: "8px 0 36px",
            fontFamily: "var(--font-body)",
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(2,70,40,0.7)",
          }}
        >
          Status of your order changes, subscription edits & payments
        </p>

        {loading && (
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 15,
              color: "rgba(2,70,40,0.6)",
              letterSpacing: "0.1em",
            }}
          >
            Loading…
          </p>
        )}

        {!loading && !authed && (
          <div>
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 16,
                fontWeight: 200,
                color: "rgba(2,70,40,0.8)",
                lineHeight: 1.7,
                marginBottom: 24,
              }}
            >
              Please verify your phone from the cart or an order page to view
              your requests.
            </p>
            <Link
              href="/cart"
              style={{
                display: "inline-block",
                padding: "14px 28px",
                border: "1px solid #024628",
                background: "#024628",
                fontFamily: "var(--font-body)",
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: "0.4em",
                textTransform: "uppercase",
                color: "#FBF3D4",
                textDecoration: "none",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Go to Cart
            </Link>
          </div>
        )}

        {!loading && authed && error && (
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 16,
              color: "#991B1B",
            }}
          >
            {error}
          </p>
        )}

        {!loading && authed && !error && (
          <>
            {/* Tabs */}
            <div
              style={{
                display: "flex",
                gap: 4,
                marginBottom: 28,
                borderBottom: "1px solid rgba(2,70,40,0.2)",
              }}
            >
              {(
                [
                  ["orders", `Order changes (${orderCRs.length})`],
                  ["subscriptions", `Subscriptions (${subCRs.length})`],
                  ["payments", `Payments (${payments.length})`],
                ] as Array<[Tab, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: "12px 14px",
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    fontWeight: 500,
                    letterSpacing: "0.3em",
                    textTransform: "uppercase",
                    color:
                      tab === key
                        ? "#024628"
                        : "rgba(2,70,40,0.55)",
                    borderBottom:
                      tab === key
                        ? "1px solid #024628"
                        : "1px solid transparent",
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Order changes */}
            {tab === "orders" && (
              <>
                {orderCRs.length === 0 ? (
                  <EmptyState text="No order change requests yet. You can request a change to a delivery date, time, address or quantity from any active order." />
                ) : (
                  orderCRs.map((r) => <OrderCRCard key={r.id} cr={r} />)
                )}
              </>
            )}

            {/* Subscription changes */}
            {tab === "subscriptions" && (
              <>
                {subCRs.length === 0 ? (
                  <EmptyState text="No subscription change requests yet." />
                ) : (
                  subCRs.map((r) => <SubCRCard key={r.id} cr={r} />)
                )}
              </>
            )}

            {/* Payments */}
            {tab === "payments" && (
              <>
                {payments.length === 0 ? (
                  <EmptyState text="No payments yet." />
                ) : (
                  payments.map((p) => <PaymentCard key={p.order_id} p={p} />)
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p
      style={{
        fontFamily: "var(--font-body)",
        fontSize: 16,
        fontWeight: 200,
        color: "rgba(2,70,40,0.7)",
        lineHeight: 1.7,
      }}
    >
      {text}
    </p>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { bg, fg, border } = statusColor(status);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        fontFamily: "var(--font-body)",
        fontSize: 14,
        fontWeight: 500,
        letterSpacing: "0.3em",
        textTransform: "uppercase",
      }}
    >
      {status}
    </span>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        position: "relative",
        padding: "20px 20px 18px",
        border: "1px solid #024628",
        background: "#FBF3D4",
        marginBottom: 16,
      }}
    >
      {children}
    </section>
  );
}

function OrderCRCard({ cr }: { cr: OrderChangeRequest }) {
  const isDelivery = cr.type === "delivery";
  const isItems = cr.type === "items";
  return (
    <CardShell>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: "rgba(2,70,40,0.65)",
              marginBottom: 4,
            }}
          >
            {isDelivery
              ? "Delivery change"
              : isItems
                ? "Item change"
                : cr.type}
          </div>
          <Link
            href={`/orders/${cr.order_id}`}
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 16,
              color: "#024628",
              textDecoration: "none",
            }}
          >
            Order{" "}
            {formatOrderNumber({
              id: cr.order_id,
              order_number: cr.order?.order_number ?? null,
            })}
          </Link>
        </div>
        <StatusBadge status={cr.status} />
      </div>

      {isDelivery && (
        <DiffGrid
          rows={[
            cr.requested_delivery_date != null && [
              "Date",
              formatDateOnly(cr.order?.delivery_date ?? null),
              formatDateOnly(cr.requested_delivery_date),
            ],
            cr.requested_delivery_slot != null && [
              "Slot",
              cr.order?.delivery_slot ?? "—",
              cr.requested_delivery_slot,
            ],
            cr.requested_delivery_address != null && [
              "Address",
              cr.order?.delivery_address ?? "—",
              cr.requested_delivery_address,
            ],
          ].filter(Boolean) as Array<[string, string, string]>}
        />
      )}

      {isItems && (
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 16,
            color: "rgba(2,70,40,0.8)",
            margin: "8px 0 0",
          }}
        >
          Requested item quantity change
          {cr.requested_total_amount != null
            ? ` · new total ₹${Number(cr.requested_total_amount).toFixed(0)}`
            : ""}
        </p>
      )}

      {cr.reason && (
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 16,
            color: "rgba(2,70,40,0.7)",
            margin: "10px 0 0",
            fontStyle: "italic",
          }}
        >
          “{cr.reason}”
        </p>
      )}

      {cr.admin_response && (
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 16,
            color: "rgba(2,70,40,0.7)",
            margin: "10px 0 0",
          }}
        >
          Admin response: {cr.admin_response}
        </p>
      )}

      <div
        style={{
          marginTop: 12,
          fontFamily: "var(--font-body)",
          fontSize: 14,
          letterSpacing: "0.2em",
          color: "rgba(2,70,40,0.55)",
        }}
      >
        Filed {formatDate(cr.created_at)}
        {cr.resolved_at ? ` · Resolved ${formatDate(cr.resolved_at)}` : ""}
      </div>
    </CardShell>
  );
}

function SubCRCard({ cr }: { cr: SubscriptionChangeRequest }) {
  return (
    <CardShell>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: "rgba(2,70,40,0.65)",
              marginBottom: 4,
            }}
          >
            Subscription delivery change
          </div>
          <Link
            href={`/subscriptions/${cr.subscription_id}`}
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 16,
              color: "#024628",
              textDecoration: "none",
            }}
          >
            Subscription #{cr.subscription_id.slice(0, 8)}
          </Link>
        </div>
        <StatusBadge status={cr.status} />
      </div>

      <DiffGrid
        rows={[
          cr.requested_date != null && [
            "New date",
            "—",
            formatDateOnly(cr.requested_date),
          ],
          cr.requested_time_slot != null && [
            "New slot",
            "—",
            cr.requested_time_slot,
          ],
        ].filter(Boolean) as Array<[string, string, string]>}
      />

      {cr.reason && (
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 16,
            color: "rgba(2,70,40,0.7)",
            margin: "10px 0 0",
            fontStyle: "italic",
          }}
        >
          “{cr.reason}”
        </p>
      )}

      {cr.admin_response && (
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 16,
            color: "rgba(2,70,40,0.7)",
            margin: "10px 0 0",
          }}
        >
          Admin response: {cr.admin_response}
        </p>
      )}

      <div
        style={{
          marginTop: 12,
          fontFamily: "var(--font-body)",
          fontSize: 14,
          letterSpacing: "0.2em",
          color: "rgba(2,70,40,0.55)",
        }}
      >
        Filed {formatDate(cr.created_at)}
      </div>
    </CardShell>
  );
}

function PaymentCard({ p }: { p: PaymentRow }) {
  const label = paymentLabel(p);
  return (
    <CardShell>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Link
          href={`/orders/${p.order_id}`}
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 16,
            color: "#024628",
            textDecoration: "none",
          }}
        >
          Order {formatOrderNumber({ id: p.order_id, order_number: p.order_number })}
        </Link>
        <StatusBadge status={label} />
      </div>
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 16,
          color: "rgba(2,70,40,0.8)",
        }}
      >
        ₹{Number(p.total_amount ?? 0).toFixed(0)}
        {p.paid_at ? ` · paid ${formatDate(p.paid_at)}` : ""}
      </div>
      <div
        style={{
          marginTop: 10,
          fontFamily: "var(--font-body)",
          fontSize: 14,
          letterSpacing: "0.2em",
          color: "rgba(2,70,40,0.55)",
        }}
      >
        Placed {formatDate(p.created_at)}
      </div>
    </CardShell>
  );
}

function DiffGrid({ rows }: { rows: Array<[string, string, string]> }) {
  if (rows.length === 0) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto 1fr",
        rowGap: 6,
        columnGap: 12,
        fontFamily: "var(--font-body)",
        fontSize: 16,
        color: "rgba(2,70,40,0.8)",
      }}
    >
      {rows.map(([label, oldVal, newVal]) => (
        <div key={label} style={{ display: "contents" }}>
          <div style={{ color: "rgba(2,70,40,0.6)" }}>{label}</div>
          <div style={{ textDecoration: "line-through", opacity: 0.55 }}>
            {oldVal}
          </div>
          <div style={{ color: "rgba(2,70,40,0.6)" }}>→</div>
          <div style={{ color: "#024628", fontWeight: 400 }}>{newVal}</div>
        </div>
      ))}
    </div>
  );
}
