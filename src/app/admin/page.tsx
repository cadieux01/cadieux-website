"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import { supabase } from "@/lib/supabase";

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

type Subscription = {
  id: string;
  bread_slug: string | null;
  bread_name: string | null;
  bread_price: number | null;
  weeks: number | null;
  days: string[] | null;
  slot_mode: string | null;
  slot: string | null;
  slots_by_day: Record<string, string> | null;
  total: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_pincode: string | null;
  status: string | null;
  created_at: string;
};

type Section = "orders" | "subscriptions" | "feedback";

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

const SESSION_KEY = "cadieux_admin_auth";
const PASSWORD = "cadieux2024";

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const v = sessionStorage.getItem(SESSION_KEY);
      if (v === "1") setAuthed(true);
    }
    setChecking(false);
  }, []);

  if (checking) return null;

  return (
    <main className="min-h-screen relative" style={{ background: "rgb(6,4,2)" }}>
      <GrainOverlay />
      {authed ? (
        <Dashboard onLogout={() => {
          sessionStorage.removeItem(SESSION_KEY);
          setAuthed(false);
        }} />
      ) : (
        <PasswordGate onSuccess={() => {
          sessionStorage.setItem(SESSION_KEY, "1");
          setAuthed(true);
        }} />
      )}
    </main>
  );
}

function GrainOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 opacity-[0.08] mix-blend-overlay"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.6'/></svg>\")",
      }}
    />
  );
}

