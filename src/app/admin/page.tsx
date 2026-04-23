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
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});

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

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel("orders-admin")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => {
          fetchOrders();
        }
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchOrders]);

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

      <section className="px-8 py-8">
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
