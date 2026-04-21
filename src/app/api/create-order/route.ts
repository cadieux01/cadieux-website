import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { amount } = await req.json().catch(() => ({ amount: 0 }));
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key || !secret) {
    return NextResponse.json({ error: "Razorpay not configured" }, { status: 503 });
  }

  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount,
      currency: "INR",
      receipt: `cadieux_${Date.now()}`,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json({ error: data.error?.description ?? "Razorpay error" }, { status: 500 });
  }

  return NextResponse.json({
    order_id: data.id,
    amount: data.amount,
    currency: data.currency,
  });
}
