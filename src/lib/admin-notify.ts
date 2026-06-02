// Client-side helpers for sending status-change notifications from the
// admin UI. Wraps the existing Twilio-backed /api/send-whatsapp and
// /api/send-sms endpoints. These mirror what the legacy
// /admin/legacy/page.tsx used so the WhatsApp/SMS copy stays identical
// to what customers have always received.
//
// These endpoints accept an admin caller, so they need the admin bearer
// token (via adminAuthHeaders) + credentials:"include" — otherwise they
// fall back to the cookie, which Safari ITP drops.

import { adminAuthHeaders } from "@/lib/admin-client";

export type OrderNotifyStatus =
  | "Pending"
  | "Confirmed"
  | "Dispatched"
  | "Delivered";

export function buildWhatsAppStatusMessage(
  name: string,
  status: OrderNotifyStatus,
): string | null {
  const n = name?.trim() || "Customer";
  switch (status) {
    case "Confirmed":
      return `Hi ${n}! ✅ Your Cadieux order has been confirmed! We are preparing your fresh bread. 🍞`;
    case "Dispatched":
      return `Hi ${n}! 🚚 Your Cadieux order is on the way! Our delivery partner will reach you soon.`;
    case "Delivered":
      return `Hi ${n}! 🎉 Your Cadieux order has been delivered! Enjoy your fresh bread. Thank you for choosing Cadieux. 🍞`;
    default:
      return null;
  }
}

/** Fire-and-forget — never throws. Mirrors legacy mechanism. */
export async function sendOrderWhatsApp(
  phone: string,
  name: string,
  status: OrderNotifyStatus,
): Promise<{ ok: boolean; error?: string }> {
  const message = buildWhatsAppStatusMessage(name, status);
  if (!message) return { ok: false, error: "No template for status" };
  try {
    const res = await fetch("/api/send-whatsapp", {
      method: "POST",
      headers: adminAuthHeaders({ "Content-Type": "application/json" }),
      credentials: "include",
      body: JSON.stringify({ phone, message }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Fire-and-forget — never throws. */
export async function sendOrderStatusSMS(args: {
  phone: string;
  name: string;
  orderId: string;
  status: OrderNotifyStatus;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/send-sms", {
      method: "POST",
      headers: adminAuthHeaders({ "Content-Type": "application/json" }),
      credentials: "include",
      body: JSON.stringify({
        type: "status_change",
        phone: args.phone,
        name: args.name,
        orderId: args.orderId,
        status: args.status,
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Mirrors legacy customer_edit SMS template. */
export async function sendCustomerEditSMS(args: {
  phone: string;
  name: string;
  address: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/send-sms", {
      method: "POST",
      headers: adminAuthHeaders({ "Content-Type": "application/json" }),
      credentials: "include",
      body: JSON.stringify({
        type: "customer_edit",
        phone: args.phone,
        name: args.name,
        address: args.address,
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Maps lowercase DB status → capitalized notify status used by templates. */
export function toNotifyStatus(status: string | null): OrderNotifyStatus | null {
  switch ((status ?? "").toLowerCase()) {
    case "placed":
    case "pending":
      return "Pending";
    case "confirmed":
    case "preparing":
      return "Confirmed";
    case "out_for_delivery":
    case "dispatched":
      return "Dispatched";
    case "delivered":
      return "Delivered";
    default:
      return null;
  }
}
