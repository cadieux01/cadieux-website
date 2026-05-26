"use client";

// Full-page multi-step checkout. Replaces the old <CheckoutModal> popover.
// Three steps: Address → Delivery → Payment, all state-managed inside one
// route. On success → /checkout/success?order=<id>. Logic ported from the
// previous CheckoutModal.tsx verbatim — OTP via Twilio Verify, pincode
// serviceability via /api/service-areas/check (with unserviceable swap to
// /api/delivery-requests), date/slot picker, Razorpay + COD, subscription
// fan-out — only the chrome changes.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Autocomplete, useJsApiLoader } from "@react-google-maps/api";
import { useCart } from "@/context/CartContext";
import { PRODUCTS } from "@/lib/data";
import { DELIVERY_FEE_INR } from "@/lib/order-validation";
import {
  formatSlot12,
  formatDeliveryDate,
  getOrderDeliveryDateOptions,
} from "@/lib/order-delivery";
import { bookableSlots } from "@/lib/delivery-slots";
import TurnstileWidget, { type TurnstileHandle } from "@/components/TurnstileWidget";
import { GOOGLE_MAPS_LOADER_ID, GOOGLE_MAPS_LIBRARIES } from "@/lib/google-maps-loader";
import { geocodePincodeClient } from "@/lib/clientGeocode";
import LocationPickerModal from "@/components/LocationPickerModal";

const GRAIN = "url(/grain.svg)";

type Step = "address" | "delivery" | "payment";
type FormMode = "returning" | "edit" | "fresh";

type Customer = {
  id?: string;
  full_name: string;
  phone: string;
  city: string;
  delivery_address: string;
};

type PinState =
  | { state: "idle" }
  | { state: "checking" }
  // via:"exact" → area_names belong to the entered pincode (correct to show).
  // via:"proximity" → area_names are from the NEAREST active pincode, not the
  //   entered one — suppress them in the UI so we don't show misleading areas.
  | { state: "serviceable"; via: "exact" | "proximity"; area_names: string[] }
  | { state: "unserviceable" }
  | { state: "error" };

const DAY_LABEL_TO_KEY: Record<string, string> = {
  mon: "mon", tue: "tue", wed: "wed", thu: "thu",
  fri: "fri", sat: "sat", sun: "sun",
};
function dayLabelToKey(label: string): string | null {
  const k = label.trim().toLowerCase().slice(0, 3);
  return DAY_LABEL_TO_KEY[k] ?? null;
}

function extractCityPincode(full: string): { city: string; pincode: string } {
  const pinMatch = full.match(/(\d{6})\s*$/);
  const pincode = pinMatch?.[1] ?? "";
  const withoutPin = full.replace(/[\s,–\-]+\d{6}\s*$/, "").trim();
  const parts = withoutPin.split(",").map((p) => p.trim()).filter(Boolean);
  const city = parts.length >= 2 ? parts[parts.length - 1] : "";
  return { city, pincode };
}

/* ── Shared styles ─────────────────────────────────────────────────────── */
const inputSt: React.CSSProperties = {
  display: "block", width: "100%", boxSizing: "border-box",
  background: "transparent",
  border: "1px solid rgba(240,223,200,0.16)",
  padding: "14px 14px", outline: "none",
  fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 200,
  color: "#FBF3D4", letterSpacing: "0.04em",
  minHeight: 48,
};
const labelSt: React.CSSProperties = {
  display: "block", marginBottom: 8,
  fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
  letterSpacing: "0.4em", textTransform: "uppercase",
  color: "rgba(200,144,58,0.7)",
};
const sectionHead: React.CSSProperties = {
  margin: "0 0 18px",
  fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
  letterSpacing: "0.5em", textTransform: "uppercase",
  color: "rgba(240,223,200,0.32)",
};

