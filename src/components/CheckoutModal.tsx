"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PRODUCTS, type CartItem } from "@/lib/data";
import { DELIVERY_FEE_INR } from "@/lib/order-validation";
import {
  ORDER_DELIVERY_SLOTS,
  formatSlot12,
  formatDeliveryDate,
  getOrderDeliveryDateOptions,
} from "@/lib/order-delivery";
import TurnstileWidget, { type TurnstileHandle } from "./TurnstileWidget";
export type { CartItem } from "@/lib/data";

// Wizard stores day labels like "Monday"/"Tuesday"; subscription_deliveries
// stores 3-letter lowercase keys. Map by case-insensitive prefix.
const DAY_LABEL_TO_KEY: Record<string, string> = {
  mon: "mon", tue: "tue", wed: "wed", thu: "thu",
  fri: "fri", sat: "sat", sun: "sun",
};
function dayLabelToKey(label: string): string | null {
  const k = label.trim().toLowerCase().slice(0, 3);
  return DAY_LABEL_TO_KEY[k] ?? null;
}

// Best-effort split of "Line, Area, City - 530045" into { city, pincode }.
// Returns empty strings when the format doesn't match.
function extractCityPincode(full: string): { city: string; pincode: string } {
  const pinMatch = full.match(/(\d{6})\s*$/);
  const pincode = pinMatch?.[1] ?? "";
  const withoutPin = full.replace(/[\s,–\-]+\d{6}\s*$/, "").trim();
  const parts = withoutPin.split(",").map((p) => p.trim()).filter(Boolean);
  const city = parts.length >= 2 ? parts[parts.length - 1] : "";
  return { city, pincode };
}

type Step = "form" | "payment" | "done";
type FormMode = "returning" | "edit" | "fresh";

type Customer = {
  id?: string;
  full_name: string;
  phone: string;
  city: string;
  delivery_address: string;
};

const GRAIN =
  "url(/grain.svg)";

const inputSt: React.CSSProperties = {
  display: "block", width: "100%", boxSizing: "border-box",
  background: "transparent",
  border: "none", borderBottom: "1px solid rgba(240,223,200,0.18)",
  padding: "10px 0", outline: "none",
  fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200,
  color: "#FBF3D4", letterSpacing: "0.04em",
};

const labelSt: React.CSSProperties = {
  display: "block", marginBottom: 6,
  fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
  letterSpacing: "0.4em", textTransform: "uppercase",
  color: "rgba(200,144,58,0.65)",
};

const sectionHead: React.CSSProperties = {
  margin: "0 0 20px",
  fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
  letterSpacing: "0.5em", textTransform: "uppercase",
  color: "rgba(240,223,200,0.28)",
};

