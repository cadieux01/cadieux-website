import { NextRequest, NextResponse } from "next/server";
import { sendSMS } from "@/lib/msg91";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMessage(body: Record<string, any>): string | null {
  const name = String(body.name ?? "Customer");
  const type = String(body.type ?? "");

  if (type === "order_placed") {
    const orderId = String(body.orderId ?? "").slice(0, 8).toUpperCase();
    const total = body.total ?? "";
    const address = body.address ?? "";
    return (
      `Hi ${name}! Your Cadieux order #${orderId} has been placed.\n` +
      `Total: Rs.${total}\n` +
      `Delivery to: ${address}\n` +
      `We will confirm shortly. Thank you!`
    );
  }

  if (type === "status_change") {
    const orderId = String(body.orderId ?? "").slice(0, 8).toUpperCase();
    const status = String(body.status ?? "");
    switch (status) {
      case "Confirmed":
        return `Hi ${name}! Your Cadieux order #${orderId} is confirmed. We are preparing your fresh bread.`;
      case "Dispatched":
        return `Hi ${name}! Your Cadieux order #${orderId} is on the way! Our delivery partner will reach you soon.`;
      case "Delivered":
        return `Hi ${name}! Your Cadieux order #${orderId} has been delivered! Enjoy your fresh bread. Thank you for choosing Cadieux.`;
      default:
        return null;
    }
  }

  if (type === "customer_edit") {
    const address = String(body.address ?? "");
    return (
      `Hi ${name}! Your Cadieux account details have been updated.\n` +
      `Name: ${name}\n` +
      `Address: ${address}\n` +
      `If you did not request this change, contact us immediately.`
    );
  }

  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "");

  if (!phone) {
    return NextResponse.json({ error: "Missing phone" }, { status: 400 });
  }

  const message = buildMessage(body);
  if (!message) {
    return NextResponse.json({ error: "Invalid type or status" }, { status: 400 });
  }

  const result = await sendSMS(phone, message);
  if (!result.ok) {
    console.error("MSG91 SMS error:", result.error);
    return NextResponse.json({ error: result.error || "MSG91 send failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