/* ── Main page ─────────────────────────────────────────────────────────── */
export default function CheckoutPage() {
  const router = useRouter();
  const { cart, cartTotal, clearCart } = useCart();
  const total = cartTotal;

  // Cart snapshot for place_order body.
  const orderItems = cart.map((c) => ({
    slug: PRODUCTS[c.productIndex].slug,
    quantity: c.qty,
    kind: c.orderType,
    line_total_inr: c.price * c.qty,
  }));

  const [step, setStep] = useState<Step>("address");
  const [formMode, setFormMode] = useState<FormMode>("fresh");

  // Gates the Your-Order summary (top block + sticky bottom). False
  // until the user has filled in a valid address AND pressed
  // "Continue to Delivery". Keeps us from showing a misleading ₹50
  // placeholder while they're still typing.
  const [addressConfirmed, setAddressConfirmed] = useState(false);

  // "Are you currently at this delivery address?" — must be answered
  // before Continue is enabled. Lifted from AddressForm to the parent
  // so submitAddressStep + the sticky CTA's disabled state can both
  // observe it. Saved-customer flow (formMode === "returning") doesn't
  // ask the question, so it's effectively bypassed there.
  const [locQuestion, setLocQuestion] = useState<"unanswered" | "yes" | "no">("unanswered");

  // Swiggy-style address label (Home / Work / Other). Persisted with
  // the delivery_address string as a `[Label] ` prefix so it survives
  // the existing single-column orders.delivery_address schema. On
  // returning customers we strip the prefix in prefillAddress so the
  // fields populate cleanly and the chip picker re-reflects the saved
  // choice.
  const [addressLabel, setAddressLabel] = useState<"Home" | "Work" | "Other">("Home");
  const [customLabel, setCustomLabel] = useState("");
  const effectiveLabel =
    addressLabel === "Other"
      ? (customLabel.trim() || "Other")
      : addressLabel;

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

  // Delivery date + slot
  const [{ tomorrow: tomorrowIso, dayAfter: dayAfterIso }] = useState(() =>
    getOrderDeliveryDateOptions(),
  );
  const [deliveryDate, setDeliveryDate] = useState<string>(tomorrowIso);
  const [deliverySlot, setDeliverySlot] = useState<string>("");

  // If the currently-picked slot is no longer bookable (e.g. date changed,
  // or time has crept past the 12h10m lead window for a same-day pick),
  // drop it so the user can't submit a server-rejectable combo.
  useEffect(() => {
    if (!deliverySlot) return;
    const stillOk = bookableSlots(deliveryDate, new Date()).some(
      (s) => s.value === deliverySlot && !s.disabled,
    );
    if (!stillOk) setDeliverySlot("");
  }, [deliveryDate, deliverySlot]);

  // GPS coordinates captured from location or autocomplete
  const [orderLat, setOrderLat] = useState<number | null>(null);
  const [orderLng, setOrderLng] = useState<number | null>(null);

  // Distance-based delivery fee quote (fetched from /api/delivery-quote)
  type DeliveryQuote = {
    serviceable: boolean | null;
    feeInr: number | null;
    distanceKm: number | null;
  };
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Reactive fee + total — update immediately when quote arrives
  const deliveryFee  = deliveryQuote?.feeInr  ?? DELIVERY_FEE_INR;
  const grandTotal   = total + deliveryFee;
  const distanceUnserviceable = deliveryQuote?.serviceable === false;

  // Render the order summary only after the user has confirmed their
  // address (Continue pressed) AND a real distance-based quote is in
  // hand. `distanceUnserviceable` short-circuits the summary in favour
  // of the standalone ">10 km" warning rendered above.
  const showSummary =
    addressConfirmed && deliveryQuote !== null && !distanceUnserviceable;

  // Pincode serviceability
  const [pinStatus, setPinStatus] = useState<PinState>({ state: "idle" });
  const [requestSubmitting, setRequestSubmitting] = useState(false);

  // Turnstile — ONE widget per checkout session. The single token gates
  // BOTH actions:
  //   1. Send OTP            (server-verified via /api/verify/send)
  //   2. Continue to Delivery (client-side gate on submitAddressStep)
  // so the customer never has to solve the challenge twice. The widget
  // renders once at the bottom of the address step, above the sticky
  // "Continue to Delivery" button — see the <main> tail below.
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const turnstileRef = useRef<TurnstileHandle>(null);
  // Reset the widget only on Turnstile expiry/error or on an OTP-send
  // server failure. We do NOT reset after a successful OTP send — the
  // token stays as the client-side gate for Continue.
  const refreshTurnstile = () => {
    setTurnstileToken("");
    turnstileRef.current?.reset();
  };

  // Set just before finishOrder fires clearCart() so the empty-cart
  // bounce effect below doesn't race the /checkout/success redirect.
  // Without this guard, clearCart() flips cart.length to 0, the effect
  // runs synchronously, and router.replace("/cart") clobbers the push
  // we did to /checkout/success — landing the user on an empty cart
  // page instead of the order confirmation.
  const orderFinishingRef = useRef(false);

  // Bounce empty cart back to /cart to avoid placing zero-item orders.
  useEffect(() => {
    if (orderFinishingRef.current) return;
    if (cart.length === 0) {
      router.replace("/cart");
    }
  }, [cart.length, router]);

  /* ── Pre-fill on mount ────────────────────────────────────────────────── */
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("cadieux_phone") : null;
    if (!saved) return;
    setPhone(saved);

    const sessionPhone = sessionStorage.getItem("cadieux_verified_phone");
    if (sessionPhone === saved) setOtpVerified(true);

    // `slim=1` skips the full orders + subscriptions history fetch that
    // the /orders list page needs but checkout doesn't. Cuts prefill
    // latency from ~3s (subscriptions seq-scan) down to ~150ms.
    fetch(`/api/checkout?phone=${encodeURIComponent(saved)}&slim=1`)
      .then((r) => r.json())
      .then((d) => {
        // Server-side trust hint: if the request's verified-phone
        // cookie still matches this number, the server already
        // considers us verified for the next 30 min — mirror that
        // into client state so we skip OTP entirely and keep the
        // sessionStorage flag in sync for subsequent reloads.
        if (d.phone_verified) {
          setOtpVerified(true);
          try {
            sessionStorage.setItem("cadieux_verified_phone", saved);
          } catch { /* private mode */ }
        }
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

  // Effective pincode for serviceability check.
  const effectivePincode = (() => {
    if (formMode === "returning" && savedCustomer?.delivery_address) {
      return savedCustomer.delivery_address.match(/(\d{6})\s*$/)?.[1] ?? "";
    }
    return pincode;
  })();

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
        .then((d: { serviceable?: boolean; via?: string; area_names?: string[] }) => {
          if (d.serviceable) {
            const via = d.via === "proximity" ? "proximity" : "exact";
            setPinStatus({
              state: "serviceable",
              via,
              // For proximity matches area_names belong to the nearest pincode
              // (a different pincode than the customer entered). Pass an empty
              // array so PincodeStatusStrip doesn't show misleading area names.
              area_names: via === "exact" && Array.isArray(d.area_names)
                ? d.area_names
                : [],
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

  // Delivery-fee quote: fetch whenever GPS coords or pincode changes.
  // Uses coords as primary; falls back to pincode centroid for returning customers.
  useEffect(() => {
    const params = new URLSearchParams();
    if (orderLat !== null && orderLng !== null) {
      params.set("lat", String(orderLat));
      params.set("lng", String(orderLng));
    } else if (effectivePincode.length === 6) {
      params.set("pincode", effectivePincode);
    } else {
      setDeliveryQuote(null);
      return;
    }
    setQuoteLoading(true);
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/delivery-quote?${params.toString()}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d: { serviceable?: boolean | null; feeInr?: unknown; distanceKm?: unknown }) => {
          setDeliveryQuote({
            serviceable:  d.serviceable ?? null,
            feeInr:       typeof d.feeInr    === "number" ? d.feeInr    : null,
            distanceKm:   typeof d.distanceKm === "number" ? d.distanceKm : null,
          });
        })
        .catch(() => { /* treat network failure as unknown fee */ })
        .finally(() => setQuoteLoading(false));
    }, 400);
    return () => { window.clearTimeout(timer); ctrl.abort(); setQuoteLoading(false); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderLat, orderLng, effectivePincode]);

  // Pincode → city autofill: when the user types a full pincode, fill city
  // if it's currently blank. Only fires in fresh/edit mode (not returning —
  // the saved customer's city is already correct).
  useEffect(() => {
    if (formMode === "returning") return;
    if (!/^\d{6}$/.test(pincode)) return;
    geocodePincodeClient(pincode).then((result) => {
      if (!result) return;
      if (!city.trim()) setCity(result.city);
    });
    // Intentionally omit `city` from deps so we only autofill blanks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pincode, formMode]);

  function prefillAddress(raw: string) {
    // Strip optional "[Label] " prefix added by the label picker so the
    // address fields populate cleanly. The label is fed back into the
    // chip picker so the customer's saved choice is still reflected.
    const labelMatch = raw.match(/^\[([^\]]{1,40})\]\s*(.+)$/);
    if (labelMatch) {
      const lbl = labelMatch[1].trim();
      if (lbl === "Home" || lbl === "Work") {
        setAddressLabel(lbl);
        setCustomLabel("");
      } else {
        setAddressLabel("Other");
        setCustomLabel(lbl);
      }
    }
    const text = labelMatch ? labelMatch[2] : raw;
    const pincodeMatch = text.match(/(\d{6})\s*$/);
    if (pincodeMatch) {
      setPincode(pincodeMatch[1]);
      const withoutPincode = text.replace(/[\s,–\-]+\d{6}\s*$/, "").trim();
      const parts = withoutPincode.split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        setAddressLine(parts[0]);
        setArea(parts.slice(1, parts.length > 2 ? -1 : undefined).join(", "));
      } else {
        setAddressLine(withoutPincode);
      }
    } else {
      setAddressLine(text);
    }
  }

  /* ── Unserviceable area → delivery request ────────────────────────────── */
  async function submitDeliveryRequest() {
    setError("");
    setRequestSubmitting(true);
    try {
      const isReturning = formMode === "returning" && savedCustomer;
      const phoneDigits = (isReturning ? savedCustomer!.phone : phone).replace(/\D/g, "");
      const fullAddress = isReturning
        ? (savedCustomer!.delivery_address ?? "")
        : `[${effectiveLabel}] ${addressLine.trim()}, ${area.trim()}, ${city.trim()} - ${pincode.trim()}`;
      const pin =
        (isReturning
          ? fullAddress.match(/(\d{6})\s*$/)?.[1]
          : pincode.replace(/\D/g, "")) ?? "";
      const areaName = isReturning ? null : area.trim() || null;

      if (phoneDigits.length !== 10) { setError("Enter a valid 10-digit number."); return; }
      if (pin.length !== 6) { setError("Enter a valid 6-digit pincode."); return; }
      if (!fullAddress) { setError("Please enter your address."); return; }

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
      try {
        sessionStorage.setItem(
          "cadieux_delivery_request",
          JSON.stringify({ pincode: pin, ts: Date.now() }),
        );
      } catch {
        /* private mode */
      }
      router.push("/cart");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setRequestSubmitting(false);
    }
  }

  /* ── OTP ──────────────────────────────────────────────────────────────── */
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
        refreshTurnstile();
        return;
      }
      setOtpSent(true);
      setOtpCode("");
      // Intentionally NOT calling refreshTurnstile() here — the same
      // solved token continues to satisfy the Continue-to-Delivery
      // client gate so the customer never re-solves the captcha.
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

  /* ── Address step → save_customer → delivery step ─────────────────────── */
  async function submitAddressStep() {
    setError("");
    // Human-verification gate — uses the single Turnstile token that
    // also gates Send OTP. Applies to BOTH the returning-customer
    // saved-details fast path (no server call) and the new-address
    // form path. The customer solves the challenge once per session.
    if (!turnstileToken) {
      setError("Please complete the human-verification check below.");
      return;
    }
    // Returning customer using saved details just advances — BUT we
    // still require an in-session OTP (cookie). Without it the server
    // will reject `place_order` with "Phone verification required"
    // at the payment step. Forcing OTP here means payment can't fail
    // for that reason; for returning customers whose 30-min cookie
    // is still valid the prefill effect already flipped otpVerified
    // to true so this gate is a no-op.
    if (formMode === "returning" && savedCustomer && customer?.id) {
      if (!otpVerified) { setError("Please verify your phone number to continue."); return; }
      if (pinStatus.state === "checking") { setError("Checking pincode availability…"); return; }
      if (pinStatus.state === "unserviceable") { setError("We don't deliver to this pincode yet."); return; }
      if (distanceUnserviceable) { setError("We don't deliver beyond 10 km yet. Please check our service area."); return; }
      setAddressConfirmed(true);
      setStep("delivery");
      return;
    }

    if (!name.trim()) { setError("Please enter your name."); return; }
    if (phone.replace(/\D/g, "").length !== 10) { setError("Enter a valid 10-digit number."); return; }
    if (!otpVerified) { setError("Please verify your phone number."); return; }
    if (locQuestion === "unanswered") {
      setError("Please tell us whether you're currently at this delivery address.");
      return;
    }
    if (!addressLine.trim()) { setError("Please enter your delivery address."); return; }
    if (!area.trim()) { setError("Please enter your area / locality."); return; }
    if (!city.trim()) { setError("Please enter your city."); return; }
    if (pincode.replace(/\D/g, "").length !== 6) { setError("Enter a valid 6-digit pincode."); return; }
    if (pinStatus.state === "checking") { setError("Checking pincode availability…"); return; }
    if (pinStatus.state === "unserviceable") { setError("We don't deliver to this pincode yet."); return; }
    if (distanceUnserviceable) { setError("We don't deliver beyond 10 km yet. Please check our service area."); return; }

    const fullAddress = `[${effectiveLabel}] ${addressLine.trim()}, ${area.trim()}, ${city.trim()} - ${pincode.trim()}`;
    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      setAddressConfirmed(true);
      setStep("delivery");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /* ── Delivery step gating ─────────────────────────────────────────────── */
  function submitDeliveryStep() {
    setError("");
    if (!deliveryDate) { setError("Please pick a delivery date."); return; }
    if (!deliverySlot) { setError("Please pick a delivery time."); return; }
    setStep("payment");
  }

  /* ── Order confirmations (fire-and-forget) ────────────────────────────── */
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
    } catch { /* silent */ }
  }

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
    } catch { /* silent */ }
  }

  /* ── Subscriptions fan-out ────────────────────────────────────────────── */
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

  /* ── Resolve address+phone+name for order placement ───────────────────── */
  function resolveOrderIdentity() {
    const isReturning = formMode === "returning" && savedCustomer;
    const fullAddress = isReturning
      ? (savedCustomer!.delivery_address ?? "")
      : `[${effectiveLabel}] ${addressLine.trim()}, ${area.trim()}, ${city.trim()} - ${pincode.trim()}`;
    const customerPhone = isReturning ? (savedCustomer!.phone ?? "") : phone;
    const customerName = isReturning ? (savedCustomer!.full_name ?? "") : name.trim();
    return { fullAddress, customerPhone, customerName };
  }

  /* ── COD ──────────────────────────────────────────────────────────────── */
  async function placeOrderCOD() {
    const { fullAddress, customerPhone, customerName } = resolveOrderIdentity();
    // Defensive: should be unreachable since step 1 gates on otpVerified,
    // but if a user clears sessionStorage / cookies mid-flow the server
    // would reject place_order. Bounce back to step 1 with a clear msg
    // instead of letting "Phone verification required" surface here.
    if (!otpVerified) {
      setError("Please verify your phone number before paying.");
      setStep("address");
      return;
    }
    if (distanceUnserviceable) {
      setError("We don't deliver beyond 10 km yet. Please check our service area.");
      setStep("address");
      return;
    }
    setOrderLoading(true); setError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "place_order",
          customer_id: customer?.id,
          delivery_address: fullAddress,
          pincode: fullAddress.match(/(\d{6})\s*$/)?.[1] ?? "",
          delivery_date: deliveryDate,
          delivery_slot: deliverySlot,
          total_amount: total,
          items: orderItems,
          ...(orderLat !== null && orderLng !== null ? { latitude: orderLat, longitude: orderLng } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Order failed."); return; }
      const oid = data.order_id ?? "";
      if (oid) {
        sendOrderSMS(oid, fullAddress, customerPhone, customerName);
        sendOrderWhatsApp(oid, fullAddress, customerPhone, customerName);
      }
      const { city: subCity, pincode: subPincode } = extractCityPincode(fullAddress);
      const subFailed = await submitSubscriptions(fullAddress, customerName, customerPhone, subCity, subPincode);
      if (subFailed > 0) {
        setError(
          `Order placed, but ${subFailed} subscription${subFailed > 1 ? "s" : ""} couldn't be tracked. They won't appear under "Track your subscription" until the subscriptions table is set up. Contact support.`,
        );
        return;
      }
      finishOrder(oid);
    } catch {
      setError("Something went wrong.");
    } finally {
      setOrderLoading(false);
    }
  }

  /* ── Razorpay ─────────────────────────────────────────────────────────── */
  async function payOnline() {
    // Same defensive check as COD — server rejects place_order without
    // a valid OTP cookie, so refuse to even open the gateway.
    if (!otpVerified) {
      setError("Please verify your phone number before paying.");
      setStep("address");
      return;
    }
    if (distanceUnserviceable) {
      setError("We don't deliver beyond 10 km yet. Please check our service area.");
      setStep("address");
      return;
    }
    setOrderLoading(true); setError("");
    try {
      const res = await fetch("/api/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subtotal: total,
          lat:      orderLat,
          lng:      orderLng,
          pincode:  effectivePincode || undefined,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string; code?: string };
        if (errData.code === "distance_unserviceable") {
          setError(errData.error ?? "We don't deliver beyond 10 km yet.");
          setStep("address");
        } else {
          setError("Online payment unavailable. Please use Cash on Delivery.");
        }
        return;
      }
      const { order_id, amount: serverAmount } = await res.json() as { order_id: string; amount: number };

      const loaded = await new Promise<boolean>((resolve) => {
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

      const { fullAddress, customerPhone, customerName } = resolveOrderIdentity();
      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: serverAmount,  // server-computed paise — must match the Razorpay order
        currency: "INR",
        name: "Cadieux",
        description: "Protein Bread",
        order_id,
        handler: async (response: { razorpay_payment_id: string }) => {
          setOrderLoading(true);
          const r = await fetch("/api/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "place_order",
              customer_id: customer?.id,
              delivery_address: fullAddress,
              pincode: fullAddress.match(/(\d{6})\s*$/)?.[1] ?? "",
              delivery_date: deliveryDate,
              delivery_slot: deliverySlot,
              total_amount: total,
              items: orderItems,
              ...(orderLat !== null && orderLng !== null ? { latitude: orderLat, longitude: orderLng } : {}),
            }),
          });
          const d = await r.json();
          setOrderLoading(false);
          console.log("[Payment] Success, Razorpay ID:", response.razorpay_payment_id);
          const oid = d.order_id ?? "";
          if (oid) {
            sendOrderSMS(oid, fullAddress, customerPhone, customerName);
            sendOrderWhatsApp(oid, fullAddress, customerPhone, customerName);
          }
          const { city: subCity, pincode: subPincode } = extractCityPincode(fullAddress);
          const subFailed = await submitSubscriptions(fullAddress, customerName, customerPhone, subCity, subPincode);
          if (subFailed > 0) {
            setError(
              `Payment received, but ${subFailed} subscription${subFailed > 1 ? "s" : ""} couldn't be tracked. They won't appear under "Track your subscription" until the subscriptions table is set up. Contact support.`,
            );
            return;
          }
          finishOrder(oid);
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

  /* ── Success bridge ───────────────────────────────────────────────────── */
  function finishOrder(orderId: string) {
    const shortId = orderId
      ? orderId.slice(0, 8).toUpperCase()
      : Math.random().toString(36).slice(2, 10).toUpperCase();
    // Mark the order as finishing BEFORE clearing the cart so the
    // empty-cart bounce effect doesn't fire router.replace("/cart")
    // and clobber the success redirect below.
    orderFinishingRef.current = true;
    clearCart();
    // Pass the full UUID alongside the short id so the success page can
    // deep-link into /orders/<id>. Short id stays for display only.
    const qs = new URLSearchParams({ order: shortId });
    if (orderId) qs.set("id", orderId);
    router.push(`/checkout/success?${qs.toString()}`);
  }

  /* ── Header bits ──────────────────────────────────────────────────────── */
  const firstName =
    (formMode === "returning" && savedCustomer?.full_name?.split(" ")[0]) ||
    (name.trim() ? name.trim().split(" ")[0] : "");
  const greeting = firstName ? `Welcome back, ${firstName}` : "";

  const stepLabel =
    step === "address"
      ? "Address (1 of 3)"
      : step === "delivery"
        ? "Delivery (2 of 3)"
        : "Payment (3 of 3)";

  function onBack() {
    if (step === "payment") setStep("delivery");
    else if (step === "delivery") setStep("address");
    else router.push("/cart");
  }

  /* ── Render ───────────────────────────────────────────────────────────── */
  // Render guard: empty cart redirects via the effect above; in the meantime
  // render nothing to avoid a flash of the empty-cart checkout.
  if (cart.length === 0) return null;

  return (
    <div style={{ minHeight: "100dvh", background: "#0e0e0e", position: "relative", overflowX: "clip" }}>
      <style>{`
        input::placeholder { color: rgba(240,223,200,0.32); }
        select::-ms-expand { display: none; }
      `}</style>

      {/* Grain */}
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.05, pointerEvents: "none", zIndex: 0 }} />

      {/* ── Sticky header ──────────────────────────────────────────────── */}
      <header
        style={{
          position: "sticky", top: 0, zIndex: 50,
          background: "rgba(14,14,14,0.92)",
          backdropFilter: "saturate(140%) blur(12px)",
          WebkitBackdropFilter: "saturate(140%) blur(12px)",
          borderBottom: "1px solid rgba(240,223,200,0.06)",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <div
          style={{
            maxWidth: 640, margin: "0 auto",
            padding: "12px 18px",
            display: "grid", gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center", gap: 12,
          }}
        >
          <button
            onClick={onBack}
            aria-label="Back"
            style={{
              justifySelf: "start",
              background: "none", border: "none", cursor: "pointer",
              padding: 10, minWidth: 44, minHeight: 44,
              display: "flex", alignItems: "center",
              fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
              letterSpacing: "0.35em", textTransform: "uppercase",
              color: "rgba(240,223,200,0.55)",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            ← Back
          </button>
          <div
            style={{
              justifySelf: "center",
              fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 300,
              letterSpacing: "0.45em", color: "#FBF3D4",
            }}
          >
            CADIEUX
          </div>
          <div
            style={{
              justifySelf: "end",
              fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
              letterSpacing: "0.25em", textTransform: "uppercase",
              color: "rgba(200,144,58,0.65)",
              maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {greeting}
          </div>
        </div>
      </header>

      {/* ── Main column ────────────────────────────────────────────────── */}
      <main
        style={{
          position: "relative", zIndex: 1,
          maxWidth: 640, margin: "0 auto",
          padding: "28px 20px 140px",
        }}
      >
        {/* Progress label */}
        <p
          style={{
            margin: "0 0 6px",
            fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
            letterSpacing: "0.5em", textTransform: "uppercase",
            color: "rgba(200,144,58,0.7)",
          }}
        >
          {stepLabel}
        </p>
        <h1
          style={{
            margin: "0 0 24px",
            fontFamily: "var(--font-heading)", fontSize: "clamp(34px,7vw,46px)",
            fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.04em", lineHeight: 1.1,
          }}
        >
          {step === "address" ? "Your Address" : step === "delivery" ? "Pick a Time" : "Payment"}
        </h1>

        {/* Standalone >10 km warning — surfaces independent of the
            summary so the customer sees why we can't deliver even
            before they've pressed Continue. */}
        {step === "address" && distanceUnserviceable && (
          <div
            style={{
              padding: "12px 16px", marginBottom: 24,
              background: "rgba(245,75,75,0.08)",
              border: "1px solid rgba(245,75,75,0.3)",
              fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200,
              color: "#f87171", letterSpacing: "0.03em", lineHeight: 1.5,
            }}
          >
            We don&apos;t deliver beyond 10 km yet. Please check our delivery area or choose a different address.
          </div>
        )}

        {/* Order summary — shown on the delivery step (after the
            address is confirmed AND a real quote is in hand). The
            address step intentionally hides this so the form stays
            clean; the payment step has its own PaymentReview block. */}
        {step === "delivery" && showSummary && (
          <section style={{ marginBottom: 32 }}>
            <p style={sectionHead}>Your Order</p>
            {cart.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex", justifyContent: "space-between",
                  borderTop: "1px solid rgba(240,223,200,0.07)",
                  padding: "12px 0",
                }}
              >
                <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200, color: "rgba(240,223,200,0.7)", letterSpacing: "0.03em" }}>
                  {item.name} × {item.qty}
                </span>
                <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200, color: "#FBF3D4" }}>
                  ₹{item.price * item.qty}
                </span>
              </div>
            ))}
            <div
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                borderTop: "1px solid rgba(240,223,200,0.07)",
                padding: "12px 0",
              }}
            >
              <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200, color: "rgba(240,223,200,0.7)" }}>
                Delivery fee
                {deliveryQuote?.distanceKm !== null && deliveryQuote?.distanceKm !== undefined && (
                  <span style={{ fontSize: 11, color: "rgba(240,223,200,0.38)", marginLeft: 6 }}>
                    ({deliveryQuote.distanceKm} km)
                  </span>
                )}
              </span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200, color: quoteLoading ? "rgba(240,223,200,0.4)" : "#FBF3D4" }}>
                {quoteLoading ? "…" : `₹${deliveryFee}`}
              </span>
            </div>
            <div
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                borderTop: "1px solid rgba(240,223,200,0.14)",
                paddingTop: 14, marginTop: 4,
              }}
            >
              <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(240,223,200,0.4)" }}>Total (incl. GST)</span>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: 28, fontWeight: 300, color: "#FBF3D4" }}>₹{grandTotal}</span>
            </div>
          </section>
        )}

        {/* ── ADDRESS STEP ─────────────────────────────────────────────── */}
        {step === "address" && (
          <>
            {formMode === "returning" && savedCustomer ? (
              <section>
                <p style={sectionHead}>Saved Details</p>
                <div
                  style={{
                    background: "rgba(240,223,200,0.04)",
                    border: "1px solid rgba(240,223,200,0.12)",
                    padding: "18px 20px",
                    marginBottom: 16,
                    position: "relative",
                  }}
                >
                  {/* Inline Edit / Delete — directly on the address card so
                      the customer doesn't have to scroll or hunt through a
                      submenu to manage their saved address. */}
                  <div style={{ position: "absolute", top: 10, right: 12, display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => { setFormMode("edit"); setError(""); setAddressConfirmed(false); }}
                      style={{
                        background: "none", border: "1px solid rgba(240,223,200,0.18)",
                        padding: "4px 10px", cursor: "pointer",
                        fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300,
                        letterSpacing: "0.3em", textTransform: "uppercase",
                        color: "rgba(240,223,200,0.7)",
                        WebkitTapHighlightColor: "transparent",
                      }}
                      aria-label="Edit saved address"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm("Delete saved details? You'll need to enter your address again next time.")) return;
                        try { localStorage.removeItem("cadieux_phone"); } catch { /* private mode */ }
                        try { sessionStorage.removeItem("cadieux_verified_phone"); } catch { /* private mode */ }
                        setSavedCustomer(null);
                        setCustomer(null);
                        setFormMode("fresh");
                        setName(""); setPhone(""); setAddressLine(""); setArea(""); setCity(""); setPincode("");
                        setOtpVerified(false); setOtpSent(false); setOtpCode(""); setOtpError("");
                        setError("");
                        setAddressConfirmed(false);
                      }}
                      style={{
                        background: "none", border: "1px solid rgba(245,75,75,0.35)",
                        padding: "4px 10px", cursor: "pointer",
                        fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300,
                        letterSpacing: "0.3em", textTransform: "uppercase",
                        color: "#f87171",
                        WebkitTapHighlightColor: "transparent",
                      }}
                      aria-label="Delete saved address"
                    >
                      Delete
                    </button>
                  </div>
                  <p style={{ margin: "0 0 6px", paddingRight: 120, fontFamily: "var(--font-body)", fontSize: 17, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.04em" }}>
                    {savedCustomer.full_name}
                  </p>
                  <p style={{ margin: "0 0 6px", fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 200, color: "rgba(240,223,200,0.65)", letterSpacing: "0.04em" }}>
                    +91 {savedCustomer.phone}
                  </p>
                  {savedCustomer.delivery_address && (
                    <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200, color: "rgba(240,223,200,0.5)", letterSpacing: "0.03em", lineHeight: 1.7 }}>
                      {savedCustomer.delivery_address}
                    </p>
                  )}
                </div>

                <PincodeStatusStrip pinStatus={pinStatus} />

                {/*
                  Inline OTP prompt for returning customers whose
                  session-verified cookie is missing (e.g. first
                  checkout this session, or cleared cookies). Without
                  this, they'd hit the saved-details "Continue" CTA,
                  reach payment, and only THEN see the server's
                  "Phone verification required" error. Forcing OTP at
                  step 1 means payment never has to surface that gate.
                */}
                {!otpVerified && (
                  <SavedCustomerOtpBlock
                    phone={savedCustomer.phone}
                    otpSent={otpSent}
                    otpCode={otpCode}
                    setOtpCode={setOtpCode}
                    otpError={otpError}
                    setOtpError={setOtpError}
                    sendOtp={sendOtp}
                    verifyOtp={verifyOtp}
                    sendingOtp={sendingOtp}
                    verifyingOtp={verifyingOtp}
                  />
                )}
                {otpVerified && (
                  <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300, letterSpacing: "0.25em", textTransform: "uppercase", color: "#4ade80" }}>
                    ✓ Phone Verified
                  </p>
                )}

                <button
                  onClick={() => { setFormMode("edit"); setError(""); setAddressConfirmed(false); }}
                  style={{
                    display: "block", width: "100%",
                    background: "transparent",
                    border: "1px solid rgba(240,223,200,0.16)",
                    minHeight: 48, padding: "14px 0",
                    cursor: "pointer",
                    fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                    letterSpacing: "0.4em", textTransform: "uppercase",
                    color: "rgba(240,223,200,0.6)",
                    WebkitTapHighlightColor: "transparent",
                    marginBottom: 20,
                  }}
                >
                  Edit Details
                </button>

                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <div style={{ flex: 1, height: 1, background: "rgba(240,223,200,0.08)" }} />
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(240,223,200,0.28)" }}>or</span>
                  <div style={{ flex: 1, height: 1, background: "rgba(240,223,200,0.08)" }} />
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
                    cursor: "pointer", padding: "12px 0",
                    fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
                    letterSpacing: "0.35em", textTransform: "uppercase",
                    color: "rgba(200,144,58,0.55)",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  Order with a Different Number
                </button>
              </section>
            ) : (
              <AddressForm
                formMode={formMode}
                name={name}
                setName={setName}
                phone={phone}
                setPhone={setPhone}
                otpSent={otpSent}
                otpCode={otpCode}
                setOtpCode={setOtpCode}
                otpVerified={otpVerified}
                setOtpVerified={setOtpVerified}
                setOtpSent={setOtpSent}
                otpError={otpError}
                setOtpError={setOtpError}
                sendOtp={sendOtp}
                verifyOtp={verifyOtp}
                sendingOtp={sendingOtp}
                verifyingOtp={verifyingOtp}
                addressLine={addressLine}
                setAddressLine={setAddressLine}
                area={area}
                setArea={setArea}
                city={city}
                setCity={setCity}
                pincode={pincode}
                setPincode={setPincode}
                pinStatus={pinStatus}
                setError={setError}
                savedCustomer={savedCustomer}
                onCoordsCapture={(lat, lng) => { setOrderLat(lat); setOrderLng(lng); }}
                onBackToSaved={() => {
                  if (!savedCustomer) return;
                  setFormMode("returning");
                  setName(savedCustomer.full_name ?? "");
                  setPhone(savedCustomer.phone ?? "");
                  setCustomer(savedCustomer);
                  prefillAddress(savedCustomer.delivery_address ?? "");
                  setOtpVerified(true); setOtpSent(false); setOtpCode(""); setOtpError(""); setError("");
                }}
                locQuestion={locQuestion}
                setLocQuestion={setLocQuestion}
                addressLabel={addressLabel}
                setAddressLabel={setAddressLabel}
                customLabel={customLabel}
                setCustomLabel={setCustomLabel}
              />
            )}
          </>
        )}

        {/* ── DELIVERY STEP ────────────────────────────────────────────── */}
        {step === "delivery" && (
          <DeliveryScheduleSection
            tomorrowIso={tomorrowIso}
            dayAfterIso={dayAfterIso}
            deliveryDate={deliveryDate}
            deliverySlot={deliverySlot}
            onPickDate={(d) => { setDeliveryDate(d); setError(""); }}
            onPickSlot={(s) => { setDeliverySlot(s); setError(""); }}
          />
        )}

        {/* ── PAYMENT STEP ─────────────────────────────────────────────── */}
        {step === "payment" && (
          <PaymentReview
            grandTotal={grandTotal}
            deliveryFee={deliveryFee}
            customerName={formMode === "returning" && savedCustomer ? savedCustomer.full_name : name}
            customerPhone={formMode === "returning" && savedCustomer ? savedCustomer.phone : phone}
            fullAddress={
              formMode === "returning" && savedCustomer
                ? (savedCustomer.delivery_address ?? "")
                : `[${effectiveLabel}] ${addressLine}, ${area}, ${city} - ${pincode}`
            }
            deliveryDate={deliveryDate}
            deliverySlot={deliverySlot}
          />
        )}

        {error && (
          <p style={{ margin: "16px 0 0", fontFamily: "var(--font-body)", fontSize: 13, color: "#e05a5a", letterSpacing: "0.04em" }}>
            {error}
          </p>
        )}

        {/* Single Turnstile widget for the entire address step.
            One solve here satisfies BOTH gates:
              • Send OTP    (server-verified via /api/verify/send)
              • Continue to Delivery (client-side gate)
            so the customer never re-solves the captcha. Visible on
            BOTH the saved-details and the new-address paths. */}
        {step === "address" && (
          <div
            style={{
              marginTop: 28,
              padding: "18px 18px 16px",
              border: "1px solid rgba(200,144,58,0.22)",
              background: "rgba(200,144,58,0.04)",
            }}
          >
            <p
              style={{
                margin: "0 0 10px",
                fontFamily: "var(--font-body)",
                fontSize: 10,
                fontWeight: 300,
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                color: "rgba(200,144,58,0.85)",
              }}
            >
              Human Check
            </p>
            <p
              style={{
                margin: "0 0 12px",
                fontFamily: "var(--font-body)",
                fontSize: 12,
                fontWeight: 200,
                lineHeight: 1.5,
                letterSpacing: "0.02em",
                color: "rgba(240,223,200,0.55)",
              }}
            >
              Solve once to verify your phone and continue to delivery.
            </p>
            <TurnstileWidget
              ref={turnstileRef}
              onVerify={(t) => setTurnstileToken(t)}
              onExpire={() => setTurnstileToken("")}
            />
          </div>
        )}
      </main>

      {/* ── Sticky bottom CTA bar ──────────────────────────────────────── */}
      <div
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60,
          background: "rgba(14,14,14,0.96)",
          backdropFilter: "saturate(140%) blur(12px)",
          WebkitBackdropFilter: "saturate(140%) blur(12px)",
          borderTop: "1px solid rgba(240,223,200,0.08)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "14px 20px" }}>
          {/* Live price summary — only visible on delivery/payment
              steps once the address is confirmed AND a real quote is
              in hand. Hidden on the address step so the form stays
              clean (no prices, no fee, no total). */}
          {step !== "address" && showSummary && cart.length > 0 && (
            <div
              style={{
                display: "flex", alignItems: "baseline", justifyContent: "space-between",
                gap: 12, marginBottom: 10,
                paddingBottom: 10,
                borderBottom: "1px solid rgba(240,223,200,0.08)",
                fontFamily: "var(--font-body)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(240,223,200,0.4)" }}>
                  Subtotal ₹{total} · Delivery {quoteLoading ? "…" : `₹${deliveryFee}`}
                  {deliveryQuote?.distanceKm !== null && deliveryQuote?.distanceKm !== undefined && (
                    <span style={{ color: "rgba(240,223,200,0.32)" }}>
                      {" "}({deliveryQuote.distanceKm} km)
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 11, fontWeight: 200, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(240,223,200,0.55)" }}>
                  Total (incl. GST)
                </span>
              </div>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: 22, fontWeight: 300, color: "#FBF3D4", whiteSpace: "nowrap" }}>
                ₹{grandTotal}
              </span>
            </div>
          )}
          {step === "address" && pinStatus.state === "unserviceable" ? (
            <button
              onClick={submitDeliveryRequest}
              disabled={requestSubmitting}
              style={primaryBtn(requestSubmitting)}
            >
              {requestSubmitting ? "Sending…" : "Send Request to Deliver Here"}
            </button>
          ) : step === "address" ? (
            <button
              onClick={submitAddressStep}
              disabled={
                submitting ||
                !turnstileToken ||
                (formMode !== "returning" && locQuestion === "unanswered")
              }
              style={primaryBtn(
                submitting ||
                  !turnstileToken ||
                  (formMode !== "returning" && locQuestion === "unanswered"),
              )}
            >
              {submitting ? "Saving…" : "Continue to Delivery"}
            </button>
          ) : step === "delivery" ? (
            <button onClick={submitDeliveryStep} style={primaryBtn(false)}>
              Continue to Payment
            </button>
          ) : (
            <PaymentButtons
              onCOD={placeOrderCOD}
              onOnline={payOnline}
              loading={orderLoading}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Primary CTA style helper ────────────────────────────────────────── */
function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "block", width: "100%",
    height: 56,
    background: disabled ? "rgba(245,158,11,0.5)" : "#f59e0b",
    border: "none",
    cursor: disabled ? "default" : "pointer",
    fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 400,
    letterSpacing: "0.4em", textTransform: "uppercase",
    color: "#080604",
    WebkitTapHighlightColor: "transparent",
  };
}