function PasswordGate({ onSuccess }: { onSuccess: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value === PASSWORD) {
      setError("");
      onSuccess();
    } else {
      setError("Incorrect password");
    }
  };

  return (
    <div className="relative z-10 min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm flex flex-col gap-4"
      >
        <h1
          className="text-center uppercase"
          style={{
            fontFamily: "var(--font-heading)",
            color: "#fbf3d4",
            fontWeight: 300,
            fontSize: "clamp(2.75rem, 7vw, 4.5rem)",
            letterSpacing: "0.2em",
            lineHeight: 1,
          }}
        >
          Cadieux Admin
        </h1>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Password"
          className="w-full px-4 py-3 bg-transparent outline-none"
          style={{
            border: "1px solid rgba(245, 158, 11, 0.35)",
            color: "#fbf3d4",
            fontFamily: "var(--font-body)",
            letterSpacing: "0.1em",
            fontSize: "0.9rem",
          }}
        />
        <button
          type="submit"
          className="w-full px-4 py-3 uppercase"
          style={{
            border: "1px solid #f59e0b",
            color: "#f59e0b",
            fontFamily: "var(--font-body)",
            letterSpacing: "0.25em",
            fontSize: "0.75rem",
            background: "transparent",
          }}
        >
          Enter
        </button>
        {error && (
          <p
            className="text-center text-sm"
            style={{ color: "#ef4444", fontFamily: "var(--font-body)", letterSpacing: "0.1em" }}
          >
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});
  const [section, setSection] = useState<Section>("orders");
  const [menuOpen, setMenuOpen] = useState(false);

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("id, customer_id, total_amount, status, delivery_address, created_at, customers(id, full_name, phone, city)")
      .order("created_at", { ascending: false });
    if (!error && data) {
      setOrders(data as unknown as Order[]);
    }
    setLoading(false);
  }, []);

  const fetchSubscriptions = useCallback(async () => {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("id, bread_slug, bread_name, bread_price, weeks, days, slot_mode, slot, slots_by_day, total, customer_name, customer_phone, customer_address, customer_city, customer_pincode, status, created_at")
      .order("created_at", { ascending: false });
    if (!error && data) {
      setSubscriptions(data as unknown as Subscription[]);
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
    fetchReviews();

    const channel = supabase
      .channel("orders-admin")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => {
          fetchOrders();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions" },
        () => {
          fetchSubscriptions();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reviews" },
        () => {
          fetchReviews();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "review_replies" },
        () => {
          fetchReviews();
        }
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchOrders, fetchSubscriptions, fetchReviews]);

  const updateStatus = async (order: Order, newStatus: Status) => {
    const prev = orders;
    setOrders((curr) =>
      curr.map((o) => (o.id === order.id ? { ...o, status: newStatus.toLowerCase() } : o))
    );

    const { error } = await supabase
      .from("orders")
      .update({ status: newStatus.toLowerCase() })
      .eq("id", order.id);

    if (error) {
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
    <div className="relative z-10 min-h-screen">
      <header
        className="flex items-center justify-between px-8 py-6"
        style={{ borderBottom: "1px solid rgba(245, 158, 11, 0.15)" }}
      >
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu"
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
          <h1
            className="uppercase"
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "1.75rem",
              letterSpacing: "0.3em",
              color: "#fbf3d4",
              fontWeight: 300,
            }}
          >
            Admin
          </h1>
        </div>
        <div className="flex items-center gap-6">
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
          <button
            onClick={onLogout}
            className="px-4 py-2 uppercase"
            style={{
              border: "1px solid rgba(245, 158, 11, 0.45)",
              color: "#f59e0b",
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              background: "transparent",
            }}
          >
            Logout
          </button>
        </div>
      </header>

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
            {([
              { key: "orders", label: "General Payments" },
              { key: "subscriptions", label: "Subscriptions" },
              { key: "feedback", label: "Feedback" },
            ] as { key: Section; label: string }[]).map(({ key, label }) => (
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
                }}
              >
                {label}
              </button>
            ))}
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
          onChanged={fetchSubscriptions}
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

function SubscriptionsSection({
  subscriptions,
  onChanged,
}: {
  subscriptions: Subscription[];
  onChanged: () => void;
}) {
  const updateStatus = async (id: string, next: Status) => {
    const { error } = await supabase
      .from("subscriptions")
      .update({ status: next.toLowerCase() })
      .eq("id", id);
    if (!error) onChanged();
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
        Subscriptions
      </h2>
      {subscriptions.length === 0 ? (
        <p style={{ color: "rgba(192,200,206,0.5)", fontFamily: "var(--font-body)", fontSize: "0.85rem" }}>
          No subscriptions yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full border-collapse"
            style={{ fontFamily: "var(--font-body)", fontSize: "0.8rem", color: "#fbf3d4" }}
          >
            <thead>
              <tr style={{ color: "rgba(245,158,11,0.8)", letterSpacing: "0.2em", textTransform: "uppercase", fontSize: "0.65rem" }}>
                <Th>Sub ID</Th>
                <Th>Customer</Th>
                <Th>Phone</Th>
                <Th>Address</Th>
                <Th>Bread</Th>
                <Th>Weeks</Th>
                <Th>Days</Th>
                <Th>Timings</Th>
                <Th>Total</Th>
                <Th>Status</Th>
                <Th>Date</Th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((s, i) => {
                const status = (s.status ?? "pending").toLowerCase();
                const normalized = (STATUS_OPTIONS.find((o) => o.toLowerCase() === status) ?? "Pending") as Status;
                const displayNumber = String(subscriptions.length - i).padStart(5, "0");
                const dayList = (s.days ?? []).map((k) => DAY_LABELS[k] ?? k).join(", ");
                const timings = formatTimings(s);
                const fullAddress = [s.customer_address, s.customer_city, s.customer_pincode]
                  .filter(Boolean).join(", ");
                return (
                  <tr key={s.id} style={{ borderTop: "1px solid rgba(245, 158, 11, 0.12)" }}>
                    <Td mono>{displayNumber}</Td>
                    <Td>{s.customer_name ?? "—"}</Td>
                    <Td>{s.customer_phone ?? "—"}</Td>
                    <Td>{fullAddress || "—"}</Td>
                    <Td>
                      {s.bread_name ?? "—"}
                      {s.bread_price != null && (
                        <span style={{ color: "rgba(192,200,206,0.5)", marginLeft: 6, fontSize: "0.7rem" }}>
                          · ₹{s.bread_price}
                        </span>
                      )}
                    </Td>
                    <Td>{s.weeks ?? "—"}</Td>
                    <Td>{dayList || "—"}</Td>
                    <Td>{timings}</Td>
                    <Td>₹{Number(s.total ?? 0).toFixed(2)}</Td>
                    <Td>
                      <StatusBadge value={normalized} onChange={(next) => updateStatus(s.id, next)} />
                    </Td>
                    <Td>
                      {new Date(s.created_at).toLocaleString("en-IN", {
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
  );
}

function formatTimings(s: Subscription): string {
  if (s.slot_mode === "same") return s.slot ?? "—";
  if (s.slot_mode === "custom" && s.slots_by_day) {
    const parts = (s.days ?? []).map((k) => {
      const t = s.slots_by_day?.[k];
      return t ? `${DAY_LABELS[k] ?? k}: ${t}` : null;
    }).filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "—";
  }
  return "—";
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

    const { error: custErr } = await supabase
      .from("customers")
      .update({
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        city: city.trim() || null,
      })
      .eq("id", customerId);

    if (custErr) {
      setSaving(false);
      setError(custErr.message || "Failed to update customer");
      return;
    }

    const { error: orderErr } = await supabase
      .from("orders")
      .update({ delivery_address: newDeliveryAddress })
      .eq("id", order.id);

    if (orderErr) {
      setSaving(false);
      setError(orderErr.message || "Failed to update order address");
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

  const adminToken = PASSWORD;

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