/* ── Main component ─────────────────────────────────────────────────────── */
export default function CheckoutModal({
  cart,
  total,
  onClose,
  onOrderPlaced,
}: {
  cart: CartItem[];
  total: number;
  onClose: () => void;
  onOrderPlaced: () => void;
}) {
  // `total` is the items subtotal; we charge customers — and store on the
  // order — the inclusive grand total below.
  const deliveryFee = DELIVERY_FEE_INR;
  const grandTotal = total + deliveryFee;

  // Snapshot of cart for the place_order body. Server re-derives every
  // `once` line price from the products table and rejects on mismatch,
  // so a tampered client price gets a 400 price_mismatch.
  const orderItems = cart.map((c) => ({
    slug: PRODUCTS[c.productIndex].slug,
    quantity: c.qty,
    kind: c.orderType,
    line_total_inr: c.price * c.qty,
  }));

  const [step, setStep] = useState<Step>("form");
  const [formMode, setFormMode] = useState<FormMode>("fresh");

  // Form fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [addressLine, setAddressLine] = useState("");
  const [area, setArea] = useState("");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [savedCustomer, setSavedCustomer] = useState<Customer | null>(null);

  // Loading states
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);

  // Errors
  const [error, setError] = useState("");
  const [otpError, setOtpError] = useState("");
  const [orderNum, setOrderNum] = useState("");

  // Delivery date + slot. Tomorrow (IST) by default; the customer can
  // bump to day-after. 14 hourly slots from 06:00 to 19:00.
  const [{ tomorrow: tomorrowIso, dayAfter: dayAfterIso }] = useState(() =>
    getOrderDeliveryDateOptions(),
  );
  const [deliveryDate, setDeliveryDate] = useState<string>(tomorrowIso);
  const [deliverySlot, setDeliverySlot] = useState<string>("");

  // Pincode serviceability. Effective pincode is taken from the editable
  // field for fresh/edit mode and from the saved address for returning.
  type PinState =
    | { state: "idle" }
    | { state: "checking" }
    | { state: "serviceable"; area_names: string[] }
    | { state: "unserviceable" }
    | { state: "error" };
  const [pinStatus, setPinStatus] = useState<PinState>({ state: "idle" });
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const router = useRouter();

  // Cloudflare Turnstile bot-protection token. Refreshed (reset) after every
  // protected request because Turnstile tokens are single-use.
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const turnstileRef = useRef<TurnstileHandle>(null);
  const refreshTurnstile = () => {
    setTurnstileToken("");
    turnstileRef.current?.reset();
  };

  /* ── Pre-fill on mount ─────────────────────────────────────────────────── */
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("cadieux_phone") : null;
    if (!saved) return;
    setPhone(saved);

    // Skip OTP if already verified this session
    const sessionPhone = sessionStorage.getItem("cadieux_verified_phone");
    if (sessionPhone === saved) setOtpVerified(true);

    // Load previous customer details
    fetch(`/api/checkout?phone=${encodeURIComponent(saved)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.customer) return;
        const c = d.customer as Customer;
        setSavedCustomer(c);
        setCustomer(c);
        setName(c.full_name ?? "");
        setCity(c.city ?? "");
        prefillAddress(c.delivery_address ?? "");
        setFormMode("returning");
      })
      .catch(() => {});
  }, []);

  // Effective pincode for serviceability — saved address for returning,
  // editable field for fresh/edit. We extract from saved address each
  // render so the effect below picks it up.
  const effectivePincode = (() => {
    if (formMode === "returning" && savedCustomer?.delivery_address) {
      return savedCustomer.delivery_address.match(/(\d{6})\s*$/)?.[1] ?? "";
    }
    return pincode;
  })();

  // Debounced serviceability check. Re-runs every time the effective
  // pincode reaches 6 digits.
  useEffect(() => {
    const pin = (effectivePincode || "").replace(/\D/g, "");
    if (pin.length !== 6) {
      setPinStatus({ state: "idle" });
      return;
    }
    setPinStatus({ state: "checking" });
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/service-areas/check?pincode=${pin}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d: { serviceable?: boolean; area_names?: string[] }) => {
          if (d.serviceable) {
            setPinStatus({
              state: "serviceable",
              area_names: Array.isArray(d.area_names) ? d.area_names : [],
            });
          } else {
            setPinStatus({ state: "unserviceable" });
          }
        })
        .catch((e) => {
          if ((e as { name?: string })?.name === "AbortError") return;
          setPinStatus({ state: "error" });
        });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [effectivePincode]);

  // Submit a delivery_request when the customer's pincode isn't yet
  // covered. We don't gate this on OTP — the request is essentially a
  // contact-form. After insert we route to /cart with a session flag so
  // the cart page can render the amber banner.
  async function submitDeliveryRequest() {
    setError("");
    setRequestSubmitting(true);
    try {
      // Resolve the address inputs across the two modes.
      const isReturning = formMode === "returning" && savedCustomer;
      const phoneDigits = (isReturning ? savedCustomer!.phone : phone).replace(/\D/g, "");
      const fullAddress = isReturning
        ? (savedCustomer!.delivery_address ?? "")
        : `${addressLine.trim()}, ${area.trim()}, ${city.trim()} - ${pincode.trim()}`;
      const pin =
        (isReturning
          ? fullAddress.match(/(\d{6})\s*$/)?.[1]
          : pincode.replace(/\D/g, "")) ?? "";
      const areaName = isReturning ? null : area.trim() || null;

      if (phoneDigits.length !== 10) {
        setError("Enter a valid 10-digit number.");
        return;
      }
      if (pin.length !== 6) {
        setError("Enter a valid 6-digit pincode.");
        return;
      }
      if (!fullAddress) {
        setError("Please enter your address.");
        return;
      }

      const res = await fetch("/api/delivery-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phoneDigits,
          pincode: pin,
          area_name: areaName,
          address: fullAddress,
          customer_id: customer?.id ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't send your request. Try again.");
        return;
      }
      // Tell /cart to render the amber confirmation banner. The cart
      // remains intact — the customer can complete the order once we
      // mark the pincode serviceable.
      try {
        sessionStorage.setItem(
          "cadieux_delivery_request",
          JSON.stringify({ pincode: pin, ts: Date.now() }),
        );
      } catch {
        /* private mode */
      }
      onClose();
      router.push("/cart");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setRequestSubmitting(false);
    }
  }

  function prefillAddress(raw: string) {
    // stored as "AddressLine, Area, City - 530045"
    const pincodeMatch = raw.match(/(\d{6})\s*$/);
    if (pincodeMatch) {
      setPincode(pincodeMatch[1]);
      const withoutPincode = raw.replace(/[\s,–\-]+\d{6}\s*$/, "").trim();
      const parts = withoutPincode.split(",").map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        setAddressLine(parts[0]);
        // middle parts = area (everything except first and last = city)
        setArea(parts.slice(1, parts.length > 2 ? -1 : undefined).join(", "));
      } else {
        setAddressLine(withoutPincode);
      }
    } else {
      setAddressLine(raw);
    }
  }

  /* ── OTP (Twilio Verify via /api/verify/*) ─────────────────────────────── */
  async function sendOtp() {
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) { setOtpError("Enter a valid 10-digit number."); return; }
    if (!turnstileToken) { setOtpError("Please complete the human-verification check below."); return; }
    setSendingOtp(true); setOtpError("");
    try {
      const res = await fetch("/api/verify/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits, turnstileToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setOtpError(data.error ?? "Failed to send code. Try again.");
        // Token is single-use — get a fresh one for the retry.
        refreshTurnstile();
        return;
      }
      setOtpSent(true);
      setOtpCode("");
      // Token consumed by /api/verify/send. Refresh so place_order has its own.
      refreshTurnstile();
    } catch {
      setOtpError("Network error. Try again.");
      refreshTurnstile();
    } finally {
      setSendingOtp(false);
    }
  }

  async function verifyOtp() {
    const code = otpCode.replace(/\D/g, "");
    if (code.length !== 6) { setOtpError("Enter the 6-digit code."); return; }
    setVerifyingOtp(true); setOtpError("");
    try {
      const res = await fetch("/api/verify/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.replace(/\D/g, ""), code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setOtpError(data.error ?? "Invalid code. Try again.");
        setOtpCode("");
        return;
      }
      setOtpVerified(true);
      setOtpSent(false);
      sessionStorage.setItem("cadieux_verified_phone", phone.replace(/\D/g, ""));
    } catch {
      setOtpError("Network error. Try again.");
    } finally {
      setVerifyingOtp(false);
    }
  }

  /* ── Submit form → save to Supabase → payment step ─────────────────────── */
  async function handleSubmit() {
    setError("");
    if (!name.trim())                             { setError("Please enter your name."); return; }
    if (phone.replace(/\D/g,"").length !== 10)    { setError("Enter a valid 10-digit number."); return; }
    if (!otpVerified)                             { setError("Please verify your phone number."); return; }
    if (!addressLine.trim())                      { setError("Please enter your delivery address."); return; }
    if (!area.trim())                             { setError("Please enter your area / locality."); return; }
    if (!city.trim())                             { setError("Please enter your city."); return; }
    if (pincode.replace(/\D/g,"").length !== 6)  { setError("Enter a valid 6-digit pincode."); return; }
    if (pinStatus.state === "checking")           { setError("Checking pincode availability…"); return; }
    if (pinStatus.state === "unserviceable")      { setError("We don't deliver to this pincode yet. Send a delivery request below."); return; }
    if (!deliveryDate)                            { setError("Please pick a delivery date."); return; }
    if (!deliverySlot)                            { setError("Please pick a delivery time."); return; }

    const fullAddress = `${addressLine.trim()}, ${area.trim()}, ${city.trim()} - ${pincode.trim()}`;

    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_customer",
          full_name: name.trim(),
          phone: phone.replace(/\D/g, ""),
          delivery_address: fullAddress,
          city: city.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to save details."); return; }
      localStorage.setItem("cadieux_phone", phone.replace(/\D/g, ""));
      setCustomer(data.customer);
      setStep("payment");
    } catch {
      setError("Something went wrong. Try again.");
    } finally { setSubmitting(false); }
  }

  /* ── Send SMS order confirmation (primary) ────────────────────────────── */
  async function sendOrderSMS(orderId: string, deliveryAddress: string, customerPhone: string, customerName: string) {
    const resolvedPhone = customerPhone.replace(/\D/g, "");
    if (!resolvedPhone) return;
    try {
      await fetch("/api/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "order_placed",
          phone: resolvedPhone,
          name: customerName || "Customer",
          orderId,
          total: grandTotal,
          address: deliveryAddress,
        }),
      });
    } catch {
      /* silent — order already placed */
    }
  }

  /* ── Send WhatsApp order confirmation (secondary bonus) ────────────────── */
  async function sendOrderWhatsApp(orderId: string, deliveryAddress: string, customerPhone: string, customerName: string) {
    const shortId = orderId.slice(0, 8).toUpperCase();
    const resolvedPhone = customerPhone.replace(/\D/g, "");
    if (!resolvedPhone) return;
    const message =
      `Hi ${customerName || "there"}! 🍞 Your Cadieux order has been placed successfully!\n\n` +
      `Order ID: ${shortId}\n` +
      `Total: ₹${grandTotal}\n` +
      `Delivery to: ${deliveryAddress}\n\n` +
      `We will confirm your order shortly. Thank you for choosing Cadieux!`;
    try {
      await fetch("/api/send-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: resolvedPhone, message }),
      });
    } catch {
      /* silent — order already placed */
    }
  }

  /* ── Submit subscription rows (one per sub line item) ─────────────────── */
  // Returns the count of subscription items that FAILED to persist. The caller
  // uses this to surface a visible warning when, for example, the
  // `subscriptions` table is missing from Supabase — otherwise sub bookings
  // silently disappear and never show up under "Track your subscription".
  async function submitSubscriptions(
    fullAddress: string,
    customerName: string,
    customerPhone: string,
    customerCity: string,
    customerPincode: string,
  ): Promise<number> {
    const subItems = cart.filter((i) => i.orderType === "sub");
    if (subItems.length === 0 || !customer?.id) return 0;

    let failed = 0;
    for (const item of subItems) {
      const product = PRODUCTS[item.productIndex];
      if (!product || !item.weeks) { failed++; continue; }

      const dayKeys = (item.days ?? [])
        .map(dayLabelToKey)
        .filter((k): k is string => Boolean(k));

      let slotsByDayKey: Record<string, string> | null = null;
      if (item.slotsByDay) {
        slotsByDayKey = {};
        for (const [label, slotVal] of Object.entries(item.slotsByDay)) {
          const k = dayLabelToKey(label);
          if (k) slotsByDayKey[k] = slotVal;
        }
      }

      try {
        const res = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "place_subscription",
            customer_id: customer.id,
            bread_slug: product.slug,
            bread_name: product.name,
            bread_price: product.price,
            weeks: item.weeks,
            days: dayKeys,
            slot_mode: item.slotMode ?? "same",
            slot: item.slot ?? null,
            slots_by_day: slotsByDayKey,
            total: item.price,
            customer_name: customerName,
            customer_phone: customerPhone,
            customer_address: fullAddress,
            customer_city: customerCity,
            customer_pincode: customerPincode,
            // Optional explicit per-delivery list from the wizard's customize
            // step. When present the API uses it as the source of truth and
            // skips server-side date generation.
            deliveries: item.deliveries ?? null,
          }),
        });
        if (!res.ok) {
          failed++;
          const body = await res.json().catch(() => ({}));
          console.error("place_subscription failed:", res.status, body);
        }
      } catch (e) {
        failed++;
        console.error("place_subscription failed:", e);
      }
    }
    return failed;
  }

  /* ── COD order ──────────────────────────────────────────────────────────── */
  async function placeOrderCOD() {
    // For returning customers using saved details, use savedCustomer data directly
    const isReturning = formMode === "returning" && savedCustomer;
    const fullAddress = isReturning
      ? (savedCustomer!.delivery_address ?? "")
      : `${addressLine.trim()}, ${area.trim()}, ${city.trim()} - ${pincode.trim()}`;
    const customerPhone = isReturning ? (savedCustomer!.phone ?? "") : phone;
    const customerName  = isReturning ? (savedCustomer!.full_name ?? "") : name.trim();

    if (!turnstileToken) { setError("Please complete the human-verification check."); return; }
    setOrderLoading(true); setError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "place_order",
          customer_id: customer?.id,
          delivery_address: fullAddress,
          pincode: fullAddress.match(/(\d{6})\s*$/)?.[1] ?? "",
          delivery_date: deliveryDate,
          delivery_slot: deliverySlot,
          total_amount: total,
          items: orderItems,
          turnstileToken,
        }),
      });
      // Token is single-use; refresh whether or not the call succeeded so the
      // sub inserts (which also pass Turnstile) get fresh tokens.
      refreshTurnstile();
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Order failed."); return; }
      const oid = data.order_id ?? "";
      setOrderNum(oid.slice(0, 8).toUpperCase() || Math.random().toString(36).slice(2, 10).toUpperCase());
      if (oid) {
        sendOrderSMS(oid, fullAddress, customerPhone, customerName);
        sendOrderWhatsApp(oid, fullAddress, customerPhone, customerName);
      }
      const { city: subCity, pincode: subPincode } = extractCityPincode(fullAddress);
      const subFailed = await submitSubscriptions(fullAddress, customerName, customerPhone, subCity, subPincode);
      if (subFailed > 0) {
        setError(
          `Order placed, but ${subFailed} subscription${subFailed > 1 ? "s" : ""} couldn't be tracked. They won't appear under "Track your subscription" until the subscriptions table is set up. Contact support.`
        );
        return;
      }
      setStep("done");
    } catch {
      setError("Something went wrong.");
    } finally { setOrderLoading(false); }
  }

  /* ── Razorpay online payment ─────────────────────────────────────────────── */
  async function payOnline() {
    setOrderLoading(true); setError("");
    try {
      const res = await fetch("/api/create-order", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: grandTotal * 100 }),
      });
      if (!res.ok) {
        setError("Online payment unavailable. Please use Cash on Delivery.");
        return;
      }
      const { order_id } = await res.json();

      // Load Razorpay script
      const loaded = await new Promise<boolean>(resolve => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((window as any).Razorpay) { resolve(true); return; }
        const s = document.createElement("script");
        s.src = "https://checkout.razorpay.com/v1/checkout.js";
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.body.appendChild(s);
      });

      setOrderLoading(false);
      if (!loaded) { setError("Failed to load payment gateway. Please use Cash on Delivery."); return; }

      const isReturning = formMode === "returning" && savedCustomer;
      const fullAddress = isReturning
        ? (savedCustomer!.delivery_address ?? "")
        : `${addressLine.trim()}, ${area.trim()}, ${city.trim()} - ${pincode.trim()}`;
      const customerPhone = isReturning ? (savedCustomer!.phone ?? "") : phone;
      const customerName  = isReturning ? (savedCustomer!.full_name ?? "") : name.trim();

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: grandTotal * 100,
        currency: "INR",
        name: "Cadieux",
        description: "Protein Bread",
        order_id,
        handler: async (response: { razorpay_payment_id: string }) => {
          setOrderLoading(true);
          const r = await fetch("/api/checkout", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "place_order",
              customer_id: customer?.id,
              delivery_address: fullAddress,
              pincode: fullAddress.match(/(\d{6})\s*$/)?.[1] ?? "",
              delivery_date: deliveryDate,
              delivery_slot: deliverySlot,
              total_amount: total,
              items: orderItems,
              turnstileToken,
            }),
          });
          refreshTurnstile();
          const d = await r.json();
          setOrderLoading(false);
          console.log("[Payment] Success, Razorpay ID:", response.razorpay_payment_id);
          const oid = d.order_id ?? "";
          setOrderNum(oid.slice(0, 8).toUpperCase() || "ONLINE");
          if (oid) {
            sendOrderSMS(oid, fullAddress, customerPhone, customerName);
            sendOrderWhatsApp(oid, fullAddress, customerPhone, customerName);
          }
          const { city: subCity, pincode: subPincode } = extractCityPincode(fullAddress);
          const subFailed = await submitSubscriptions(fullAddress, customerName, customerPhone, subCity, subPincode);
          if (subFailed > 0) {
            setError(
              `Payment received, but ${subFailed} subscription${subFailed > 1 ? "s" : ""} couldn't be tracked. They won't appear under "Track your subscription" until the subscriptions table is set up. Contact support.`
            );
            return;
          }
          setStep("done");
        },
        prefill: { name: customerName, contact: "+91" + customerPhone.replace(/\D/g, "") },
        theme: { color: "#024628" },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new (window as any).Razorpay(options).open();
    } catch {
      setError("Something went wrong.");
      setOrderLoading(false);
    }
  }

  // Re-validate date/slot when entering the payment step from the
  // returning-customer card (where validation lives on the button).
  const fullAddressDisplay = [addressLine, area, city, pincode].filter(Boolean).join(", ");

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <>
      <style>{`
        @keyframes check-draw { from { stroke-dashoffset: 80; opacity: 0; } to { stroke-dashoffset: 0; opacity: 1; } }
        @keyframes circle-draw { from { stroke-dashoffset: 220; } to { stroke-dashoffset: 0; } }
        .cdx-checkout-scroll { scrollbar-width: thin; scrollbar-color: rgba(200,144,58,0.5) rgba(240,223,200,0.06); }
        .cdx-checkout-scroll::-webkit-scrollbar { width: 8px; }
        .cdx-checkout-scroll::-webkit-scrollbar-track { background: rgba(240,223,200,0.04); }
        .cdx-checkout-scroll::-webkit-scrollbar-thumb { background: rgba(200,144,58,0.45); border-radius: 4px; }
        .cdx-checkout-scroll::-webkit-scrollbar-thumb:hover { background: rgba(200,144,58,0.7); }
      `}</style>

      {/* Backdrop */}
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 300,
          background: "rgba(0,0,0,0.92)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "16px",
        }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        {/* Card */}
        <div className="cdx-checkout-scroll" style={{
          width: "100%", maxWidth: 480,
          background: "#0e0e0e",
          maxHeight: "92dvh", overflowY: "auto",
          position: "relative",
        }}>
          {/* Grain */}
          <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.04, pointerEvents: "none", zIndex: 0 }} />

          {/* Close */}
          {step !== "done" && (
            <button onClick={onClose} style={{
              position: "absolute", top: 18, right: 18, zIndex: 10,
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(240,223,200,0.25)", fontSize: 19, lineHeight: 1,
              WebkitTapHighlightColor: "transparent",
            }}>✕</button>
          )}

          <div style={{ position: "relative", zIndex: 1, padding: "40px 28px 52px" }}>

            {/* ══ FORM STEP ══════════════════════════════════════════════════ */}
            {step === "form" && (
              <>
                {/* Header */}
                <p style={{ margin: "0 0 4px", fontFamily: "var(--font-heading)", fontSize: "clamp(29px,7vw,39px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.06em", lineHeight: 1 }}>
                  Checkout
                </p>
                <p style={{ margin: "0 0 28px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.45em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)" }}>
                  {formMode === "returning" ? "Welcome back" : "Fill in your details to place order"}
                </p>

                {/* Cart summary */}
                <div style={{ marginBottom: 28 }}>
                  <p style={sectionHead}>Your Order</p>
                  {cart.map((item, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(240,223,200,0.07)", padding: "11px 0" }}>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "rgba(240,223,200,0.65)", letterSpacing: "0.03em" }}>
                        {item.name} × {item.qty}
                      </span>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "#FBF3D4" }}>₹{item.price * item.qty}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(240,223,200,0.07)", padding: "11px 0" }}>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "rgba(240,223,200,0.65)", letterSpacing: "0.03em" }}>
                      Delivery fee
                    </span>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "#FBF3D4" }}>₹{deliveryFee}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(240,223,200,0.12)", paddingTop: 12, marginTop: 4 }}>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(240,223,200,0.35)" }}>Total (Incl. GST)</span>
                    <span style={{ fontFamily: "var(--font-heading)", fontSize: 27, fontWeight: 300, color: "#FBF3D4" }}>₹{grandTotal}</span>
                  </div>
                </div>

                <div style={{ borderTop: "1px solid rgba(240,223,200,0.06)", marginBottom: 28 }} />

                {/* ── RETURNING CUSTOMER CARD ──────────────────────────────── */}
                {formMode === "returning" && savedCustomer && (
                  <>
                    <p style={sectionHead}>Saved Details</p>

                    {/* Details card */}
                    <div style={{
                      background: "rgba(240,223,200,0.04)",
                      border: "1px solid rgba(240,223,200,0.1)",
                      padding: "18px 20px",
                      marginBottom: 16,
                    }}>
                      <p style={{ margin: "0 0 8px", fontFamily: "var(--font-body)", fontSize: 18, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.04em" }}>
                        {savedCustomer.full_name}
                      </p>
                      <p style={{ margin: "0 0 8px", fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "rgba(240,223,200,0.65)", letterSpacing: "0.04em" }}>
                        +91 {savedCustomer.phone}
                      </p>
                      {savedCustomer.delivery_address && (
                        <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 200, color: "rgba(240,223,200,0.5)", letterSpacing: "0.03em", lineHeight: 1.7 }}>
                          {savedCustomer.delivery_address}
                        </p>
                      )}
                    </div>

                    {/* Pincode serviceability indicator (saved address) */}
                    <PincodeStatusStrip pinStatus={pinStatus} />

                    {/* Delivery schedule for returning customers too */}
                    <DeliveryScheduleSection
                      tomorrowIso={tomorrowIso}
                      dayAfterIso={dayAfterIso}
                      deliveryDate={deliveryDate}
                      deliverySlot={deliverySlot}
                      onPickDate={(d) => { setDeliveryDate(d); setError(""); }}
                      onPickSlot={(s) => { setDeliverySlot(s); setError(""); }}
                    />

                    {error && (
                      <p style={{ margin: "0 0 12px", fontFamily: "var(--font-body)", fontSize: 12, color: "#e05a5a", letterSpacing: "0.04em" }}>
                        {error}
                      </p>
                    )}

                    {pinStatus.state === "unserviceable" ? (
                      <button
                        onClick={submitDeliveryRequest}
                        disabled={requestSubmitting}
                        style={{
                          display: "block", width: "100%",
                          background: requestSubmitting ? "rgba(245,158,11,0.35)" : "#f59e0b",
                          border: "none", padding: "17px 0",
                          cursor: requestSubmitting ? "default" : "pointer",
                          fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 400,
                          letterSpacing: "0.3em", textTransform: "uppercase",
                          color: "#080604",
                          WebkitTapHighlightColor: "transparent",
                          marginBottom: 10,
                        }}
                      >
                        {requestSubmitting ? "Sending…" : "Send Request to Deliver Here"}
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          if (pinStatus.state === "checking") {
                            setError("Checking pincode availability…");
                            return;
                          }
                          if (!deliveryDate) { setError("Please pick a delivery date."); return; }
                          if (!deliverySlot) { setError("Please pick a delivery time."); return; }
                          setError(""); setStep("payment");
                        }}
                        style={{
                          display: "block", width: "100%",
                          background: "#f0dfc8", border: "none", padding: "17px 0",
                          cursor: "pointer",
                          fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 300,
                          letterSpacing: "0.45em", textTransform: "uppercase",
                          color: "#080604",
                          WebkitTapHighlightColor: "transparent",
                          marginBottom: 10,
                        }}
                      >
                        Proceed to Payment
                      </button>
                    )}

                    {/* Edit saved details */}
                    <button
                      onClick={() => { setFormMode("edit"); setError(""); }}
                      style={{
                        display: "block", width: "100%",
                        background: "transparent",
                        border: "1px solid rgba(240,223,200,0.14)",
                        padding: "15px 0",
                        cursor: "pointer",
                        fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 300,
                        letterSpacing: "0.4em", textTransform: "uppercase",
                        color: "rgba(240,223,200,0.55)",
                        WebkitTapHighlightColor: "transparent",
                        marginBottom: 28,
                      }}
                    >
                      Edit Details
                    </button>

                    {/* Divider + fresh start */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                      <div style={{ flex: 1, height: 1, background: "rgba(240,223,200,0.07)" }} />
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(240,223,200,0.25)" }}>or</span>
                      <div style={{ flex: 1, height: 1, background: "rgba(240,223,200,0.07)" }} />
                    </div>

                    <button
                      onClick={() => {
                        setFormMode("fresh");
                        setName(""); setPhone(""); setAddressLine(""); setArea(""); setCity(""); setPincode("");
                        setOtpVerified(false); setOtpSent(false); setOtpCode(""); setOtpError("");
                        setCustomer(null); setError("");
                      }}
                      style={{
                        display: "block", width: "100%",
                        background: "none", border: "none",
                        cursor: "pointer", padding: "10px 0",
                        fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
                        letterSpacing: "0.35em", textTransform: "uppercase",
                        color: "rgba(200,144,58,0.5)",
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      Order with a Different Number
                    </button>
                  </>
                )}

                {/* ── EDIT / FRESH FORM ────────────────────────────────────── */}
                {(formMode === "edit" || formMode === "fresh") && (
                  <>
                    <p style={sectionHead}>Your Details</p>

                    {/* Full Name */}
                    <label style={{ display: "block", marginBottom: 22 }}>
                      <span style={labelSt}>Full Name *</span>
                      <input type="text" value={name}
                        onChange={e => { setName(e.target.value); setError(""); }}
                        placeholder="e.g. Arjun Sharma"
                        autoComplete="name"
                        style={inputSt}
                      />
                    </label>

                    {/* Mobile + OTP */}
                    <div style={{ marginBottom: 22 }}>
                      <span style={labelSt}>Mobile Number *</span>
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
                        <div style={{ flex: 1, display: "flex", alignItems: "flex-end", ...inputSt, padding: 0 }}>
                          <span style={{ padding: "10px 0 10px 12px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200, color: "rgba(240,223,200,0.5)", userSelect: "none", letterSpacing: "0.05em" }}>+91</span>
                          <input
                            type="tel" inputMode="numeric" autoComplete="tel-national"
                            value={phone}
                            onChange={e => {
                              setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                              setOtpError(""); setError("");
                              if (otpVerified) { setOtpVerified(false); setOtpSent(false); setOtpCode(""); }
                            }}
                            placeholder="10-digit number"
                            style={{ flex: 1, background: "none", border: "none", outline: "none", padding: "10px 12px 10px 6px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200, color: "#FBF3D4", letterSpacing: "0.05em" }}
                          />
                        </div>
                        {otpVerified ? (
                          <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, marginBottom: 2 }}>
                            <span style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.2em", color: "#4ade80" }}>✓ Verified</span>
                            <button
                              onClick={() => { setOtpVerified(false); setOtpSent(false); setOtpCode(""); setOtpError(""); }}
                              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(200,144,58,0.55)", WebkitTapHighlightColor: "transparent" }}
                            >Edit</button>
                          </div>
                        ) : (
                          <button
                            onClick={sendOtp}
                            disabled={sendingOtp || phone.replace(/\D/g,"").length < 10}
                            style={{
                              flexShrink: 0, marginBottom: 2,
                              background: "none",
                              border: "1px solid rgba(200,144,58,0.45)",
                              padding: "7px 14px",
                              cursor: (sendingOtp || phone.replace(/\D/g,"").length < 10) ? "default" : "pointer",
                              fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
                              letterSpacing: "0.3em", textTransform: "uppercase",
                              color: (sendingOtp || phone.replace(/\D/g,"").length < 10) ? "rgba(200,144,58,0.3)" : "rgba(200,144,58,0.85)",
                              WebkitTapHighlightColor: "transparent",
                            }}
                          >
                            {sendingOtp ? "Sending…" : otpSent ? "Resend" : "Send OTP"}
                          </button>
                        )}
                      </div>

                      {/* Cloudflare Turnstile bot-check. Shown until verified. */}
                      {!otpVerified && (
                        <div style={{ marginTop: 14 }}>
                          <TurnstileWidget
                            ref={turnstileRef}
                            onVerify={(t) => setTurnstileToken(t)}
                            onExpire={() => setTurnstileToken("")}
                          />
                        </div>
                      )}

                      {otpSent && !otpVerified && (
                        <div style={{ marginTop: 14 }}>
                          <span style={{ ...labelSt, marginBottom: 8 }}>Enter OTP *</span>
                          <input
                            type="text" inputMode="numeric" autoComplete="one-time-code"
                            maxLength={6}
                            value={otpCode}
                            onChange={e => { setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setOtpError(""); }}
                            placeholder="6-digit code"
                            style={{ ...inputSt, letterSpacing: "0.4em", fontSize: 19, borderBottomColor: "rgba(200,144,58,0.45)" }}
                            autoFocus
                          />
                          <button
                            onClick={verifyOtp}
                            disabled={verifyingOtp || otpCode.replace(/\D/g,"").length < 6}
                            style={{
                              marginTop: 12, display: "block", width: "100%",
                              background: (verifyingOtp || otpCode.replace(/\D/g,"").length < 6) ? "rgba(240,223,200,0.12)" : "#f0dfc8",
                              border: "none", padding: "13px 0",
                              cursor: (verifyingOtp || otpCode.replace(/\D/g,"").length < 6) ? "default" : "pointer",
                              fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                              letterSpacing: "0.4em", textTransform: "uppercase",
                              color: (verifyingOtp || otpCode.replace(/\D/g,"").length < 6) ? "rgba(8,6,4,0.35)" : "#080604",
                              WebkitTapHighlightColor: "transparent",
                            }}
                          >
                            {verifyingOtp ? "Verifying…" : "Verify"}
                          </button>
                        </div>
                      )}

                      {otpError && (
                        <p style={{ margin: "8px 0 0", fontFamily: "var(--font-body)", fontSize: 12, color: "#e05a5a", letterSpacing: "0.04em" }}>
                          {otpError}
                        </p>
                      )}
                    </div>

                    {/* Delivery Address */}
                    <label style={{ display: "block", marginBottom: 22 }}>
                      <span style={labelSt}>Delivery Address *</span>
                      <input type="text" value={addressLine}
                        onChange={e => { setAddressLine(e.target.value); setError(""); }}
                        placeholder="Flat no. / House no. / Building name"
                        autoComplete="address-line1"
                        style={inputSt}
                      />
                    </label>

                    {/* Area */}
                    <label style={{ display: "block", marginBottom: 22 }}>
                      <span style={labelSt}>Area / Locality *</span>
                      <input type="text" value={area}
                        onChange={e => { setArea(e.target.value); setError(""); }}
                        placeholder="Street / Colony / Locality"
                        autoComplete="address-line2"
                        style={inputSt}
                      />
                    </label>

                    {/* City + Pincode */}
                    <div style={{ display: "flex", gap: 16, marginBottom: 32 }}>
                      <label style={{ flex: 1 }}>
                        <span style={labelSt}>City *</span>
                        <input type="text" value={city}
                          onChange={e => { setCity(e.target.value); setError(""); }}
                          placeholder="Visakhapatnam"
                          autoComplete="address-level2"
                          style={inputSt}
                        />
                      </label>
                      <label style={{ flex: "0 0 110px" }}>
                        <span style={labelSt}>Pincode *</span>
                        <input type="text" inputMode="numeric" maxLength={6}
                          value={pincode}
                          onChange={e => { setPincode(e.target.value.replace(/\D/g,"").slice(0,6)); setError(""); }}
                          placeholder="530045"
                          autoComplete="postal-code"
                          style={inputSt}
                        />
                      </label>
                    </div>

                    {/* Pincode serviceability indicator */}
                    <PincodeStatusStrip pinStatus={pinStatus} />

                    {/* Delivery schedule: two date cards + slot dropdown */}
                    <DeliveryScheduleSection
                      tomorrowIso={tomorrowIso}
                      dayAfterIso={dayAfterIso}
                      deliveryDate={deliveryDate}
                      deliverySlot={deliverySlot}
                      onPickDate={(d) => { setDeliveryDate(d); setError(""); }}
                      onPickSlot={(s) => { setDeliverySlot(s); setError(""); }}
                    />

                    {error && (
                      <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 12, color: "#e05a5a", letterSpacing: "0.04em" }}>
                        {error}
                      </p>
                    )}

                    {pinStatus.state === "unserviceable" ? (
                      <button
                        onClick={submitDeliveryRequest}
                        disabled={requestSubmitting}
                        style={{
                          display: "block", width: "100%",
                          background: requestSubmitting ? "rgba(245,158,11,0.35)" : "#f59e0b",
                          border: "none", padding: "17px 0",
                          cursor: requestSubmitting ? "default" : "pointer",
                          fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 400,
                          letterSpacing: "0.3em", textTransform: "uppercase",
                          color: "#080604",
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        {requestSubmitting ? "Sending…" : "Send Request to Deliver Here"}
                      </button>
                    ) : (
                      <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        style={{
                          display: "block", width: "100%",
                          background: submitting ? "rgba(240,223,200,0.5)" : "#f0dfc8",
                          border: "none", padding: "17px 0",
                          cursor: submitting ? "default" : "pointer",
                          fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 300,
                          letterSpacing: "0.45em", textTransform: "uppercase",
                          color: "#080604",
                          WebkitTapHighlightColor: "transparent",
                          transition: "background 0.2s",
                        }}
                      >
                        {submitting ? "Saving…" : "Proceed to Payment"}
                      </button>
                    )}

                    {/* Back to saved details if editing */}
                    {savedCustomer && (
                      <button
                        onClick={() => {
                          setFormMode("returning");
                          setName(savedCustomer.full_name ?? "");
                          setPhone(savedCustomer.phone ?? "");
                          setCustomer(savedCustomer);
                          prefillAddress(savedCustomer.delivery_address ?? "");
                          setOtpVerified(true); setOtpSent(false); setOtpCode(""); setOtpError(""); setError("");
                        }}
                        style={{
                          display: "block", width: "100%", background: "none", border: "none",
                          cursor: "pointer", marginTop: 18,
                          fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
                          letterSpacing: "0.3em", textTransform: "uppercase",
                          color: "rgba(240,223,200,0.22)",
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        ← Back
                      </button>
                    )}
                  </>
                )}
              </>
            )}

            {/* ══ PAYMENT STEP ═══════════════════════════════════════════════ */}
            {step === "payment" && (
              <>
                <p style={{ margin: "0 0 4px", fontFamily: "var(--font-heading)", fontSize: "clamp(29px,7vw,39px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.06em" }}>
                  Payment
                </p>
                <p style={{ margin: "0 0 28px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.45em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)" }}>
                  Choose how to pay
                </p>

                {/* Order summary card */}
                <div style={{ background: "rgba(240,223,200,0.04)", border: "1px solid rgba(240,223,200,0.08)", padding: "16px 18px", marginBottom: 28 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(240,223,200,0.35)" }}>Order Total</p>
                      <p style={{ margin: "4px 0 0", fontFamily: "var(--font-heading)", fontSize: 29, fontWeight: 300, color: "#FBF3D4" }}>₹{grandTotal}</p>
                      <p style={{ margin: "4px 0 0", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.04em", color: "rgba(240,223,200,0.4)" }}>
                        Includes ₹{deliveryFee} delivery
                      </p>
                    </div>
                  </div>
                  <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "rgba(240,223,200,0.5)", letterSpacing: "0.03em" }}>
                    {name} · +91 {phone.replace(/\D/g, "")}
                  </p>
                  <p style={{ margin: "4px 0 0", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "rgba(240,223,200,0.35)", letterSpacing: "0.03em", lineHeight: 1.6 }}>
                    {fullAddressDisplay}
                  </p>
                  {deliveryDate && deliverySlot && (
                    <p style={{ margin: "8px 0 0", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(200,144,58,0.75)" }}>
                      {formatDeliveryDate(deliveryDate)} · {formatSlot12(deliverySlot)}
                    </p>
                  )}
                </div>

                {error && (
                  <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 12, color: "#e05a5a" }}>
                    {error}
                  </p>
                )}

                {/* Cloudflare Turnstile bot-check — required to place the order. */}
                <div style={{ marginBottom: 18 }}>
                  <TurnstileWidget
                    ref={turnstileRef}
                    onVerify={(t) => setTurnstileToken(t)}
                    onExpire={() => setTurnstileToken("")}
                  />
                </div>

                {/* Pay Online (Razorpay) */}
                <button
                  onClick={payOnline}
                  disabled={orderLoading}
                  style={{
                    display: "block", width: "100%",
                    background: orderLoading ? "rgba(2,70,40,0.35)" : "#024628",
                    border: "none", padding: "18px 0", marginBottom: 10,
                    cursor: orderLoading ? "default" : "pointer",
                    fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 300,
                    letterSpacing: "0.4em", textTransform: "uppercase",
                    color: orderLoading ? "rgba(251,243,212,0.35)" : "#FBF3D4",
                    WebkitTapHighlightColor: "transparent",
                    transition: "background 0.2s",
                  }}
                >
                  {orderLoading ? "Processing…" : "Pay Online"}
                </button>
                <p style={{ margin: "0 0 20px", textAlign: "center", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.3em", color: "rgba(240,223,200,0.22)", textTransform: "uppercase" }}>
                  UPI · Cards · Net Banking · Wallets
                </p>

                {/* Cash on Delivery */}
                <button
                  onClick={placeOrderCOD}
                  disabled={orderLoading}
                  style={{
                    display: "block", width: "100%",
                    background: "transparent",
                    border: "1px solid rgba(240,223,200,0.14)",
                    padding: "17px 0",
                    cursor: orderLoading ? "default" : "pointer",
                    fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 300,
                    letterSpacing: "0.4em", textTransform: "uppercase",
                    color: orderLoading ? "rgba(240,223,200,0.2)" : "rgba(240,223,200,0.55)",
                    WebkitTapHighlightColor: "transparent",
                    transition: "border-color 0.2s",
                  }}
                >
                  Cash on Delivery
                </button>
                <p style={{ margin: "8px 0 0", textAlign: "center", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.3em", color: "rgba(240,223,200,0.2)", textTransform: "uppercase" }}>
                  Pay when it arrives
                </p>

                <button
                  onClick={() => setStep("form")}
                  style={{
                    display: "block", width: "100%", background: "none", border: "none",
                    cursor: "pointer", marginTop: 28,
                    fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
                    letterSpacing: "0.3em", textTransform: "uppercase",
                    color: "rgba(240,223,200,0.22)",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  ← Edit Details
                </button>
              </>
            )}

            {/* ══ DONE STEP ══════════════════════════════════════════════════ */}
            {step === "done" && (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <svg width="72" height="72" viewBox="0 0 72 72" style={{ marginBottom: 28 }}>
                  <circle cx="36" cy="36" r="34" fill="none" stroke="#024628" strokeWidth="2"
                    strokeDasharray="220" strokeDashoffset="0"
                    style={{ animation: "circle-draw 0.5s ease forwards" }}
                  />
                  <polyline points="22,37 32,47 52,26" fill="none"
                    stroke="#FBF3D4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    strokeDasharray="80" strokeDashoffset="0"
                    style={{ animation: "check-draw 0.4s 0.4s ease forwards", opacity: 0 }}
                  />
                </svg>
                <p style={{ margin: "0 0 8px", fontFamily: "var(--font-heading)", fontSize: "clamp(33px,8vw,49px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.06em" }}>
                  Order Placed
                </p>
                <p style={{ margin: "0 0 8px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(200,144,58,0.75)" }}>
                  Order #{orderNum}
                </p>
                <p style={{ margin: "0 0 40px", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, letterSpacing: "0.06em", color: "rgba(240,223,200,0.45)", lineHeight: 1.7 }}>
                  Estimated delivery: 1–2 days<br />
                  We&apos;ll reach out on your number to confirm.
                </p>
                <button
                  onClick={onOrderPlaced}
                  style={{
                    display: "block", width: "100%",
                    background: "#f0dfc8", border: "none", padding: "17px 0",
                    cursor: "pointer",
                    fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 300,
                    letterSpacing: "0.45em", textTransform: "uppercase",
                    color: "#080604",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  Back to Home
                </button>
              </div>
            )}

          </div>
        </div>
      </div>
    </>
  );
}

/* ── Pincode serviceability indicator ────────────────────────────────── */
function PincodeStatusStrip({
  pinStatus,
}: {
  pinStatus:
    | { state: "idle" }
    | { state: "checking" }
    | { state: "serviceable"; area_names: string[] }
    | { state: "unserviceable" }
    | { state: "error" };
}) {
  if (pinStatus.state === "idle") return null;
  const isOk = pinStatus.state === "serviceable";
  const isBad = pinStatus.state === "unserviceable";
  const isChecking = pinStatus.state === "checking";
  const isErr = pinStatus.state === "error";
  const border = isOk
    ? "1px solid rgba(74,222,128,0.35)"
    : isBad
      ? "1px solid rgba(245,158,11,0.45)"
      : "1px solid rgba(240,223,200,0.12)";
  const bg = isOk
    ? "rgba(74,222,128,0.07)"
    : isBad
      ? "rgba(245,158,11,0.07)"
      : "transparent";
  const fg = isOk
    ? "#4ade80"
    : isBad
      ? "#f59e0b"
      : isErr
        ? "#e05a5a"
        : "rgba(240,223,200,0.55)";
  return (
    <div
      style={{
        marginTop: -18,
        marginBottom: 22,
        padding: "10px 12px",
        border,
        background: bg,
        fontFamily: "var(--font-body)",
        fontSize: 12,
        fontWeight: 300,
        letterSpacing: "0.05em",
        color: fg,
        lineHeight: 1.5,
      }}
    >
      {isChecking && "Checking pincode availability…"}
      {isOk &&
        (pinStatus.area_names.length > 0
          ? `✓ We deliver here · ${pinStatus.area_names.slice(0, 3).join(", ")}`
          : "✓ We deliver here.")}
      {isBad &&
        "⚠ We don't deliver here yet. Send us a request and we'll get in touch."}
      {isErr && "Couldn't verify pincode. Try again."}
    </div>
  );
}

/* ── Delivery date + slot picker ─────────────────────────────────────── */
function DeliveryScheduleSection({
  tomorrowIso,
  dayAfterIso,
  deliveryDate,
  deliverySlot,
  onPickDate,
  onPickSlot,
}: {
  tomorrowIso: string;
  dayAfterIso: string;
  deliveryDate: string;
  deliverySlot: string;
  onPickDate: (d: string) => void;
  onPickSlot: (s: string) => void;
}) {
  const dates: { iso: string; tag: string }[] = [
    { iso: tomorrowIso, tag: "Tomorrow" },
    { iso: dayAfterIso, tag: "Day after" },
  ];
  return (
    <div style={{ marginBottom: 28 }}>
      <p style={sectionHead}>Delivery Schedule</p>

      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        {dates.map((d) => {
          const active = d.iso === deliveryDate;
          return (
            <button
              key={d.iso}
              type="button"
              onClick={() => onPickDate(d.iso)}
              style={{
                flex: 1,
                padding: "12px 10px",
                background: active ? "rgba(200,144,58,0.12)" : "transparent",
                border: active
                  ? "1px solid rgba(200,144,58,0.7)"
                  : "1px solid rgba(240,223,200,0.14)",
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                color: active ? "#FBF3D4" : "rgba(240,223,200,0.6)",
                textAlign: "left",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 200,
                  letterSpacing: "0.35em",
                  textTransform: "uppercase",
                  color: active ? "rgba(200,144,58,0.85)" : "rgba(200,144,58,0.45)",
                  marginBottom: 4,
                }}
              >
                {d.tag}
              </div>
              <div style={{ fontSize: 13, fontWeight: 300, letterSpacing: "0.04em" }}>
                {formatDeliveryDate(d.iso)}
              </div>
            </button>
          );
        })}
      </div>

      <label style={{ display: "block" }}>
        <span style={labelSt}>Time slot *</span>
        <select
          value={deliverySlot}
          onChange={(e) => onPickSlot(e.target.value)}
          style={{
            ...inputSt,
            appearance: "none",
            WebkitAppearance: "none",
            background: "transparent",
            color: deliverySlot ? "#FBF3D4" : "rgba(240,223,200,0.4)",
            cursor: "pointer",
          }}
        >
          <option value="" style={{ background: "#0e0e0e", color: "#FBF3D4" }}>
            Select a delivery time…
          </option>
          {ORDER_DELIVERY_SLOTS.map((s) => (
            <option key={s} value={s} style={{ background: "#0e0e0e", color: "#FBF3D4" }}>
              {formatSlot12(s)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