/* ── Address form (extracted to keep the parent render readable) ───── */
function AddressForm(props: {
  formMode: FormMode;
  name: string; setName: (s: string) => void;
  phone: string; setPhone: (s: string) => void;
  otpSent: boolean; setOtpSent: (b: boolean) => void;
  otpCode: string; setOtpCode: (s: string) => void;
  otpVerified: boolean; setOtpVerified: (b: boolean) => void;
  otpError: string; setOtpError: (s: string) => void;
  sendOtp: () => void;
  verifyOtp: () => void;
  sendingOtp: boolean;
  verifyingOtp: boolean;
  addressLine: string; setAddressLine: (s: string) => void;
  area: string; setArea: (s: string) => void;
  city: string; setCity: (s: string) => void;
  pincode: string; setPincode: (s: string) => void;
  pinStatus: PinState;
  setError: (s: string) => void;
  savedCustomer: Customer | null;
  onCoordsCapture: (lat: number | null, lng: number | null) => void;
  onBackToSaved: () => void;
  locQuestion: "unanswered" | "yes" | "no";
  setLocQuestion: (q: "unanswered" | "yes" | "no") => void;
  addressLabel: "Home" | "Work" | "Other";
  setAddressLabel: (l: "Home" | "Work" | "Other") => void;
  customLabel: string;
  setCustomLabel: (s: string) => void;
}) {
  const {
    name, setName, phone, setPhone,
    otpSent, setOtpSent, otpCode, setOtpCode,
    otpVerified, setOtpVerified, otpError, setOtpError,
    sendOtp, verifyOtp, sendingOtp, verifyingOtp,
    addressLine, setAddressLine, area, setArea,
    city, setCity, pincode, setPincode,
    pinStatus, setError, savedCustomer, onCoordsCapture, onBackToSaved,
    locQuestion, setLocQuestion,
    addressLabel, setAddressLabel, customLabel, setCustomLabel,
  } = props;

  // Load Maps JS API (places library needed for Autocomplete).
  const { isLoaded: mapsLoaded } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  // Map picker modal open state — opened only after the user answers "Yes"
  // to the location question. The modal handles GPS + draggable pin + Places
  // search itself; on Confirm it returns address fields + coords.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [locMsg, setLocMsg] = useState<string | null>(null);

  // Autocomplete instance ref
  const acRef = useRef<google.maps.places.Autocomplete | null>(null);

  // Callback used by <LocationPickerModal> on Confirm — fills address fields
  // and pushes the chosen pin's coords up to the parent so the delivery
  // quote refreshes against the real GPS coordinate, not the pincode centroid.
  const handlePickerConfirm = useCallback(
    (result: { line1: string; area: string; city: string; pincode: string; lat: number; lng: number }) => {
      if (result.line1) { setAddressLine(result.line1); setError(""); }
      if (result.area) { setArea(result.area); setError(""); }
      if (result.pincode) { setPincode(result.pincode); setError(""); }
      if (result.city) { setCity(result.city); setError(""); }
      onCoordsCapture(result.lat, result.lng);
      setLocMsg(null);
      setPickerOpen(false);
    },
    [setAddressLine, setArea, setCity, setPincode, setError, onCoordsCapture],
  );

  // Parse a Google Place into address fields + coords
  const handlePlaceChanged = useCallback(() => {
    const place = acRef.current?.getPlace();
    if (!place || !place.address_components) return;
    const pick = (type: string) =>
      place.address_components!.find((c) => c.types.includes(type))?.long_name ?? "";
    const streetNum = pick("street_number");
    const route = pick("route");
    const premise = pick("premise") || pick("subpremise");
    const line1Parts = [premise, streetNum, route].filter(Boolean);
    const line1 =
      line1Parts.join(" ").trim() ||
      (place.formatted_address ?? "").split(",")[0].trim();
    const placeArea =
      pick("sublocality_level_1") || pick("sublocality") ||
      pick("neighborhood") || pick("sublocality_level_2") || "";
    const placeCity =
      pick("locality") || pick("administrative_area_level_3") ||
      pick("administrative_area_level_2") || "";
    const placePincode = pick("postal_code");
    const lat = place.geometry?.location?.lat() ?? null;
    const lng = place.geometry?.location?.lng() ?? null;
    if (line1) { setAddressLine(line1); setError(""); }
    if (placeArea) { setArea(placeArea); setError(""); }
    if (placePincode) { setPincode(placePincode); setError(""); }
    if (placeCity) { setCity(placeCity); setError(""); }
    onCoordsCapture(lat, lng);
  }, [setAddressLine, setArea, setCity, setPincode, setError, onCoordsCapture]);

  return (
    <section>
      <p style={sectionHead}>Your Details</p>

      <label style={{ display: "block", marginBottom: 18 }}>
        <span style={labelSt}>Full Name *</span>
        <input
          type="text" value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          placeholder="e.g. Arjun Sharma"
          autoComplete="name"
          style={inputSt}
        />
      </label>

      {/* Mobile + OTP */}
      <div style={{ marginBottom: 18 }}>
        <span style={labelSt}>Mobile Number *</span>
        <div style={{ display: "flex", alignItems: "stretch", gap: 10 }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", ...inputSt, padding: 0 }}>
            <span style={{ padding: "0 6px 0 14px", fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 200, color: "rgba(240,223,200,0.5)", userSelect: "none", letterSpacing: "0.05em" }}>+91</span>
            <input
              type="tel" inputMode="numeric" autoComplete="tel-national"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                setOtpError(""); setError("");
                if (otpVerified) { setOtpVerified(false); setOtpSent(false); setOtpCode(""); }
              }}
              placeholder="10-digit number"
              style={{
                flex: 1, background: "none", border: "none", outline: "none",
                padding: "0 12px", height: 46,
                fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 200,
                color: "#FBF3D4", letterSpacing: "0.05em",
              }}
            />
          </div>
          {otpVerified ? (
            <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", gap: 4 }}>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300, letterSpacing: "0.2em", color: "#4ade80" }}>✓ Verified</span>
              <button
                onClick={() => { setOtpVerified(false); setOtpSent(false); setOtpCode(""); setOtpError(""); }}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)", WebkitTapHighlightColor: "transparent" }}
              >
                Edit
              </button>
            </div>
          ) : (
            <button
              onClick={sendOtp}
              disabled={sendingOtp || phone.replace(/\D/g, "").length < 10}
              style={{
                flexShrink: 0, minHeight: 48,
                background: "none",
                border: "1px solid rgba(200,144,58,0.5)",
                padding: "0 16px",
                cursor: (sendingOtp || phone.replace(/\D/g, "").length < 10) ? "default" : "pointer",
                fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: (sendingOtp || phone.replace(/\D/g, "").length < 10) ? "rgba(200,144,58,0.3)" : "rgba(200,144,58,0.9)",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {sendingOtp ? "Sending…" : otpSent ? "Resend" : "Send OTP"}
            </button>
          )}
        </div>

        {otpSent && !otpVerified && (
          <div style={{ marginTop: 14 }}>
            <span style={labelSt}>Enter OTP *</span>
            <input
              type="text" inputMode="numeric" autoComplete="one-time-code"
              maxLength={6}
              value={otpCode}
              onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setOtpError(""); }}
              placeholder="6-digit code"
              style={{ ...inputSt, letterSpacing: "0.4em", fontSize: 19, borderColor: "rgba(200,144,58,0.45)" }}
              autoFocus
            />
            <button
              onClick={verifyOtp}
              disabled={verifyingOtp || otpCode.replace(/\D/g, "").length < 6}
              style={{
                marginTop: 12, display: "block", width: "100%",
                height: 48,
                background: (verifyingOtp || otpCode.replace(/\D/g, "").length < 6) ? "rgba(240,223,200,0.12)" : "#f0dfc8",
                border: "none",
                cursor: (verifyingOtp || otpCode.replace(/\D/g, "").length < 6) ? "default" : "pointer",
                fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                letterSpacing: "0.4em", textTransform: "uppercase",
                color: (verifyingOtp || otpCode.replace(/\D/g, "").length < 6) ? "rgba(8,6,4,0.35)" : "#080604",
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

      {/* ── Location question (REQUIRED) ───────────────────────────── */}
      <div style={{ marginBottom: 18 }}>
        <span style={labelSt}>Are you at this delivery address right now? *</span>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          {(["yes", "no"] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => { setLocQuestion(choice); setLocMsg(null); setError(""); }}
              style={{
                flex: 1, minHeight: 40,
                background: locQuestion === choice ? "rgba(200,144,58,0.18)" : "none",
                border: `1px solid ${locQuestion === choice ? "rgba(200,144,58,0.75)" : "rgba(200,144,58,0.3)"}`,
                cursor: "pointer",
                fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: locQuestion === choice ? "rgba(200,144,58,0.95)" : "rgba(200,144,58,0.5)",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {choice === "yes" ? "Yes" : "No"}
            </button>
          ))}
        </div>

        {locQuestion === "yes" && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            style={{
              display: "block", width: "100%", marginTop: 10,
              minHeight: 44,
              background: "none",
              border: "1px solid rgba(200,144,58,0.5)",
              cursor: "pointer",
              fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
              letterSpacing: "0.3em", textTransform: "uppercase",
              color: "rgba(200,144,58,0.9)",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            📍 Pick on map
          </button>
        )}

        {locQuestion === "no" && (
          <p style={{ margin: "8px 0 0", fontFamily: "var(--font-body)", fontSize: 12, color: "rgba(240,223,200,0.55)", letterSpacing: "0.03em", lineHeight: 1.5 }}>
            No problem — please enter the delivery address below.
          </p>
        )}

        {locMsg && (
          <p style={{ margin: "8px 0 0", fontFamily: "var(--font-body)", fontSize: 12, color: "#e09a5a", letterSpacing: "0.03em", lineHeight: 1.5 }}>
            {locMsg}
          </p>
        )}
      </div>

      {pickerOpen && (
        <LocationPickerModal
          onClose={() => setPickerOpen(false)}
          onConfirm={handlePickerConfirm}
        />
      )}

      {/* ── Delivery Address (Places Autocomplete) ──────────────────── */}
      <label style={{ display: "block", marginBottom: 18 }}>
        <span style={labelSt}>Delivery Address *</span>
        {mapsLoaded ? (
          <Autocomplete
            onLoad={(ac) => { acRef.current = ac; }}
            onPlaceChanged={handlePlaceChanged}
            options={{
              componentRestrictions: { country: "in" },
              fields: ["geometry", "address_components", "formatted_address"],
              types: ["geocode", "establishment"],
            }}
          >
            <input
              type="text" value={addressLine}
              onChange={(e) => { setAddressLine(e.target.value); setError(""); onCoordsCapture(null, null); }}
              placeholder="Flat no. / House no. / Building name"
              autoComplete="off"
              style={inputSt}
            />
          </Autocomplete>
        ) : (
          <input
            type="text" value={addressLine}
            onChange={(e) => { setAddressLine(e.target.value); setError(""); }}
            placeholder="Flat no. / House no. / Building name"
            autoComplete="address-line1"
            style={inputSt}
          />
        )}
      </label>

      <label style={{ display: "block", marginBottom: 18 }}>
        <span style={labelSt}>Area / Locality *</span>
        <input
          type="text" value={area}
          onChange={(e) => { setArea(e.target.value); setError(""); }}
          placeholder="Street / Colony / Locality"
          autoComplete="address-line2"
          style={inputSt}
        />
      </label>

      <label style={{ display: "block", marginBottom: 18 }}>
        <span style={labelSt}>Pincode *</span>
        <input
          type="text" inputMode="numeric" maxLength={6}
          value={pincode}
          onChange={(e) => { setPincode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
          placeholder="530045"
          autoComplete="postal-code"
          style={inputSt}
        />
      </label>

      <label style={{ display: "block", marginBottom: 22 }}>
        <span style={labelSt}>City *</span>
        <input
          type="text" value={city}
          onChange={(e) => { setCity(e.target.value); setError(""); }}
          placeholder="Visakhapatnam"
          autoComplete="address-level2"
          style={inputSt}
        />
      </label>

      {/* ── Address label (Home / Work / Other) ─────────────────────
          Mirrors the mobile app's Swiggy-style chip picker. Saved
          inline as a "[Label] " prefix on delivery_address. */}
      <div style={{ marginBottom: 18 }}>
        <span style={labelSt}>Label *</span>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          {(["Home", "Work", "Other"] as const).map((opt) => {
            const selected = addressLabel === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => { setAddressLabel(opt); setError(""); }}
                style={{
                  flex: 1, minHeight: 40,
                  background: selected ? "rgba(200,144,58,0.18)" : "none",
                  border: `1px solid ${selected ? "rgba(200,144,58,0.75)" : "rgba(200,144,58,0.3)"}`,
                  cursor: "pointer",
                  fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                  letterSpacing: "0.3em", textTransform: "uppercase",
                  color: selected ? "rgba(200,144,58,0.95)" : "rgba(200,144,58,0.5)",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {opt}
              </button>
            );
          })}
        </div>
        {addressLabel === "Other" && (
          <input
            type="text"
            value={customLabel}
            onChange={(e) => { setCustomLabel(e.target.value.slice(0, 40)); setError(""); }}
            placeholder="e.g. Mom's place"
            maxLength={40}
            style={{ ...inputSt, marginTop: 10 }}
          />
        )}
      </div>

      <PincodeStatusStrip pinStatus={pinStatus} />

      {savedCustomer && (
        <button
          onClick={onBackToSaved}
          style={{
            display: "block", width: "100%", background: "none", border: "none",
            cursor: "pointer", marginTop: 6,
            fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
            letterSpacing: "0.3em", textTransform: "uppercase",
            color: "rgba(240,223,200,0.3)",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          ← Back to saved details
        </button>
      )}

      {/* Human-verification widget is rendered ONCE by the parent
          CheckoutPage at the bottom of the address step (above the
          "Continue to Delivery" CTA). The single token also gates
          Send OTP above — no second widget is rendered here. */}
    </section>
  );
}

/* ── Inline OTP block for returning customer (Saved Details view) ───── */
function SavedCustomerOtpBlock(props: {
  phone: string;
  otpSent: boolean;
  otpCode: string; setOtpCode: (s: string) => void;
  otpError: string; setOtpError: (s: string) => void;
  sendOtp: () => void;
  verifyOtp: () => void;
  sendingOtp: boolean;
  verifyingOtp: boolean;
}) {
  const {
    phone, otpSent, otpCode, setOtpCode, otpError, setOtpError,
    sendOtp, verifyOtp, sendingOtp, verifyingOtp,
  } = props;

  const tail = phone.replace(/\D/g, "").slice(-4);
  return (
    <div
      style={{
        background: "rgba(245,158,11,0.05)",
        border: "1px solid rgba(245,158,11,0.25)",
        padding: "16px 18px",
        marginBottom: 16,
      }}
    >
      <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(200,144,58,0.85)" }}>
        Verify Phone
      </p>
      <p style={{ margin: "0 0 14px", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "rgba(240,223,200,0.6)", letterSpacing: "0.03em", lineHeight: 1.5 }}>
        We&rsquo;ll send a 6-digit code to your saved number ending in {tail}. Verify once per session to continue.
      </p>

      {/* Turnstile widget is rendered once by the parent at the bottom
          of the address step; the same solved token gates Send OTP. */}

      <button
        onClick={sendOtp}
        disabled={sendingOtp}
        style={{
          display: "block", width: "100%", marginTop: 14,
          minHeight: 46,
          background: "none",
          border: "1px solid rgba(200,144,58,0.5)",
          padding: "0 16px",
          cursor: sendingOtp ? "default" : "pointer",
          fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
          letterSpacing: "0.35em", textTransform: "uppercase",
          color: sendingOtp ? "rgba(200,144,58,0.3)" : "rgba(200,144,58,0.9)",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {sendingOtp ? "Sending…" : otpSent ? "Resend Code" : "Send OTP"}
      </button>

      {otpSent && (
        <div style={{ marginTop: 14 }}>
          <span style={labelSt}>Enter OTP *</span>
          <input
            type="text" inputMode="numeric" autoComplete="one-time-code"
            maxLength={6}
            value={otpCode}
            onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setOtpError(""); }}
            placeholder="6-digit code"
            style={{ ...inputSt, letterSpacing: "0.4em", fontSize: 19, borderColor: "rgba(200,144,58,0.45)" }}
            autoFocus
          />
          <button
            onClick={verifyOtp}
            disabled={verifyingOtp || otpCode.replace(/\D/g, "").length < 6}
            style={{
              marginTop: 12, display: "block", width: "100%",
              height: 48,
              background: (verifyingOtp || otpCode.replace(/\D/g, "").length < 6) ? "rgba(240,223,200,0.12)" : "#f0dfc8",
              border: "none",
              cursor: (verifyingOtp || otpCode.replace(/\D/g, "").length < 6) ? "default" : "pointer",
              fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
              letterSpacing: "0.4em", textTransform: "uppercase",
              color: (verifyingOtp || otpCode.replace(/\D/g, "").length < 6) ? "rgba(8,6,4,0.35)" : "#080604",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {verifyingOtp ? "Verifying…" : "Verify"}
          </button>
        </div>
      )}

      {otpError && (
        <p style={{ margin: "10px 0 0", fontFamily: "var(--font-body)", fontSize: 12, color: "#e05a5a", letterSpacing: "0.04em" }}>
          {otpError}
        </p>
      )}
    </div>
  );
}

/* ── Payment review card + Turnstile ────────────────────────────────── */
function PaymentReview(props: {
  grandTotal: number;
  deliveryFee: number;
  customerName: string;
  customerPhone: string;
  fullAddress: string;
  deliveryDate: string;
  deliverySlot: string;
}) {
  const {
    grandTotal, deliveryFee,
    customerName, customerPhone, fullAddress,
    deliveryDate, deliverySlot,
  } = props;

  return (
    <section>
      <div style={{ background: "rgba(240,223,200,0.04)", border: "1px solid rgba(240,223,200,0.1)", padding: "18px 20px", marginBottom: 22 }}>
        <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(240,223,200,0.4)" }}>
          Order Total
        </p>
        <p style={{ margin: "4px 0 0", fontFamily: "var(--font-heading)", fontSize: 30, fontWeight: 300, color: "#FBF3D4" }}>
          ₹{grandTotal}
        </p>
        <p style={{ margin: "4px 0 12px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, color: "rgba(240,223,200,0.45)", letterSpacing: "0.04em" }}>
          Includes ₹{deliveryFee} delivery
        </p>
        <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "rgba(240,223,200,0.55)", letterSpacing: "0.03em" }}>
          {customerName} · +91 {customerPhone.replace(/\D/g, "")}
        </p>
        <p style={{ margin: "4px 0 0", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "rgba(240,223,200,0.4)", letterSpacing: "0.03em", lineHeight: 1.6 }}>
          {fullAddress}
        </p>
        {deliveryDate && deliverySlot && (
          <p style={{ margin: "10px 0 0", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(200,144,58,0.8)" }}>
            {formatDeliveryDate(deliveryDate)} · {formatSlot12(deliverySlot)}
          </p>
        )}
      </div>
      {/*
        No Turnstile at payment — the customer's phone is already
        OTP-verified (step 1 gate) and the server enforces that via
        the cdx_phone_verified cookie at place_order. Turnstile only
        guards /api/verify/send to stop SMS-burning bots; once OTP
        is done, the bot-gate has already done its job for this
        session.
      */}
    </section>
  );
}

/* ── Payment CTAs (sticky bar variant: stacked Pay Online + COD) ────── */
function PaymentButtons({
  onCOD, onOnline, loading,
}: {
  onCOD: () => void;
  onOnline: () => void;
  loading: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button
        onClick={onOnline}
        disabled={loading}
        style={{
          display: "block", width: "100%", height: 56,
          background: loading ? "rgba(2,70,40,0.5)" : "#024628",
          border: "none",
          cursor: loading ? "default" : "pointer",
          fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 400,
          letterSpacing: "0.4em", textTransform: "uppercase",
          color: "#FBF3D4",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {loading ? "Processing…" : "Pay Online"}
      </button>
      <button
        onClick={onCOD}
        disabled={loading}
        style={{
          display: "block", width: "100%", height: 48,
          background: "transparent",
          border: "1px solid rgba(240,223,200,0.18)",
          cursor: loading ? "default" : "pointer",
          fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
          letterSpacing: "0.4em", textTransform: "uppercase",
          color: loading ? "rgba(240,223,200,0.2)" : "rgba(240,223,200,0.6)",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        Cash on Delivery
      </button>
    </div>
  );
}

/* ── Pincode serviceability indicator ────────────────────────────────── */
function PincodeStatusStrip({ pinStatus }: { pinStatus: PinState }) {
  if (pinStatus.state === "idle") return null;
  const isOk = pinStatus.state === "serviceable";
  const isBad = pinStatus.state === "unserviceable";
  const isChecking = pinStatus.state === "checking";
  const isErr = pinStatus.state === "error";
  const border = isOk
    ? "1px solid rgba(74,222,128,0.4)"
    : isBad
      ? "1px solid rgba(245,158,11,0.5)"
      : "1px solid rgba(240,223,200,0.14)";
  const bg = isOk
    ? "rgba(74,222,128,0.08)"
    : isBad
      ? "rgba(245,158,11,0.08)"
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
        marginBottom: 22,
        padding: "12px 14px",
        border,
        background: bg,
        fontFamily: "var(--font-body)",
        fontSize: 13,
        fontWeight: 300,
        letterSpacing: "0.04em",
        color: fg,
        lineHeight: 1.5,
      }}
    >
      {isChecking && "Checking pincode availability…"}
      {isOk &&
        (pinStatus.state === "serviceable" && pinStatus.area_names.length > 0
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
    <section style={{ marginBottom: 24 }}>
      <p style={sectionHead}>Pick a Date</p>

      <div style={{ display: "flex", gap: 12, marginBottom: 26 }}>
        {dates.map((d) => {
          const active = d.iso === deliveryDate;
          return (
            <button
              key={d.iso}
              type="button"
              onClick={() => onPickDate(d.iso)}
              style={{
                flex: 1,
                minHeight: 72,
                padding: "14px 12px",
                background: active ? "rgba(200,144,58,0.14)" : "transparent",
                border: active
                  ? "1px solid rgba(200,144,58,0.75)"
                  : "1px solid rgba(240,223,200,0.16)",
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                color: active ? "#FBF3D4" : "rgba(240,223,200,0.65)",
                textAlign: "left",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <div
                style={{
                  fontSize: 9, fontWeight: 200,
                  letterSpacing: "0.35em", textTransform: "uppercase",
                  color: active ? "rgba(200,144,58,0.9)" : "rgba(200,144,58,0.5)",
                  marginBottom: 6,
                }}
              >
                {d.tag}
              </div>
              <div style={{ fontSize: 14, fontWeight: 300, letterSpacing: "0.04em" }}>
                {formatDeliveryDate(d.iso)}
              </div>
            </button>
          );
        })}
      </div>

      <p style={sectionHead}>Pick a Time</p>
      <SlotPicker
        deliveryDate={deliveryDate}
        deliverySlot={deliverySlot}
        onPickSlot={onPickSlot}
      />
    </section>
  );
}

/** Slot dropdown gated by the 12h10m booking rule. Disabled options stay
 *  visible (greyed) so the user can see why "earlier today" isn't allowed.
 *  When every slot for the picked date is disabled, surfaces an inline
 *  empty-state instead of a useless dropdown. */
function SlotPicker({
  deliveryDate,
  deliverySlot,
  onPickSlot,
}: {
  deliveryDate: string;
  deliverySlot: string;
  onPickSlot: (s: string) => void;
}) {
  // Recompute on every render so the "too-soon" boundary creeps forward
  // naturally as the user sits on the page; bookableSlots is pure.
  const slots = bookableSlots(deliveryDate, new Date());
  const allDisabled = slots.length === 0 || slots.every((s) => s.disabled);

  if (allDisabled) {
    return (
      <div
        style={{
          padding: "14px 16px",
          borderRadius: 4,
          border: "1px solid rgba(200,144,58,0.45)",
          background: "rgba(200,144,58,0.06)",
          color: "rgba(240,223,200,0.85)",
          fontSize: 13,
          lineHeight: 1.5,
          letterSpacing: "0.02em",
        }}
        role="status"
      >
        No slots available for this date — please choose another day.
      </div>
    );
  }

  return (
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
        {slots.map((s) => (
          <option
            key={s.value}
            value={s.value}
            disabled={s.disabled}
            style={{
              background: "#0e0e0e",
              color: s.disabled ? "rgba(240,223,200,0.35)" : "#FBF3D4",
            }}
          >
            {formatSlot12(s.value)}
            {s.disabled ? " — too soon" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
