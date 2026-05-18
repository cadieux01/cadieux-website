"use client";

// Legacy admin (formerly /admin). Preserved verbatim except for the outer
// chrome — the AdminShell wrapper now provides the password gate, the top
// brand + nav, and the Sign-out button. Everything else (4-tab section
// switcher, 10s polling, Change Requests, Feedback) is unchanged.
//
// New admin work lives in sibling routes: /admin/overview, /admin/orders,
// /admin/customers, /admin/subscriptions, /admin/products.

import { useEffect, useState, useCallback, FormEvent } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { ADMIN_PASSWORD } from "@/lib/admin-shared";

type Customer = {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
};

type Order = {
  id: string;
  customer_id: string | null;
  total_amount: number | null;
  status: string | null;
  delivery_address: string | null;
  created_at: string;
  customers?: Customer | null;
};

type SubAddress = {
  name?: string;
  phone?: string;
  line1?: string;
  line2?: string | null;
  city?: string;
  pincode?: string;
};

type Subscription = {
  id: string;
  customer_id: string;
  product_slug: string;
  product_name: string;
  quantity_per_delivery: number;
  frequency: string;
  day_of_week: string;
  time_slot: string;
  total_weeks: number;
  delivery_address: SubAddress;
  total_amount: number;
  payment_status: string;
  payment_method: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  customer?: { full_name: string | null; phone: string | null; city: string | null } | null;
};

type AdminDelivery = {
  id: string;
  subscription_id: string;
  week_number: number;
  scheduled_date: string;
  scheduled_time_slot: string;
  status: string;
  status_updated_at: string | null;
  admin_notes: string | null;
};

type ChangeRequest = {
  id: string;
  delivery_id: string;
  subscription_id: string;
  requested_date: string | null;
  requested_time_slot: string | null;
  reason: string | null;
  status: string;
  admin_response: string | null;
  created_at: string;
  delivery?: { week_number: number; scheduled_date: string; scheduled_time_slot: string; status: string } | null;
  subscription?: { product_name: string; total_weeks: number } | null;
  customer?: { full_name: string | null; phone: string | null } | null;
};

type Section = "orders" | "subscriptions" | "change-requests" | "feedback";

const SUB_STATUS_OPTIONS = ["active", "paused", "completed", "cancelled"] as const;
const DELIVERY_STATUS_OPTIONS = [
  "pending_confirmation",
  "confirmed",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;
const SUB_FILTER_OPTIONS = ["all", "active", "completed", "cancelled"] as const;
type SubFilter = (typeof SUB_FILTER_OPTIONS)[number];

type Reply = {
  id: string;
  review_id: string;
  author_name: string;
  is_admin: boolean;
  body: string;
  likes_count: number;
  created_at: string;
};

type Review = {
  id: string;
  product_slug: string | null;
  author_name: string;
  rating: number | null;
  body: string;
  likes_count: number;
  created_at: string;
  replies: Reply[];
};

const DAY_LABELS: Record<string, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};

const STATUS_OPTIONS = ["Pending", "Confirmed", "Dispatched", "Delivered"] as const;
type Status = (typeof STATUS_OPTIONS)[number];

function buildStatusMessage(name: string, status: Status): string | null {
  const n = name || "Customer";
  switch (status) {
    case "Confirmed":  return `Hi ${n}! ✅ Your Cadieux order has been confirmed! We are preparing your fresh bread. 🍞`;
    case "Dispatched": return `Hi ${n}! 🚚 Your Cadieux order is on the way! Our delivery partner will reach you soon.`;
    case "Delivered":  return `Hi ${n}! 🎉 Your Cadieux order has been delivered! Enjoy your fresh bread. Thank you for choosing Cadieux. 🍞`;
    default: return null;
  }
}

type SendState = "idle" | "sending" | "sent" | "error";

// Password gate, brand header, sign-out, and outer chrome are owned by
// <AdminShell>. The legacy dashboard stays focused on its 4-tab content.
export default function LegacyAdminPage() {
  return (
    <AdminShell title="Legacy" subtitle="Original admin · live polling">
      <Dashboard />
    </AdminShell>
  );
}

function Dashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [subFilter, setSubFilter] = useState<SubFilter>("all");
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});
  const [section, setSection] = useState<Section>("orders");
  const [menuOpen, setMenuOpen] = useState(false);

  const fetchOrders = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/orders", {
        headers: { "x-admin-token": ADMIN_PASSWORD },
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(j.orders)) {
        setOrders(j.orders as Order[]);
      }
    } catch {
      /* silent — leave existing state */
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSubscriptions = useCallback(async () => {
    try {
      const url =
        subFilter === "all"
          ? "/api/admin/subscriptions"
          : `/api/admin/subscriptions?status=${subFilter}`;
      const r = await fetch(url, {
        headers: { "x-admin-token": ADMIN_PASSWORD },
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(j.subscriptions)) {
        setSubscriptions(j.subscriptions as Subscription[]);
      }
    } catch {
      /* silent */
    }
  }, [subFilter]);

  const fetchChangeRequests = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/change-requests", {
        headers: { "x-admin-token": ADMIN_PASSWORD },
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(j.requests)) {
        setChangeRequests(j.requests as ChangeRequest[]);
      }
    } catch {
      /* silent */
    }
  }, []);

  const fetchReviews = useCallback(async () => {
    try {
      const r = await fetch("/api/reviews", { cache: "no-store" });
      const j = await r.json();
      if (r.ok) setReviews(j.reviews ?? []);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    fetchSubscriptions();
    fetchChangeRequests();
    fetchReviews();

    // Realtime is no longer available to the anon role (RLS denies all
    // anon SELECT on orders/subscriptions/customers). Poll the admin
    // endpoints every 10s instead.
    setConnected(true);
    const interval = setInterval(() => {
      fetchOrders();
      fetchSubscriptions();
      fetchChangeRequests();
      fetchReviews();
    }, 10_000);

    return () => clearInterval(interval);
  }, [fetchOrders, fetchSubscriptions, fetchChangeRequests, fetchReviews]);

  const updateStatus = async (order: Order, newStatus: Status) => {
    const prev = orders;
    setOrders((curr) =>
      curr.map((o) => (o.id === order.id ? { ...o, status: newStatus.toLowerCase() } : o))
    );

    const r = await fetch(`/api/admin/orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-token": ADMIN_PASSWORD },
      body: JSON.stringify({ status: newStatus.toLowerCase() }),
    });

    if (!r.ok) {
      setOrders(prev);
      return;
    }

    // Automated SMS (primary) + WhatsApp (secondary) on status change
    sendSMSFor(order, newStatus);
    await sendWhatsAppFor(order, newStatus);
  };

  const sendSMSFor = async (order: Order, status: Status) => {
    const phone = order.customers?.phone;
    const name = order.customers?.full_name ?? "Customer";
    if (!phone || !["Confirmed", "Dispatched", "Delivered"].includes(status)) return;
    try {
      await fetch("/api/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "status_change", phone, name, orderId: order.id, status }),
      });
    } catch {
      /* silent */
    }
  };

  const sendWhatsAppFor = async (order: Order, status: Status) => {
    const phone = order.customers?.phone;
    const name = order.customers?.full_name ?? "Customer";
    const message = buildStatusMessage(name, status);
    if (!phone || !message) return;

    setSendStates((s) => ({ ...s, [order.id]: "sending" }));
    try {
      const res = await fetch("/api/send-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message }),
      });
      if (!res.ok) throw new Error("send failed");
      setSendStates((s) => ({ ...s, [order.id]: "sent" }));
      setTimeout(() => {
        setSendStates((s) => {
          if (s[order.id] !== "sent") return s;
          const { [order.id]: _, ...rest } = s;
          return rest;
        });
      }, 2500);
    } catch {
      setSendStates((s) => ({ ...s, [order.id]: "error" }));
      setTimeout(() => {
        setSendStates((s) => {
          if (s[order.id] !== "error") return s;
          const { [order.id]: _, ...rest } = s;
          return rest;
        });
      }, 3000);
    }
  };

  return (
    <div className="relative z-10">
      {/* Slim toolbar: hamburger opens the legacy section menu (Orders /
          Subscriptions / Change Requests / Feedback). Brand + sign-out are
          owned by AdminShell. */}
      <div
        className="flex items-center justify-between mb-4"
        style={{ paddingBottom: "0.75rem", borderBottom: "1px solid rgba(245, 158, 11, 0.12)" }}
      >
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Open section menu"
          style={{
            display: "flex", flexDirection: "column", gap: 5,
            background: "transparent", border: "none", padding: 6,
            cursor: "pointer",
          }}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                display: "block", width: 24, height: 2,
                background: menuOpen ? "rgba(245,158,11,0.9)" : "rgba(245,158,11,0.55)",
                transition: "background 200ms ease",
              }}
            />
          ))}
        </button>
        <div
          className="flex items-center gap-2"
          style={{ fontFamily: "var(--font-body)", fontSize: "0.7rem", letterSpacing: "0.2em", color: "rgba(192,200,206,0.6)", textTransform: "uppercase" }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{
              background: connected ? "#22c55e" : "#6b7280",
              boxShadow: connected ? "0 0 8px #22c55e" : "none",
            }}
          />
          {connected ? "Live" : "Offline"}
        </div>
      </div>

      {menuOpen && (
        <>
          <div
            onClick={() => setMenuOpen(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 30,
              background: "rgba(0,0,0,0.55)",
            }}
          />
          <nav
            style={{
              position: "fixed", top: 0, left: 0, zIndex: 40,
              width: "min(280px, 80vw)", height: "100vh",
              background: "rgb(6,4,2)",
              borderRight: "1px solid rgba(245, 158, 11, 0.2)",
              padding: "100px 24px 24px",
              display: "flex", flexDirection: "column", gap: 4,
            }}
          >
            <p
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)", fontSize: "0.6rem",
                letterSpacing: "0.3em", color: "rgba(245,158,11,0.55)",
                marginBottom: 14,
              }}
            >
              Dashboard
            </p>
            {(() => {
              const pendingCRs = changeRequests.filter((r) => r.status === "pending").length;
              const items: { key: Section; label: string; badge?: number }[] = [
                { key: "orders", label: "General Payments" },
                { key: "subscriptions", label: "Subscriptions" },
                { key: "change-requests", label: "Change Requests", badge: pendingCRs },
                { key: "feedback", label: "Feedback" },
              ];
              return items.map(({ key, label, badge }) => (
                <button
                  key={key}
                  onClick={() => { setSection(key); setMenuOpen(false); }}
                  className="uppercase"
                  style={{
                    textAlign: "left",
                    padding: "12px 0",
                    borderBottom: "1px solid rgba(245, 158, 11, 0.1)",
                    background: "transparent",
                    border: "none",
                    borderBottomStyle: "solid",
                    borderBottomWidth: 1,
                    borderBottomColor: "rgba(245, 158, 11, 0.1)",
                    color: section === key ? "#fbf3d4" : "rgba(251,243,212,0.5)",
                    fontFamily: "var(--font-body)",
                    fontSize: "0.8rem",
                    letterSpacing: "0.2em",
                    cursor: "pointer",
                    transition: "color 200ms ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span>{label}</span>
                  {badge && badge > 0 ? (
                    <span
                      style={{
                        background: "#e05a5a",
                        color: "#fff",
                        fontSize: "0.6rem",
                        letterSpacing: "0.05em",
                        padding: "2px 7px",
                        borderRadius: 999,
                        minWidth: 20,
                        textAlign: "center",
                      }}
                    >
                      {badge}
                    </span>
                  ) : null}
                </button>
              ));
            })()}
          </nav>
        </>
      )}

      {section === "orders" && (
      <section className="px-8 py-8">
        <h2
          className="uppercase mb-6"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "1.25rem",
            letterSpacing: "0.3em",
            color: "#fbf3d4",
            fontWeight: 300,
          }}
        >
          General Payments
        </h2>
        {loading ? (
          <p style={{ color: "rgba(192,200,206,0.5)", fontFamily: "var(--font-body)", fontSize: "0.85rem" }}>
            Loading orders…
          </p>
        ) : orders.length === 0 ? (
          <p style={{ color: "rgba(192,200,206,0.5)", fontFamily: "var(--font-body)", fontSize: "0.85rem" }}>
            No orders yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse"
              style={{ fontFamily: "var(--font-body)", fontSize: "0.8rem", color: "#fbf3d4" }}
            >
              <thead>
                <tr style={{ color: "rgba(245,158,11,0.8)", letterSpacing: "0.2em", textTransform: "uppercase", fontSize: "0.65rem" }}>
                  <Th>Order ID</Th>
                  <Th>Customer</Th>
                  <Th>Phone</Th>
                  <Th>Address</Th>
                  <Th>City</Th>
                  <Th>Total</Th>
                  <Th>Status</Th>
                  <Th>WhatsApp</Th>
                  <Th>Date</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => {
                  const status = (o.status ?? "pending").toLowerCase();
                  const normalized = (STATUS_OPTIONS.find((s) => s.toLowerCase() === status) ?? "Pending") as Status;
                  const displayNumber = String(orders.length - i).padStart(5, "0");
                  return (
                    <tr
                      key={o.id}
                      style={{ borderTop: "1px solid rgba(245, 158, 11, 0.12)" }}
                    >
                      <Td mono>{displayNumber}</Td>
                      <Td>
                        <div className="inline-flex items-center gap-2">
                          <span>{o.customers?.full_name ?? "—"}</span>
                          <button
                            onClick={() => setEditingOrder(o)}
                            title="Edit customer"
                            className="uppercase"
                            style={{
                              border: "1px solid rgba(245, 158, 11, 0.45)",
                              color: "#f59e0b",
                              fontFamily: "var(--font-body)",
                              fontSize: "0.55rem",
                              letterSpacing: "0.2em",
                              padding: "2px 8px",
                              background: "transparent",
                              cursor: "pointer",
                            }}
                          >
                            Edit
                          </button>
                        </div>
                      </Td>
                      <Td>{o.customers?.phone ?? "—"}</Td>
                      <Td>{o.delivery_address ?? "—"}</Td>
                      <Td>{o.customers?.city ?? "—"}</Td>
                      <Td>₹{Number(o.total_amount ?? 0).toFixed(2)}</Td>
                      <Td>
                        <StatusBadge
                          value={normalized}
                          onChange={(next) => updateStatus(o, next)}
                        />
                      </Td>
                      <Td>
                        <SendWhatsAppButton
                          state={sendStates[o.id] ?? "idle"}
                          disabled={!o.customers?.phone || normalized === "Pending"}
                          onClick={() => sendWhatsAppFor(o, normalized)}
                        />
                      </Td>
                      <Td>
                        {new Date(o.created_at).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {section === "subscriptions" && (
        <SubscriptionsSection
          subscriptions={subscriptions}
          subFilter={subFilter}
          onFilterChange={setSubFilter}
          onChanged={fetchSubscriptions}
        />
      )}

      {section === "change-requests" && (
        <ChangeRequestsSection
          requests={changeRequests}
          onChanged={() => {
            fetchChangeRequests();
            fetchSubscriptions();
          }}
        />
      )}

      {section === "feedback" && (
        <FeedbackSection reviews={reviews} onChanged={fetchReviews} />
      )}

      {editingOrder && (
        <EditCustomerModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSaved={() => {
            setEditingOrder(null);
            fetchOrders();
          }}
        />
      )}
    </div>
  );
}

const SUB_STATUS_COLORS: Record<string, { fg: string; bg: string; bd: string }> = {
  active:    { fg: "#c9a96e", bg: "rgba(201,169,110,0.10)", bd: "rgba(201,169,110,0.55)" },
  paused:    { fg: "#e3b341", bg: "rgba(227,179,65,0.10)",  bd: "rgba(227,179,65,0.55)" },
  completed: { fg: "#7bd88f", bg: "rgba(123,216,143,0.10)", bd: "rgba(123,216,143,0.55)" },
  cancelled: { fg: "#ff8181", bg: "rgba(255,129,129,0.10)", bd: "rgba(255,129,129,0.55)" },
};

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  pending_confirmation: "Pending",
  confirmed: "Confirmed",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

function formatScheduledDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function SubscriptionsSection({
  subscriptions,
  subFilter,
  onFilterChange,
  onChanged,
}: {
  subscriptions: Subscription[];
  subFilter: SubFilter;
  onFilterChange: (f: SubFilter) => void;
  onChanged: () => void;
}) {
  const [openSubId, setOpenSubId] = useState<string | null>(null);
  const openSub = openSubId ? subscriptions.find((s) => s.id === openSubId) ?? null : null;

  return (
    <section className="px-8 py-8">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 16, marginBottom: 18 }}>
        <h2
          className="uppercase"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "1.25rem",
            letterSpacing: "0.3em",
            color: "#fbf3d4",
            fontWeight: 300,
            margin: 0,
          }}
        >
          Subscriptions
        </h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SUB_FILTER_OPTIONS.map((f) => {
            const active = subFilter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => onFilterChange(f)}
                className="uppercase"
                style={{
                  background: active ? "rgba(245,158,11,0.15)" : "transparent",
                  border: `1px solid ${active ? "rgba(245,158,11,0.7)" : "rgba(245,158,11,0.25)"}`,
                  color: active ? "#fbf3d4" : "rgba(251,243,212,0.55)",
                  padding: "6px 14px",
                  fontFamily: "var(--font-body)",
                  fontSize: "0.65rem",
                  letterSpacing: "0.22em",
                  cursor: "pointer",
                }}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      {subscriptions.length === 0 ? (
        <p style={{ color: "rgba(192,200,206,0.5)", fontFamily: "var(--font-body)", fontSize: "0.85rem" }}>
          No subscriptions to show.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {subscriptions.map((s) => {
            const status = (s.status ?? "active").toLowerCase();
            const c = SUB_STATUS_COLORS[status] ?? SUB_STATUS_COLORS.active;
            const dayLabel = DAY_LABELS[s.day_of_week] ?? s.day_of_week;
            const freqLabel = s.frequency === "bi-weekly" ? "Every 2 weeks" : "Weekly";
            const addr = s.delivery_address ?? {};
            const addrLine = [addr.line1, addr.line2, addr.city, addr.pincode].filter(Boolean).join(", ");
            return (
              <div
                key={s.id}
                style={{
                  border: "1px solid rgba(245,158,11,0.18)",
                  background: "rgba(245,158,11,0.03)",
                  padding: "16px 18px",
                  display: "grid",
                  gap: 10,
                  fontFamily: "var(--font-body)",
                  color: "#fbf3d4",
                  fontSize: "0.82rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                  <div>
                    <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: "1.05rem", letterSpacing: "0.04em" }}>
                      {s.product_name} × {s.quantity_per_delivery}
                    </div>
                    <div style={{ marginTop: 4, color: "rgba(251,243,212,0.6)", fontSize: "0.78rem" }}>
                      {freqLabel} · {dayLabel} · {s.time_slot} · {s.total_weeks} weeks
                    </div>
                  </div>
                  <span
                    className="uppercase"
                    style={{
                      color: c.fg,
                      background: c.bg,
                      border: `1px solid ${c.bd}`,
                      padding: "4px 12px",
                      fontSize: "0.6rem",
                      letterSpacing: "0.22em",
                    }}
                  >
                    {s.status}
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 18, fontSize: "0.78rem" }}>
                  <span><span style={{ color: "rgba(251,243,212,0.5)" }}>Customer · </span>{s.customer?.full_name ?? "—"}</span>
                  <span><span style={{ color: "rgba(251,243,212,0.5)" }}>Phone · </span>{s.customer?.phone ?? "—"}</span>
                  <span><span style={{ color: "rgba(251,243,212,0.5)" }}>Total · </span>₹{Number(s.total_amount).toLocaleString("en-IN")}</span>
                  <span><span style={{ color: "rgba(251,243,212,0.5)" }}>Payment · </span>{s.payment_status}{s.payment_method ? ` (${s.payment_method})` : ""}</span>
                </div>
                {addrLine && (
                  <div style={{ fontSize: "0.75rem", color: "rgba(251,243,212,0.5)" }}>
                    {addr.name ? <><b style={{ color: "rgba(251,243,212,0.7)", fontWeight: 500 }}>{addr.name}</b> · </> : null}
                    {addrLine}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", borderTop: "1px solid rgba(245,158,11,0.1)", paddingTop: 10 }}>
                  <span style={{ fontSize: "0.7rem", color: "rgba(251,243,212,0.4)" }}>
                    Created {new Date(s.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenSubId(s.id)}
                    className="uppercase"
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(245,158,11,0.55)",
                      color: "#f59e0b",
                      padding: "6px 14px",
                      fontFamily: "var(--font-body)",
                      fontSize: "0.65rem",
                      letterSpacing: "0.2em",
                      cursor: "pointer",
                    }}
                  >
                    Open
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openSub && (
        <SubscriptionDrawer
          subscription={openSub}
          onClose={() => setOpenSubId(null)}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}

function SubscriptionDrawer({
  subscription,
  onClose,
  onChanged,
}: {
  subscription: Subscription;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [deliveries, setDeliveries] = useState<AdminDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDeliveries = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/subscriptions/${subscription.id}/deliveries`, {
        headers: { "x-admin-token": ADMIN_PASSWORD },
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setDeliveries(j.deliveries ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [subscription.id]);

  useEffect(() => {
    fetchDeliveries();
    const interval = setInterval(fetchDeliveries, 10_000);
    return () => clearInterval(interval);
  }, [fetchDeliveries]);

  const updateOverallStatus = async (next: string) => {
    const r = await fetch(`/api/admin/subscriptions/${subscription.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-token": ADMIN_PASSWORD },
      body: JSON.stringify({ status: next }),
    });
    if (r.ok) onChanged();
  };

  const updatePaymentStatus = async (next: string) => {
    const r = await fetch(`/api/admin/subscriptions/${subscription.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-token": ADMIN_PASSWORD },
      body: JSON.stringify({ payment_status: next }),
    });
    if (r.ok) onChanged();
  };

  const updateDeliveryStatus = async (deliveryId: string, next: string) => {
    const prev = deliveries;
    setDeliveries((curr) =>
      curr.map((d) => (d.id === deliveryId ? { ...d, status: next } : d))
    );
    try {
      const r = await fetch(
        `/api/admin/subscriptions/${subscription.id}/deliveries/${deliveryId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-admin-token": ADMIN_PASSWORD },
          body: JSON.stringify({ status: next }),
        }
      );
      if (!r.ok) {
        setDeliveries(prev);
        const j = await r.json().catch(() => ({}));
        alert(`Failed to update: ${j.error ?? r.status}`);
      } else {
        fetchDeliveries();
        onChanged();
      }
    } catch {
      setDeliveries(prev);
    }
  };

  const dayLabel = DAY_LABELS[subscription.day_of_week] ?? subscription.day_of_week;
  const freqLabel = subscription.frequency === "bi-weekly" ? "Every 2 weeks" : "Weekly";
  const addr = subscription.delivery_address ?? {};
  const addrLine = [addr.line1, addr.line2, addr.city, addr.pincode].filter(Boolean).join(", ");
  const c = SUB_STATUS_COLORS[subscription.status] ?? SUB_STATUS_COLORS.active;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.7)",
        display: "flex", justifyContent: "flex-end",
      }}
    >
      <div style={{
        width: "min(620px, 100%)",
        height: "100dvh",
        background: "#0e0e0e",
        borderLeft: "1px solid rgba(245,158,11,0.25)",
        overflowY: "auto",
        padding: "28px 28px 60px",
        color: "#fbf3d4",
        fontFamily: "var(--font-body)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <p style={{ margin: 0, fontSize: "0.65rem", letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(245,158,11,0.75)" }}>
              Subscription
            </p>
            <p style={{ margin: "4px 0 0", fontFamily: "var(--font-heading)", fontSize: "1.5rem", fontWeight: 300, letterSpacing: "0.04em" }}>
              {subscription.product_name} × {subscription.quantity_per_delivery}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "rgba(251,243,212,0.55)" }}>
              {subscription.customer?.full_name ?? "—"} · {subscription.customer?.phone ?? "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent", border: "none",
              color: "rgba(251,243,212,0.55)",
              fontSize: 18, cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{
          background: c.bg,
          border: `1px solid ${c.bd}`,
          padding: "14px 16px",
          marginBottom: 18,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.6rem", letterSpacing: "0.3em", textTransform: "uppercase", color: c.fg }}>
              Overall status
            </span>
            <select
              value={subscription.status}
              onChange={(e) => updateOverallStatus(e.target.value)}
              style={{
                background: "rgba(0,0,0,0.4)",
                color: c.fg,
                border: `1px solid ${c.bd}`,
                padding: "5px 10px",
                fontFamily: "var(--font-body)",
                fontSize: "0.72rem",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {SUB_STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.6rem", letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.5)" }}>
              Payment
            </span>
            <select
              value={subscription.payment_status}
              onChange={(e) => updatePaymentStatus(e.target.value)}
              style={{
                background: "rgba(0,0,0,0.4)",
                color: "#fbf3d4",
                border: "1px solid rgba(245,158,11,0.4)",
                padding: "5px 10px",
                fontFamily: "var(--font-body)",
                fontSize: "0.72rem",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {["pending", "paid", "refunded"].map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
            <span style={{ color: "rgba(251,243,212,0.5)" }}>Plan</span>
            <span>{freqLabel} · {dayLabel} · {subscription.time_slot}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
            <span style={{ color: "rgba(251,243,212,0.5)" }}>Total</span>
            <span>₹{Number(subscription.total_amount).toLocaleString("en-IN")} · {subscription.total_weeks} weeks</span>
          </div>
          {addrLine && (
            <div style={{ fontSize: "0.75rem", color: "rgba(251,243,212,0.55)", lineHeight: 1.5 }}>
              {addr.name ? <><b style={{ color: "#fbf3d4", fontWeight: 500 }}>{addr.name}</b><br /></> : null}
              {addrLine}
            </div>
          )}
        </div>

        <p style={{ margin: "0 0 14px", fontSize: "0.6rem", letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(245,158,11,0.75)" }}>
          Deliveries · {deliveries.length}
        </p>

        {loading && <p style={{ color: "rgba(251,243,212,0.45)" }}>Loading…</p>}
        {error && <p style={{ color: "#e05a5a" }}>Error: {error}</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {deliveries.map((d) => (
            <div
              key={d.id}
              style={{
                border: "1px solid rgba(245,158,11,0.2)",
                background: "rgba(245,158,11,0.03)",
                padding: "12px 14px",
                display: "flex", flexDirection: "column", gap: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.65rem", letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(245,158,11,0.75)" }}>
                  Week {d.week_number}
                </span>
                <select
                  value={d.status}
                  onChange={(e) => updateDeliveryStatus(d.id, e.target.value)}
                  style={{
                    background: "rgba(0,0,0,0.4)",
                    color: "#fbf3d4",
                    border: "1px solid rgba(245,158,11,0.4)",
                    padding: "4px 8px",
                    fontFamily: "var(--font-body)",
                    fontSize: "0.7rem",
                    letterSpacing: "0.12em",
                    cursor: "pointer",
                  }}
                >
                  {DELIVERY_STATUS_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{DELIVERY_STATUS_LABELS[opt] ?? opt}</option>
                  ))}
                </select>
              </div>
              <div style={{ fontSize: "0.85rem", color: "#fbf3d4" }}>
                {formatScheduledDate(d.scheduled_date)}
                <span style={{ color: "rgba(251,243,212,0.5)" }}> · {d.scheduled_time_slot}</span>
              </div>
              {d.status_updated_at && (
                <div style={{ fontSize: "0.65rem", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(251,243,212,0.35)" }}>
                  Updated · {new Date(d.status_updated_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                </div>
              )}
              {d.admin_notes && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {d.admin_notes.includes("[user edit") && (
                    <span
                      style={{
                        alignSelf: "flex-start",
                        fontSize: "0.6rem",
                        letterSpacing: "0.2em",
                        textTransform: "uppercase",
                        color: "#7bd88f",
                        border: "1px solid rgba(123,216,143,0.5)",
                        padding: "2px 8px",
                        borderRadius: 999,
                      }}
                    >
                      ✎ User edited
                    </span>
                  )}
                  <div style={{ fontSize: "0.75rem", color: "rgba(251,243,212,0.6)", fontStyle: "italic", whiteSpace: "pre-wrap" }}>
                    Notes: {d.admin_notes}
                  </div>
                </div>
              )}
            </div>
          ))}

          {!loading && deliveries.length === 0 && !error && (
            <p style={{ color: "rgba(251,243,212,0.45)", fontSize: "0.78rem" }}>
              No deliveries scheduled.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ChangeRequestsSection({
  requests,
  onChanged,
}: {
  requests: ChangeRequest[];
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const filtered = filter === "all" ? requests : requests.filter((r) => r.status === filter);

  // Recent (last 7 days) — resolved requests only, surfaced when viewing pending.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const recentResolved = requests.filter((r) => {
    if (r.status !== "approved" && r.status !== "rejected") return false;
    return Date.now() - new Date(r.created_at).getTime() < SEVEN_DAYS_MS;
  });

  const act = async (id: string, action: "approve" | "reject") => {
    const response = (responses[id] ?? "").trim();
    if (action === "reject" && !response) {
      setErrors((e) => ({ ...e, [id]: "A response is required when rejecting." }));
      return;
    }
    setErrors((e) => ({ ...e, [id]: "" }));
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const r = await fetch(`/api/admin/change-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-token": ADMIN_PASSWORD },
        body: JSON.stringify({ action, admin_response: response || null }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(`Failed: ${j.error ?? r.status}`);
        return;
      }
      onChanged();
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  return (
    <section className="px-8 py-8">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 16, marginBottom: 18 }}>
        <h2
          className="uppercase"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "1.25rem",
            letterSpacing: "0.3em",
            color: "#fbf3d4",
            fontWeight: 300,
            margin: 0,
          }}
        >
          Change Requests
        </h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["pending", "approved", "rejected", "all"] as const).map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className="uppercase"
                style={{
                  background: active ? "rgba(245,158,11,0.15)" : "transparent",
                  border: `1px solid ${active ? "rgba(245,158,11,0.7)" : "rgba(245,158,11,0.25)"}`,
                  color: active ? "#fbf3d4" : "rgba(251,243,212,0.55)",
                  padding: "6px 14px",
                  fontFamily: "var(--font-body)",
                  fontSize: "0.65rem",
                  letterSpacing: "0.22em",
                  cursor: "pointer",
                }}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p style={{ color: "rgba(192,200,206,0.5)", fontFamily: "var(--font-body)", fontSize: "0.85rem" }}>
          No {filter === "all" ? "" : filter + " "}change requests.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {filtered.map((r) => {
            const isPending = r.status === "pending";
            const statusColor =
              r.status === "approved" ? "#7bd88f" :
              r.status === "rejected" ? "#ff8181" :
              "#e3b341";
            return (
              <div
                key={r.id}
                style={{
                  border: "1px solid rgba(245,158,11,0.18)",
                  background: "rgba(245,158,11,0.03)",
                  padding: "16px 18px",
                  display: "grid",
                  gap: 10,
                  fontFamily: "var(--font-body)",
                  color: "#fbf3d4",
                  fontSize: "0.82rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: "1rem", letterSpacing: "0.04em" }}>
                      {r.subscription?.product_name ?? "—"}
                    </div>
                    <div style={{ marginTop: 4, color: "rgba(251,243,212,0.6)", fontSize: "0.78rem" }}>
                      {r.customer?.full_name ?? "—"} · {r.customer?.phone ?? "—"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <ContactMenu
                      customerName={r.customer?.full_name ?? null}
                      phone={r.customer?.phone ?? null}
                      productName={r.subscription?.product_name ?? null}
                      weekNumber={r.delivery?.week_number ?? null}
                    />
                    <span
                      className="uppercase"
                      style={{
                        color: statusColor,
                        border: `1px solid ${statusColor}`,
                        padding: "4px 12px",
                        fontSize: "0.6rem",
                        letterSpacing: "0.22em",
                      }}
                    >
                      {r.status}
                    </span>
                  </div>
                </div>

                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  fontSize: "0.78rem",
                  paddingTop: 6,
                  borderTop: "1px solid rgba(245,158,11,0.1)",
                }}>
                  <div>
                    <div style={{ fontSize: "0.6rem", letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(251,243,212,0.45)", marginBottom: 4 }}>
                      Original
                    </div>
                    {r.delivery ? (
                      <>
                        <div>Week {r.delivery.week_number}</div>
                        <div style={{ color: "rgba(251,243,212,0.7)" }}>
                          {formatScheduledDate(r.delivery.scheduled_date)}
                        </div>
                        <div style={{ color: "rgba(251,243,212,0.5)", fontSize: "0.72rem" }}>
                          {r.delivery.scheduled_time_slot}
                        </div>
                      </>
                    ) : <span style={{ color: "rgba(251,243,212,0.5)" }}>—</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: "0.6rem", letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(245,158,11,0.7)", marginBottom: 4 }}>
                      Requested
                    </div>
                    {r.requested_date && (
                      <div style={{ color: "rgba(251,243,212,0.85)" }}>
                        {formatScheduledDate(r.requested_date)}
                      </div>
                    )}
                    {r.requested_time_slot && (
                      <div style={{ color: "rgba(251,243,212,0.6)", fontSize: "0.72rem" }}>
                        {r.requested_time_slot}
                      </div>
                    )}
                    {!r.requested_date && !r.requested_time_slot && (
                      <span style={{ color: "rgba(251,243,212,0.5)" }}>—</span>
                    )}
                  </div>
                </div>

                {r.reason && (
                  <div style={{ fontSize: "0.78rem", color: "rgba(251,243,212,0.7)", fontStyle: "italic", borderLeft: "2px solid rgba(245,158,11,0.4)", paddingLeft: 10 }}>
                    "{r.reason}"
                  </div>
                )}

                {!isPending && r.admin_response && (
                  <div style={{ fontSize: "0.75rem", color: "rgba(251,243,212,0.6)" }}>
                    <span style={{ color: "rgba(245,158,11,0.7)" }}>Response:</span> {r.admin_response}
                  </div>
                )}

                {isPending && (
                  <>
                    <textarea
                      placeholder="Response to customer (required to reject)…"
                      value={responses[r.id] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setResponses((vs) => ({ ...vs, [r.id]: v }));
                        if (errors[r.id]) setErrors((es) => ({ ...es, [r.id]: "" }));
                      }}
                      rows={2}
                      style={{
                        width: "100%",
                        background: "rgba(0,0,0,0.4)",
                        border: `1px solid ${errors[r.id] ? "rgba(255,129,129,0.7)" : "rgba(245,158,11,0.25)"}`,
                        color: "#fbf3d4",
                        padding: "8px 10px",
                        fontFamily: "var(--font-body)",
                        fontSize: "0.78rem",
                        resize: "vertical",
                      }}
                    />
                    {errors[r.id] && (
                      <div style={{ color: "#ff8181", fontSize: "0.72rem" }}>
                        {errors[r.id]}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        disabled={busy[r.id]}
                        onClick={() => act(r.id, "reject")}
                        className="uppercase"
                        style={{
                          background: "transparent",
                          border: "1px solid rgba(255,129,129,0.55)",
                          color: "#ff8181",
                          padding: "6px 14px",
                          fontFamily: "var(--font-body)",
                          fontSize: "0.65rem",
                          letterSpacing: "0.2em",
                          cursor: busy[r.id] ? "not-allowed" : "pointer",
                          opacity: busy[r.id] ? 0.5 : 1,
                        }}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={busy[r.id]}
                        onClick={() => act(r.id, "approve")}
                        className="uppercase"
                        style={{
                          background: "rgba(123,216,143,0.12)",
                          border: "1px solid rgba(123,216,143,0.55)",
                          color: "#7bd88f",
                          padding: "6px 14px",
                          fontFamily: "var(--font-body)",
                          fontSize: "0.65rem",
                          letterSpacing: "0.2em",
                          cursor: busy[r.id] ? "not-allowed" : "pointer",
                          opacity: busy[r.id] ? 0.5 : 1,
                        }}
                      >
                        Approve
                      </button>
                    </div>
                  </>
                )}

                <div style={{ fontSize: "0.7rem", color: "rgba(251,243,212,0.4)" }}>
                  Submitted {new Date(r.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {filter === "pending" && recentResolved.length > 0 && (
        <div style={{ marginTop: 36 }}>
          <h3
            className="uppercase"
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "0.95rem",
              letterSpacing: "0.3em",
              color: "rgba(251,243,212,0.65)",
              fontWeight: 300,
              margin: "0 0 12px",
            }}
          >
            Recent · last 7 days
          </h3>
          <div style={{ display: "grid", gap: 8 }}>
            {recentResolved.map((r) => {
              const sc = r.status === "approved" ? "#7bd88f" : "#ff8181";
              return (
                <div
                  key={r.id}
                  style={{
                    border: "1px solid rgba(245,158,11,0.12)",
                    background: "rgba(255,255,255,0.015)",
                    padding: "10px 14px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    fontFamily: "var(--font-body)",
                    color: "rgba(251,243,212,0.75)",
                    fontSize: "0.78rem",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ color: "#fbf3d4" }}>
                      {r.subscription?.product_name ?? "—"}
                      {r.delivery ? ` · Week ${r.delivery.week_number}` : ""}
                    </span>
                    <span style={{ color: "rgba(251,243,212,0.5)", fontSize: "0.72rem" }}>
                      {r.customer?.full_name ?? "—"} ·{" "}
                      {new Date(r.created_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </div>
                  <span
                    className="uppercase"
                    style={{
                      color: sc,
                      border: `1px solid ${sc}`,
                      padding: "3px 10px",
                      fontSize: "0.58rem",
                      letterSpacing: "0.22em",
                    }}
                  >
                    {r.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function ContactMenu({
  customerName,
  phone,
  productName,
  weekNumber,
}: {
  customerName: string | null;
  phone: string | null;
  productName: string | null;
  weekNumber: number | null;
}) {
  const [open, setOpen] = useState(false);

  if (!phone) return null;

  // Strip non-digits for tel:/wa.me. wa.me requires country code with no '+'.
  const digits = phone.replace(/\D/g, "");
  // If 10 digits (Indian local), prefix 91 for WhatsApp.
  const waPhone = digits.length === 10 ? `91${digits}` : digits;

  const name = customerName ?? "there";
  const product = productName ?? "your subscription";
  const weekText = weekNumber ? ` for Week ${weekNumber}` : "";
  const message = `Hi ${name}, regarding your subscription change request${weekText} of ${product}...`;
  const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`;
  const telUrl = `tel:${digits}`;

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="uppercase"
        style={{
          background: "transparent",
          border: "1px solid rgba(245,158,11,0.45)",
          color: "#f59e0b",
          padding: "4px 12px",
          fontFamily: "var(--font-body)",
          fontSize: "0.6rem",
          letterSpacing: "0.22em",
          cursor: "pointer",
        }}
      >
        Contact ▾
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 6px)",
              zIndex: 51,
              background: "#1a1410",
              border: "1px solid rgba(245,158,11,0.35)",
              minWidth: 160,
              boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
            }}
          >
            <a
              href={telUrl}
              onClick={() => setOpen(false)}
              style={{
                display: "block",
                padding: "10px 14px",
                color: "#fbf3d4",
                textDecoration: "none",
                fontFamily: "var(--font-body)",
                fontSize: "0.78rem",
                borderBottom: "1px solid rgba(245,158,11,0.15)",
              }}
            >
              📞 Call {phone}
            </a>
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              style={{
                display: "block",
                padding: "10px 14px",
                color: "#7bd88f",
                textDecoration: "none",
                fontFamily: "var(--font-body)",
                fontSize: "0.78rem",
              }}
            >
              💬 WhatsApp
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-3 py-3" style={{ fontWeight: 400 }}>
      {children}
    </th>
  );
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td
      className="px-3 py-3 align-middle"
      style={{
        fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "var(--font-body)",
        color: "rgba(251,243,212,0.85)",
        fontSize: "0.8rem",
      }}
    >
      {children}
    </td>
  );
}

function StatusBadge({
  value,
  onChange,
}: {
  value: Status;
  onChange: (next: Status) => void;
}) {
  return (
    <div
      className="inline-flex items-center"
      style={{
        border: "1px solid rgba(245, 158, 11, 0.45)",
        background: "rgba(245, 158, 11, 0.08)",
      }}
    >
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Status)}
        className="bg-transparent outline-none px-3 py-1"
        style={{
          color: "#f59e0b",
          fontFamily: "var(--font-body)",
          fontSize: "0.7rem",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          appearance: "none",
        }}
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s} style={{ background: "rgb(6,4,2)", color: "#f59e0b" }}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}

function SendWhatsAppButton({
  state,
  disabled,
  onClick,
}: {
  state: SendState;
  disabled?: boolean;
  onClick: () => void;
}) {
  const label = state === "sending" ? "Sending…" : state === "sent" ? "Sent ✓" : state === "error" ? "Failed" : "Send";
  const color =
    state === "sent" ? "#22c55e" :
    state === "error" ? "#ef4444" :
    state === "sending" ? "rgba(245,158,11,0.5)" :
    "#25D366";
  const borderColor =
    state === "sent" ? "rgba(34,197,94,0.6)" :
    state === "error" ? "rgba(239,68,68,0.6)" :
    state === "sending" ? "rgba(245,158,11,0.3)" :
    "rgba(37,211,102,0.55)";
  return (
    <button
      type="button"
      disabled={disabled || state === "sending"}
      onClick={onClick}
      className="inline-flex items-center gap-1 uppercase"
      style={{
        border: `1px solid ${borderColor}`,
        color,
        fontFamily: "var(--font-body)",
        fontSize: "0.6rem",
        letterSpacing: "0.2em",
        padding: "4px 10px",
        background: "transparent",
        cursor: disabled || state === "sending" ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
      }}
      title={disabled ? "No phone or status is Pending" : "Send WhatsApp message for current status"}
    >
      <span aria-hidden>💬</span>
      {label}
    </button>
  );
}

function splitAddressAndPincode(address: string | null | undefined): { base: string; pincode: string } {
  const text = (address ?? "").trim();
  if (!text) return { base: "", pincode: "" };
  const m = text.match(/^(.*?)[\s,-]*(\d{6})\s*$/);
  if (m) return { base: m[1].replace(/[\s,-]+$/, "").trim(), pincode: m[2] };
  return { base: text, pincode: "" };
}

function EditCustomerModal({
  order,
  onClose,
  onSaved,
}: {
  order: Order;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = splitAddressAndPincode(order.delivery_address);
  const [fullName, setFullName] = useState(order.customers?.full_name ?? "");
  const [phone, setPhone] = useState(order.customers?.phone ?? "");
  const [address, setAddress] = useState(initial.base);
  const [city, setCity] = useState(order.customers?.city ?? "");
  const [pincode, setPincode] = useState(initial.pincode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const customerId = order.customer_id;

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!customerId) {
      setError("Missing customer id for this order.");
      return;
    }
    setSaving(true);
    setError("");

    const newDeliveryAddress = pincode.trim()
      ? `${address.trim()} - ${pincode.trim()}`
      : address.trim();

    const custRes = await fetch(`/api/admin/customers/${customerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-token": ADMIN_PASSWORD },
      body: JSON.stringify({
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        city: city.trim() || null,
      }),
    });
    if (!custRes.ok) {
      const j = await custRes.json().catch(() => ({}));
      setSaving(false);
      setError(j.error || "Failed to update customer");
      return;
    }

    const orderRes = await fetch(`/api/admin/orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-token": ADMIN_PASSWORD },
      body: JSON.stringify({ delivery_address: newDeliveryAddress }),
    });
    if (!orderRes.ok) {
      const j = await orderRes.json().catch(() => ({}));
      setSaving(false);
      setError(j.error || "Failed to update order address");
      return;
    }

    const message = `Hi ${fullName.trim() || "Customer"}! 📋 Your Cadieux account details have been updated by our team.\n\nName: ${fullName.trim()}\nAddress: ${address.trim()}, ${city.trim()} - ${pincode.trim()}\n\nIf you did not request this change please contact us immediately. Thank you! 🍞`;

    if (phone.trim()) {
      const editedAddress = `${address.trim()}, ${city.trim()} - ${pincode.trim()}`;
      // SMS — primary
      try {
        await fetch("/api/send-sms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "customer_edit",
            phone: phone.trim(),
            name: fullName.trim() || "Customer",
            address: editedAddress,
          }),
        });
      } catch {
        /* silent */
      }
      // WhatsApp — secondary bonus
      try {
        await fetch("/api/send-whatsapp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: phone.trim(), message }),
        });
      } catch {
        /* silent */
      }
    }

    setSaving(false);
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSave}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md flex flex-col gap-4 p-8 relative"
        style={{
          background: "rgb(6,4,2)",
          border: "1px solid rgba(245, 158, 11, 0.45)",
        }}
      >
        <div className="flex items-center justify-between">
          <h2
            className="uppercase"
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "1.25rem",
              letterSpacing: "0.25em",
              color: "#fbf3d4",
              fontWeight: 300,
            }}
          >
            Edit Customer
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              color: "rgba(245, 158, 11, 0.7)",
              background: "transparent",
              border: "none",
              fontSize: "1.25rem",
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <Field label="Full Name" value={fullName} onChange={setFullName} />
        <Field label="Phone Number" value={phone} onChange={setPhone} />
        <Field label="Delivery Address" value={address} onChange={setAddress} multiline />
        <Field label="City" value={city} onChange={setCity} />
        <Field label="Pincode" value={pincode} onChange={setPincode} />

        {error && (
          <p style={{ color: "#ef4444", fontFamily: "var(--font-body)", fontSize: "0.75rem" }}>
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-4 py-3 uppercase"
            style={{
              border: "1px solid #f59e0b",
              color: "#f59e0b",
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              background: "transparent",
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-3 uppercase"
            style={{
              border: "1px solid rgba(192,200,206,0.25)",
              color: "rgba(192,200,206,0.7)",
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  const common = {
    className: "w-full px-3 py-2 bg-transparent outline-none",
    style: {
      border: "1px solid rgba(245, 158, 11, 0.35)",
      color: "#fbf3d4",
      fontFamily: "var(--font-body)",
      fontSize: "0.85rem",
      letterSpacing: "0.03em",
    } as React.CSSProperties,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
  };
  return (
    <label className="flex flex-col gap-1">
      <span
        className="uppercase"
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.6rem",
          letterSpacing: "0.25em",
          color: "rgba(245,158,11,0.75)",
        }}
      >
        {label}
      </span>
      {multiline ? <textarea rows={2} {...common} /> : <input type="text" {...common} />}
    </label>
  );
}

function FeedbackSection({ reviews, onChanged }: { reviews: Review[]; onChanged: () => void }) {
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const adminToken = ADMIN_PASSWORD;

  const deleteReview = async (id: string) => {
    if (!confirm("Delete this review and all its replies?")) return;
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const r = await fetch(`/api/reviews/${id}`, {
        method: "DELETE",
        headers: { "x-admin-token": adminToken },
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      onChanged();
    } catch (e: any) {
      alert(`Failed to delete review: ${e?.message ?? e}`);
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const deleteReply = async (reviewId: string, replyId: string) => {
    if (!confirm("Delete this reply?")) return;
    try {
      const r = await fetch(`/api/reviews/${reviewId}/replies/${replyId}`, {
        method: "DELETE",
        headers: { "x-admin-token": adminToken },
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      onChanged();
    } catch (e: any) {
      alert(`Failed to delete reply: ${e?.message ?? e}`);
    }
  };

  const submitReply = async (reviewId: string) => {
    const body = (replyDraft[reviewId] ?? "").trim();
    if (!body) return;
    setBusy((b) => ({ ...b, [`reply-${reviewId}`]: true }));
    try {
      const r = await fetch(`/api/reviews/${reviewId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
        body: JSON.stringify({ author_name: "Cadieux", body, is_admin: true }),
      });
      if (!r.ok) throw new Error("post failed");
      setReplyDraft((d) => ({ ...d, [reviewId]: "" }));
      onChanged();
    } catch {
      alert("Failed to post reply");
    } finally {
      setBusy((b) => ({ ...b, [`reply-${reviewId}`]: false }));
    }
  };

  return (
    <section className="px-8 py-8">
      <h2
        className="uppercase mb-6"
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: "1.25rem",
          letterSpacing: "0.3em",
          color: "#fbf3d4",
          fontWeight: 300,
        }}
      >
        Feedback
      </h2>
      {reviews.length === 0 ? (
        <p style={{ color: "rgba(192,200,206,0.5)", fontFamily: "var(--font-body)", fontSize: "0.85rem" }}>
          No feedback yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {reviews.map((rev) => (
            <div
              key={rev.id}
              style={{
                padding: 18,
                background: "rgba(10,8,5,0.5)",
                border: "1px solid rgba(245,158,11,0.18)",
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ color: "#fbf3d4", fontFamily: "var(--font-heading)", fontSize: "1rem", fontWeight: 500 }}>{rev.author_name}</strong>
                  {rev.product_slug && (
                    <span style={{ fontFamily: "var(--font-body)", fontSize: "0.6rem", letterSpacing: "0.25em", textTransform: "uppercase", color: "#c9a96e", border: "1px solid rgba(201,169,110,0.4)", borderRadius: 99, padding: "2px 8px" }}>
                      {rev.product_slug}
                    </span>
                  )}
                  {rev.rating != null && (
                    <span style={{ color: "#c9a96e", fontFamily: "var(--font-body)", fontSize: "0.85rem" }}>
                      {"★".repeat(rev.rating)}{"☆".repeat(5 - rev.rating)}
                    </span>
                  )}
                  <span style={{ fontFamily: "var(--font-body)", fontSize: "0.7rem", color: "rgba(192,200,206,0.5)" }}>
                    ♥ {rev.likes_count}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: "0.7rem", color: "rgba(192,200,206,0.5)" }}>
                    {new Date(rev.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <button
                    onClick={() => deleteReview(rev.id)}
                    disabled={busy[rev.id]}
                    className="uppercase"
                    style={{
                      border: "1px solid rgba(239,68,68,0.5)",
                      color: "#ef4444",
                      fontFamily: "var(--font-body)",
                      fontSize: "0.6rem",
                      letterSpacing: "0.2em",
                      padding: "4px 10px",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p style={{ margin: 0, color: "rgba(251,243,212,0.85)", fontFamily: "var(--font-body)", fontSize: "0.85rem", lineHeight: 1.6 }}>
                {rev.body}
              </p>

              {rev.replies.length > 0 && (
                <div style={{ marginTop: 12, paddingLeft: 14, borderLeft: "1px solid rgba(245,158,11,0.2)", display: "flex", flexDirection: "column", gap: 8 }}>
                  {rev.replies.map((rp) => (
                    <div key={rp.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 2 }}>
                          <strong style={{ color: "#fbf3d4", fontFamily: "var(--font-heading)", fontSize: "0.85rem" }}>{rp.author_name}</strong>
                          {rp.is_admin && (
                            <span style={{ fontFamily: "var(--font-body)", fontSize: "0.55rem", letterSpacing: "0.25em", textTransform: "uppercase", color: "#FBF3D4", background: "rgba(201,169,110,0.22)", border: "1px solid rgba(201,169,110,0.5)", borderRadius: 99, padding: "1px 7px" }}>
                              Cadieux Team
                            </span>
                          )}
                          <span style={{ fontFamily: "var(--font-body)", fontSize: "0.65rem", color: "rgba(192,200,206,0.4)" }}>
                            ♥ {rp.likes_count}
                          </span>
                        </div>
                        <p style={{ margin: 0, color: "rgba(251,243,212,0.78)", fontFamily: "var(--font-body)", fontSize: "0.78rem", lineHeight: 1.55 }}>
                          {rp.body}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteReply(rev.id, rp.id)}
                        className="uppercase"
                        style={{
                          border: "1px solid rgba(239,68,68,0.4)",
                          color: "#ef4444",
                          fontFamily: "var(--font-body)",
                          fontSize: "0.55rem",
                          letterSpacing: "0.2em",
                          padding: "2px 8px",
                          background: "transparent",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-start" }}>
                <textarea
                  value={replyDraft[rev.id] ?? ""}
                  onChange={(e) => setReplyDraft((d) => ({ ...d, [rev.id]: e.target.value }))}
                  placeholder="Reply as Cadieux..."
                  rows={2}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    background: "rgba(6,4,2,0.6)",
                    border: "1px solid rgba(245,158,11,0.25)",
                    borderRadius: 4,
                    color: "#fbf3d4",
                    fontFamily: "var(--font-body)",
                    fontSize: "0.8rem",
                    resize: "vertical",
                  }}
                />
                <button
                  onClick={() => submitReply(rev.id)}
                  disabled={busy[`reply-${rev.id}`]}
                  className="uppercase"
                  style={{
                    border: "1px solid rgba(245,158,11,0.5)",
                    color: "#f59e0b",
                    fontFamily: "var(--font-body)",
                    fontSize: "0.65rem",
                    letterSpacing: "0.25em",
                    padding: "8px 14px",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  Reply
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
