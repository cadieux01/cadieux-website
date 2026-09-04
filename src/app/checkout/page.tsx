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
import { trackBeginCheckout } from "@/lib/analytics";
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
import { geocodePincodeClient, reverseGeocodeClient } from "@/lib/clientGeocode";
import LocationPickerModal from "@/components/LocationPickerModal";
import Select from "@/components/ui/Select";
import {
  CustomerAddress,
  fetchAddresses,
  upsertAddressToBookBestEffort,
} from "@/lib/addresses";
// IMPORTANT: distance math is imported from "@/lib/haversine" (zero imports,
// client-safe). Do NOT import from "@/lib/geocode" — that file imports the
// Supabase admin client, which reads SUPABASE_SERVICE_ROLE_KEY at module
// load. Dragging it into this client component crashes hydration with
// "supabaseUrl is required" → blank page (the b012899 bug).
import { haversineKm } from "@/lib/haversine";
import { buildOrderPlacedWhatsApp } from "@/lib/order-messages";
import { usePreorderMode } from "@/hooks/usePreorderMode";

// Site origin for tracking links embedded in confirmation messages.
// NEXT_PUBLIC_ prefix so it's inlined into the client bundle at build.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.cadieux.in";

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

/* ── Shared styles (Task G Phase 2 — matrix-legal on ash canvas) ──────── */
// Phase 2 rule: on ash + paper, text is SOLID #024628 (6.49:1 AA);
// hierarchy comes from type-scale + weight + tracking, NOT opacity.
// Borders that form a visible boundary between surfaces are solid #024628,
// not the FG@25% --surface-border token (invisible at 1.4:1 on ash).
const inputSt: React.CSSProperties = {
  display: "block", width: "100%", boxSizing: "border-box",
  background: "transparent",
  border: "1px solid #024628",
  padding: "14px 14px", outline: "none",
  fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200,
  color: "#024628", letterSpacing: "0.04em",
  minHeight: 48,
};
const labelSt: React.CSSProperties = {
  display: "block", marginBottom: 8,
  fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
  letterSpacing: "0.4em", textTransform: "uppercase",
  color: "#024628",
};
const sectionHead: React.CSSProperties = {
  margin: "0 0 18px",
  fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
  letterSpacing: "0.5em", textTransform: "uppercase",
  color: "#024628",
};

/* ── Main page ─────────────────────────────────────────────────────────── */
export default function CheckoutPage() {
  const router = useRouter();
  const { cart, cartTotal, clearCart } = useCart();
  const total = cartTotal;
  // Site-wide pre-order toggle. `null` while first fetch is in flight,
  // then boolean. When true: date/slot pickers render disabled, submit
  // step skips the "please pick a date" gate, and server-side
  // prepareOneTimeOrder drops any client-sent date/slot anyway. Banner
  // shown on delivery + payment steps.
  const { enabled: preorderMode } = usePreorderMode();

  // GA4 begin_checkout — fire once when the checkout page first has a
  // hydrated, non-empty cart (cart loads async from localStorage).
  const beganCheckoutRef = useRef(false);
  useEffect(() => {
    if (beganCheckoutRef.current || cart.length === 0) return;
    beganCheckoutRef.current = true;
    trackBeginCheckout(cart, cartTotal);
  }, [cart, cartTotal]);

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

  // Shared address book (public.addresses) — the same rows the mobile
  // app + /account/addresses read. Fetched on mount once we have a
  // saved phone. When length > 1 we render a picker in the returning
  // section so a customer with multiple addresses (added via the app or
  // /account/addresses) can pick which one this order ships to.
  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);

  // Loading states
  const [sendingOtp, setSendingOtp] = useState(false);
  // Synchronous mirror of `sendingOtp` — see the guard in sendOtp().
  const sendingOtpRef = useRef(false);
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

  // ── Fulfillment (delivery vs pickup) ───────────────────────────────────
  // Pickup orders collect from a Cadieux stall — ₹0 fee, address is
  // synthesized server-side from pickup_locations, and pincode / distance /
  // date / slot gates all skip on the server. The delivery path below is
  // preserved byte-for-byte; every pickup override is `isPickup ? … : …`.
  type PickupLoc = {
    id: string;
    name: string;
    area: string;
    latitude: number;
    longitude: number;
    address?: string | null;
    type?: string | null;
  };
  const [fulfillmentType, setFulfillmentType] =
    useState<"delivery" | "pickup">("delivery");
  const isPickup = fulfillmentType === "pickup";
  const [pickupLocationId, setPickupLocationId] = useState<string | null>(null);
  const [pickupLocations, setPickupLocations] = useState<PickupLoc[]>([]);
  const [pickupLocationsLoading, setPickupLocationsLoading] = useState(false);

  // Reactive fee + total — update immediately when quote arrives. Pickup
  // forces ₹0 (server enforces the same in prepareOneTimeOrder).
  const deliveryFee  = isPickup ? 0 : (deliveryQuote?.feeInr  ?? DELIVERY_FEE_INR);
  const grandTotal   = total + deliveryFee;
  const distanceUnserviceable = !isPickup && deliveryQuote?.serviceable === false;

  // Render the order summary only after the user has confirmed their
  // address (Continue pressed) AND a real distance-based quote is in
  // hand. `distanceUnserviceable` short-circuits the summary in favour
  // of the standalone ">20 km" warning rendered above. Pickup skips the
  // quote gate entirely — subtotal is the total, no distance involved.
  const showSummary = addressConfirmed && (
    isPickup || (deliveryQuote !== null && !distanceUnserviceable)
  );

  // Pincode serviceability
  const [pinStatus, setPinStatus] = useState<PinState>({ state: "idle" });
  const [requestSubmitting, setRequestSubmitting] = useState(false);

  // Race-condition guard for the payment step: the address-step gate
  // blocks unserviceable pincodes, but stale cache / cleared service-area
  // / direct nav can still get a user to "Pay" with an unserviceable
  // pincode. The server's shared validator hard-blocks with
  // code:'pincode_unserviceable' on both COD (/api/checkout) and online
  // (/api/create-order). When that fires, surface the same "Send Request
  // to Deliver Here" CTA the address step uses, posting to the existing
  // /api/delivery-requests capture endpoint via submitDeliveryRequest().
  const [unserviceableAtPayment, setUnserviceableAtPayment] = useState(false);

  // Turnstile — ONE widget per checkout session. The single token gates
  // BOTH actions:
  //   1. Send OTP            (server-verified via /api/verify/send)
  //   2. Continue to Delivery (client-side gate on submitAddressStep)
  // so the customer never has to solve the challenge twice. The widget
  // renders once at the bottom of the address step, above the sticky
  // "Continue to Delivery" button — see the <main> tail below.
  // Preview-only Turnstile bypass. Cloudflare rejects the challenge on
  // unlisted *.vercel.app preview domains, so the widget can't issue a
  // token there. When NEXT_PUBLIC_TURNSTILE_BYPASS=1 (set on the Preview
  // build only), we seed a sentinel token so the gates pass — the server
  // independently allows it ONLY on non-production deploys with the
  // matching TURNSTILE_BYPASS_PREVIEW flag. Production never sets either
  // flag, so the real widget + server verification stay fully enforced.
  const TURNSTILE_BYPASS = process.env.NEXT_PUBLIC_TURNSTILE_BYPASS === "1";
  const [turnstileToken, setTurnstileToken] = useState<string>(
    TURNSTILE_BYPASS ? "preview-bypass" : "",
  );
  const turnstileRef = useRef<TurnstileHandle>(null);
  // Reset the widget after EVERY OTP send attempt — success or failure —
  // and on Turnstile expiry/error. Cloudflare siteverify tokens are
  // single-use: replaying one returns `timeout-or-duplicate`, so holding
  // the spent token made the Resend button 403 with "Human verification
  // failed" every time. Resetting re-arms the widget, which auto-solves
  // and hands back a fresh token via the onVerify callback.
  const refreshTurnstile = () => {
    if (TURNSTILE_BYPASS) return; // keep the sentinel; no real widget to reset
    setTurnstileToken("");
    turnstileRef.current?.reset();
  };

  // Client-side "is this a human?" signal for the Continue-to-Delivery gate.
  // A held Turnstile token OR a completed OTP — the OTP is the stronger
  // proof, and the server re-checks it independently (place_order requires
  // the phone-verified cookie). Accepting either matters because
  // refreshTurnstile() now blanks the token after every send: the widget
  // re-solves in about a second, and this stops that gap from disabling
  // Continue for someone who has already verified their phone.
  const humanVerified = Boolean(turnstileToken) || otpVerified;

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

    // `?edit=1` deep-links from /account/addresses → lands the wizard
    // in formMode="edit" right after prefill so the user can update
    // their saved address inline. Read via window rather than
    // useSearchParams to avoid forcing a Suspense bailout on the
    // checkout page (the static prerender would otherwise fail).
    const editParam =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("edit") === "1";

    const sessionPhone = sessionStorage.getItem("cadieux_verified_phone");
    if (sessionPhone === saved) setOtpVerified(true);

    // `slim=1` skips the full orders + subscriptions history fetch that
    // the /orders list page needs but checkout doesn't. Cuts prefill
    // latency from ~3s (subscriptions seq-scan) down to ~150ms.
    fetch(`/api/checkout?phone=${encodeURIComponent(saved)}&slim=1`)
      .then((r) => r.json())
      .then((d) => {
        // Server-side trust signal for skipping OTP. Two acceptance paths,
        // mirroring the place_order/place_subscription gate on the API:
        //   1. `phone_verified` — valid 30-min cookie / mobile bearer
        //      (just-issued OTP this session).
        //   2. `d.customer` present — a saved customer record exists for
        //      this number. Customer rows are only created post-OTP, so
        //      their existence is a longer-lived proof of past
        //      verification: returning buyers whose 30-min cookie has
        //      expired can still proceed without redoing the OTP step.
        if (d.phone_verified || d.customer) {
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
        // ?edit=1 (from /account/addresses → "Edit") drops the user
        // straight into the editable address form pre-populated with
        // their saved fields, skipping the read-only saved card.
        setFormMode(editParam ? "edit" : "returning");
      })
      .catch(() => {});
    // editParam is read once on mount; deps would re-fire the whole
    // prefill if it changed mid-session, which we don't want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the shared address book once the phone is known. Best-effort;
  // failures are silent (the returning-customer card still works off
  // customer.delivery_address alone).
  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) {
      setSavedAddresses([]);
      setSelectedAddressId(null);
      return;
    }
    let cancelled = false;
    fetchAddresses(digits)
      .then((rows) => {
        if (cancelled) return;
        setSavedAddresses(rows);
        // Seed the selection with the default row (or the row whose
        // formatted string matches the saved delivery_address) so the
        // picker highlights the row currently in play.
        const def = rows.find((r) => r.is_default) ?? rows[0] ?? null;
        setSelectedAddressId(def?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setSavedAddresses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [phone]);

  /** Build the `[Label] line1, area, city - pincode` string the order
   *  API expects from a shared-book row. */
  function formatBookAddress(a: CustomerAddress): string {
    return `[${a.label}] ${a.line1}, ${a.area}, ${a.city} - ${a.pincode}`;
  }

  /** Pick a shared-book address on the returning-customer step. Swaps
   *  the customer's delivery_address for this row + syncs the field
   *  state so an "Edit Details" flip lands in the right values. */
  function pickSavedAddress(a: CustomerAddress) {
    setSelectedAddressId(a.id);
    const built = formatBookAddress(a);
    setSavedCustomer((prev) =>
      prev ? { ...prev, delivery_address: built, city: a.city } : prev,
    );
    setCustomer((prev) =>
      prev ? { ...prev, delivery_address: built, city: a.city } : prev,
    );
    // Sync editable fields — Edit Details flip picks these up.
    setName(a.full_name);
    setAddressLine(a.line1);
    setArea(a.area);
    setCity(a.city);
    setPincode(a.pincode);
    const preset = ["Home", "Work", "Other"].find(
      (p) => p.toLowerCase() === a.label.toLowerCase(),
    );
    if (preset === "Home" || preset === "Work" || preset === "Other") {
      setAddressLabel(preset);
      setCustomLabel("");
    } else {
      setAddressLabel("Other");
      setCustomLabel(a.label);
    }
    if (a.latitude != null && a.longitude != null) {
      setOrderLat(a.latitude);
      setOrderLng(a.longitude);
    }
  }

  // Apply (not just highlight) the default saved address once BOTH the
  // address book and the customer prefill have landed. Gating on
  // savedCustomer matters: the /api/checkout prefill resolves after the
  // book fetch and calls setSavedCustomer + prefillAddress, which would
  // otherwise overwrite the address we just applied. Applying it is what
  // populates pincode + orderLat/orderLng so the delivery quote fires.
  const autoAppliedForPhone = useRef<string | null>(null);
  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) return;
    if (autoAppliedForPhone.current === digits) return;
    if (savedAddresses.length === 0) return;
    if (!savedCustomer) return;
    const def = savedAddresses.find((r) => r.is_default) ?? savedAddresses[0];
    if (!def) return;
    // Guard is per-phone so a manual pick is never clobbered by a re-run
    // (pickSavedAddress mutates savedCustomer, which re-triggers this).
    autoAppliedForPhone.current = digits;
    pickSavedAddress(def);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, savedAddresses, savedCustomer]);

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
  // Skipped on pickup — the stall's own coords are the fulfillment point,
  // no distance-to-customer fee is applied.
  useEffect(() => {
    if (isPickup) { setDeliveryQuote(null); return; }
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
  }, [orderLat, orderLng, effectivePincode, isPickup]);

  // Pickup locations — fetched from the public GET /api/locations endpoint
  // (edge-cached 3600s, no auth). Fires only the first time the user toggles
  // Pickup on; subsequent toggles reuse the cached array. The endpoint
  // returns { locations: [{ id, name, type, area, latitude, longitude, … }] }
  // with only active + non-archived rows.
  useEffect(() => {
    if (!isPickup) return;
    if (pickupLocations.length > 0) return;
    if (pickupLocationsLoading) return;
    let cancelled = false;
    setPickupLocationsLoading(true);
    fetch("/api/locations")
      .then((r) => r.json())
      .then((d: { locations?: PickupLoc[] }) => {
        if (cancelled) return;
        setPickupLocations(Array.isArray(d.locations) ? d.locations : []);
      })
      .catch(() => { /* silent — user sees empty picker with a retry hint */ })
      .finally(() => { if (!cancelled) setPickupLocationsLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPickup]);

  // Sorted stall list: nearest-first when we have customer coords,
  // otherwise the DB's sort_order (which /api/locations already respects).
  // Distance comes from `@/lib/haversine.haversineKm` — a pure, zero-import
  // client-safe helper (see import block above). Recomputed on every render;
  // cheap for the ~6 active rows we have.
  const sortedPickupLocations: PickupLoc[] = (() => {
    if (pickupLocations.length === 0) return pickupLocations;
    if (orderLat === null || orderLng === null) return pickupLocations;
    const from = { latitude: orderLat, longitude: orderLng };
    return [...pickupLocations].sort(
      (a, b) => haversineKm(from, a) - haversineKm(from, b),
    );
  })();

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
    // In-flight guard. The `disabled={sendingOtp}` on the send buttons
    // reads React state, which isn't committed until after the current
    // tick — two clicks landing in the same tick both pass it and fire
    // two POSTs (two SMS, two MSG91 credits). A ref flips synchronously.
    if (sendingOtpRef.current) return;
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) { setOtpError("Enter a valid 10-digit number."); return; }
    if (!turnstileToken) { setOtpError("Please complete the human-verification check below."); return; }
    sendingOtpRef.current = true;
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
      // The token we just spent is dead to Cloudflare. Re-arm the widget
      // so Resend has a fresh one — without this, Resend always 403s.
      refreshTurnstile();
    } catch {
      setOtpError("Network error. Try again.");
      refreshTurnstile();
    } finally {
      sendingOtpRef.current = false;
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
    // Human-verification gate. Applies to BOTH the returning-customer
    // saved-details fast path (no server call) and the new-address form
    // path. Satisfied by a held Turnstile token or a completed OTP.
    if (!humanVerified) {
      setError("Please complete the human-verification check below.");
      return;
    }

    // ── Pickup branch ────────────────────────────────────────────────────
    // Skips serviceability, pincode, distance, date, and slot gates entirely.
    // Server does the same in prepareOneTimeOrder when fulfillment_type ===
    // 'pickup'. Still requires name + phone + OTP + a chosen stall.
    if (isPickup) {
      if (!pickupLocationId) { setError("Please choose a pickup point."); return; }
      const chosen = pickupLocations.find((p) => p.id === pickupLocationId);
      const placeholderAddress = chosen
        ? `Pick up at ${chosen.name}, ${chosen.area}`
        : "Pick up at Cadieux";

      // Returning customer — already has a customer id, skip save_customer.
      if (formMode === "returning" && savedCustomer && customer?.id) {
        if (!otpVerified) { setError("Please verify your phone number to continue."); return; }
        setAddressConfirmed(true);
        setStep("payment"); // pickup skips the delivery date/slot step
        return;
      }

      // Fresh / edit — still need name + phone + verified OTP. No address
      // fields required. `save_customer` writes the stall address string as
      // the customer's placeholder delivery_address; any real delivery order
      // later will overwrite it via the same endpoint.
      if (!name.trim()) { setError("Please enter your name."); return; }
      if (phone.replace(/\D/g, "").length !== 10) { setError("Enter a valid 10-digit number."); return; }
      if (!otpVerified) { setError("Please verify your phone number."); return; }

      setSubmitting(true);
      try {
        const res = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_customer",
            full_name: name.trim(),
            phone: phone.replace(/\D/g, ""),
            delivery_address: placeholderAddress,
            city: chosen?.area ?? "",
          }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error ?? "Failed to save details."); return; }
        localStorage.setItem("cadieux_phone", phone.replace(/\D/g, ""));
        setCustomer(data.customer);
        setAddressConfirmed(true);
        setStep("payment"); // pickup skips the delivery date/slot step
      } catch {
        setError("Something went wrong. Try again.");
      } finally {
        setSubmitting(false);
      }
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
      if (distanceUnserviceable) { setError("We don't deliver beyond 20 km yet. Please check our service area."); return; }
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
    if (distanceUnserviceable) { setError("We don't deliver beyond 20 km yet. Please check our service area."); return; }

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

      // ── Address-book round-trip (best-effort, fire-and-forget) ─────
      // Mirror the entered address into the shared `public.addresses`
      // book so it shows up at /account/addresses AND the mobile app,
      // and prefills the next checkout. This is intentionally NOT
      // awaited: the helper is contractually silent on all failures
      // (network, 4xx/5xx, bad phone, JSON parse) and must never block
      // or delay advancing to the delivery step or the downstream
      // Razorpay / COD path. Order creation + payment are the priority;
      // address-book mirroring is secondary.
      // Runs only on fresh/edit form paths — returning customers with
      // saved details short-circuit above at line ~573 and never reach
      // here, so we don't duplicate their existing book entries.
      void upsertAddressToBookBestEffort(phone.replace(/\D/g, ""), {
        label: effectiveLabel,
        fullName: name.trim(),
        line1: addressLine,
        area,
        city,
        pincode,
      });

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
    // During pre-order mode the date/slot pickers are disabled — admin
    // schedules from the panel later. Skip the client-side gates entirely
    // (server drops date/slot from the payload regardless).
    if (!preorderMode) {
      if (!deliveryDate) { setError("Please pick a delivery date."); return; }
      if (!deliverySlot) { setError("Please pick a delivery time."); return; }
    }
    setStep("payment");
  }

  /* ── Order confirmations (fire-and-forget) ────────────────────────────── */
  async function sendOrderSMS(orderId: string, deliveryAddress: string, customerPhone: string, customerName: string, publicRef?: string | null) {
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
          // Wire field is still named orderNumber (the schema is .strict(),
          // renaming it would 400 any older caller), but the VALUE is now
          // the customer-facing public_ref, never the OLF number.
          orderNumber: publicRef ?? undefined,
          total: grandTotal,
          address: deliveryAddress,
          preorder: !!preorderMode,
        }),
      });
    } catch { /* silent */ }
  }

  async function sendOrderWhatsApp(orderId: string, deliveryAddress: string, customerPhone: string, customerName: string, publicRef?: string | null) {
    const resolvedPhone = customerPhone.replace(/\D/g, "");
    if (!resolvedPhone) return;
    // Shared builder — same wording admin manual-entry + mobile checkout
    // send. Includes the /orders/[id] tracking link.
    const message = buildOrderPlacedWhatsApp({
      name: customerName,
      orderId,
      publicRef,
      total: grandTotal,
      address: deliveryAddress,
      preorder: !!preorderMode,
      siteUrl: SITE_URL,
    });
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
    // On pickup, prefer the chosen stall's synthesized "Pick up at …" string
    // over any saved / entered delivery address. The server also synthesizes
    // this from pickup_locations, so both paths agree.
    const chosenPickup = isPickup
      ? pickupLocations.find((p) => p.id === pickupLocationId)
      : null;
    const fullAddress = isPickup
      ? (chosenPickup
          ? `Pick up at ${chosenPickup.name}, ${chosenPickup.area}`
          : "Pick up at Cadieux")
      : (isReturning
          ? (savedCustomer!.delivery_address ?? "")
          : `[${effectiveLabel}] ${addressLine.trim()}, ${area.trim()}, ${city.trim()} - ${pincode.trim()}`);
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
      setError("We don't deliver beyond 20 km yet. Please check our service area.");
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
          // Pickup fields — server branches on fulfillment_type and uses
          // pickup_location_id to synthesize the authoritative address +
          // zero out the delivery fee. Absent on delivery orders so the
          // legacy code path is byte-for-byte unchanged.
          ...(isPickup
            ? { fulfillment_type: "pickup", pickup_location_id: pickupLocationId }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "pincode_unserviceable") {
          setUnserviceableAtPayment(true);
          setError(
            data.error ??
              "We don't deliver to this pincode yet. Send us a request and we'll get in touch.",
          );
        } else if (data.code === "address_required") {
          setError(data.error ?? "Please add a delivery address to continue.");
          setFormMode("fresh");
          setStep("address");
        } else {
          setError(data.error ?? "Order failed.");
        }
        return;
      }
      const oid = data.order_id ?? "";
      const ref = data.public_ref ?? null;
      if (oid) {
        sendOrderSMS(oid, fullAddress, customerPhone, customerName, ref);
        sendOrderWhatsApp(oid, fullAddress, customerPhone, customerName, ref);
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
      setError("We don't deliver beyond 20 km yet. Please check our service area.");
      setStep("address");
      return;
    }
    setOrderLoading(true); setError("");
    const { fullAddress, customerPhone, customerName } = resolveOrderIdentity();
    try {
      // Create the Razorpay order AND the pending DB order row in one call.
      // The server re-derives the authoritative grand total from the cart;
      // `total` here is only a hint it compares against.
      const res = await fetch("/api/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customer?.id,
          delivery_address: fullAddress,
          pincode: fullAddress.match(/(\d{6})\s*$/)?.[1] ?? "",
          delivery_date: deliveryDate,
          delivery_slot: deliverySlot,
          total_amount: total,
          items: orderItems,
          ...(orderLat !== null && orderLng !== null ? { latitude: orderLat, longitude: orderLng } : {}),
          // Pickup fields — server branches on fulfillment_type and uses
          // pickup_location_id to synthesize the authoritative address +
          // zero out the delivery fee. Razorpay amount is server-derived
          // from the pickup subtotal (no delivery fee), so `serverAmount`
          // returned below already reflects the ₹0 fee.
          ...(isPickup
            ? { fulfillment_type: "pickup", pickup_location_id: pickupLocationId }
            : {}),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string; code?: string };
        if (errData.code === "distance_unserviceable") {
          setError(errData.error ?? "We don't deliver beyond 20 km yet.");
          setStep("address");
        } else if (errData.code === "pincode_unserviceable") {
          setUnserviceableAtPayment(true);
          setError(
            errData.error ??
              "We don't deliver to this pincode yet. Send us a request and we'll get in touch.",
          );
        } else if (errData.code === "price_mismatch") {
          setError(errData.error ?? "Price mismatch — please refresh and retry.");
        } else if (errData.code === "address_required") {
          setError(errData.error ?? "Please add a delivery address to continue.");
          setFormMode("fresh");
          setStep("address");
        } else {
          setError("Online payment unavailable. Please use Cash on Delivery.");
        }
        return;
      }
      const {
        db_order_id,
        public_ref,
        razorpay_order_id,
        amount: serverAmount,
      } = await res.json() as {
        db_order_id: string;
        public_ref?: string | null;
        razorpay_order_id: string;
        amount: number;
      };

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

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: serverAmount,  // server-computed paise — must match the Razorpay order
        currency: "INR",
        name: "Cadieux",
        description: "Protein Bread",
        order_id: razorpay_order_id,
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          setOrderLoading(true);
          // The order is marked paid ONLY after the server verifies the
          // signature. Never trust this success callback by itself.
          const r = await fetch("/api/verify-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              db_order_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          });
          const d = await r.json().catch(() => ({}));
          setOrderLoading(false);
          if (!r.ok || !d.ok) {
            setError(
              "We received your payment but couldn't confirm it automatically. " +
              "Don't worry — it'll be reconciled shortly. Contact support if your order doesn't appear.",
            );
            return;
          }
          if (db_order_id) {
            sendOrderSMS(db_order_id, fullAddress, customerPhone, customerName, public_ref);
            sendOrderWhatsApp(db_order_id, fullAddress, customerPhone, customerName, public_ref);
          }
          const { city: subCity, pincode: subPincode } = extractCityPincode(fullAddress);
          const subFailed = await submitSubscriptions(fullAddress, customerName, customerPhone, subCity, subPincode);
          if (subFailed > 0) {
            setError(
              `Payment received, but ${subFailed} subscription${subFailed > 1 ? "s" : ""} couldn't be tracked. They won't appear under "Track your subscription" until the subscriptions table is set up. Contact support.`,
            );
            return;
          }
          finishOrder(db_order_id);
        },
        modal: {
          // User closed the Razorpay sheet without paying. The pending DB
          // row simply stays unpaid — nothing to clean up client-side.
          ondismiss: () => {
            setOrderLoading(false);
            setError("Payment cancelled. Your order was not placed. You can try again or use Cash on Delivery.");
          },
        },
        prefill: { name: customerName, contact: "+91" + customerPhone.replace(/\D/g, "") },
        theme: { color: "#024628" },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rzp = new (window as any).Razorpay(options);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rzp.on("payment.failed", (resp: any) => {
        setOrderLoading(false);
        setError(
          resp?.error?.description
            ? `Payment failed: ${resp.error.description}. Please try again or use Cash on Delivery.`
            : "Payment failed. Please try again or use Cash on Delivery.",
        );
      });
      rzp.open();
    } catch {
      setError("Something went wrong.");
      setOrderLoading(false);
    }
  }

  /* ── Success bridge ───────────────────────────────────────────────────── */
  function finishOrder(orderId: string) {
    // Mark the order as finishing BEFORE clearing the cart so the
    // empty-cart bounce effect doesn't fire router.replace("/cart")
    // and clobber the redirect below.
    orderFinishingRef.current = true;
    clearCart();
    // Land the customer directly on the live tracking page for THIS order
    // (both COD and online payment). Skips the old /checkout/success
    // interstitial. router.replace so the back button doesn't return to
    // the now-cleared checkout flow.
    if (orderId) {
      router.replace(`/orders/${encodeURIComponent(orderId)}`);
    } else {
      router.replace("/orders");
    }
  }

  /* ── Header bits ──────────────────────────────────────────────────────── */
  const firstName =
    (formMode === "returning" && savedCustomer?.full_name?.split(" ")[0]) ||
    (name.trim() ? name.trim().split(" ")[0] : "");
  // Short greeting: the header's right cell has a tight width budget on
  // mobile (grid 1fr auto 1fr; the wordmark takes the middle). "Welcome
  // back, X" overflowed and visually collided with CADIEUX.
  const greeting = firstName ? `Hi, ${firstName}` : "";

  // Pickup skips the delivery date/slot step, so the step counter shows
  // "1 of 2" / "2 of 2" instead of "1 of 3" / "3 of 3".
  const stepLabel = isPickup
    ? (step === "address" ? "Pickup Point (1 of 2)" : "Payment (2 of 2)")
    : step === "address"
      ? "Address (1 of 3)"
      : step === "delivery"
        ? "Delivery (2 of 3)"
        : "Payment (3 of 3)";

  function onBack() {
    // Clear the unserviceable-at-payment guard whenever the user steps
    // back, so a corrected address on the address step re-arms the
    // normal Pay flow on return.
    if (step === "payment") {
      setUnserviceableAtPayment(false);
      setError("");
      // Pickup skipped the delivery step on the way in, so unwind straight
      // back to the address step to keep the flow symmetric.
      setStep(isPickup ? "address" : "delivery");
    } else if (step === "delivery") setStep("address");
    else router.push("/cart");
  }

  /* ── Render ───────────────────────────────────────────────────────────── */
  // Render guard: empty cart redirects via the effect above; in the meantime
  // render nothing to avoid a flash of the empty-cart checkout.
  if (cart.length === 0) return null;

  return (
    <div style={{ minHeight: "100dvh", background: "var(--surface-canvas)", position: "relative", overflowX: "clip" }}>
      <style>{`
        input::placeholder { color: rgba(2,70,40,0.6); }
        select::-ms-expand { display: none; }
      `}</style>

      {/* Grain — soft ash texture, no dark charcoal wash */}
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.04, pointerEvents: "none", zIndex: 0 }} />

      {/* ── Sticky header ──────────────────────────────────────────────── */}
      {/* Task G: charcoal wash retired → --surface-brand (FG green) card
          semantics. Cream text keeps 9.88:1 AAA, muted meta cream@70% keeps
          5.4:1 AA. Sticky z 10 per token scale (dropdowns 20, modals 40). */}
      <header
        style={{
          position: "sticky", top: 0, zIndex: 10,
          background: "var(--surface-brand)",
          borderBottom: "1px solid rgba(251,243,212,0.15)",
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
              fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
              letterSpacing: "0.35em", textTransform: "uppercase",
              color: "rgba(251,243,212,0.7)",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            ← Back
          </button>
          <div
            style={{
              justifySelf: "center",
              // Slightly tighter tracking (0.35em vs 0.45em) so the middle
              // grid cell doesn't consume the width the right greeting
              // needs on 375px viewports — was overlapping "Welcome back,
              // X" into the wordmark on mobile.
              fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 300,
              letterSpacing: "0.35em", color: "#FBF3D4",
              whiteSpace: "nowrap",
            }}
          >
            CADIEUX
          </div>
          <div
            style={{
              justifySelf: "end",
              fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
              letterSpacing: "0.25em", textTransform: "uppercase",
              color: "rgba(251,243,212,0.7)",
              // Right cell capped tighter + minWidth 0 so it can shrink
              // inside the 1fr grid track rather than push into CADIEUX.
              minWidth: 0,
              maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
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
        {/* Progress label — FG@75% on ash (4.87:1 AA) */}
        <p
          style={{
            margin: "0 0 6px",
            fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
            letterSpacing: "0.5em", textTransform: "uppercase",
            color: "#024628",
          }}
        >
          {stepLabel}
        </p>
        <h1
          style={{
            margin: "0 0 24px",
            fontFamily: "var(--font-heading)", fontSize: "clamp(34px,7vw,46px)",
            fontWeight: 300, color: "#024628", letterSpacing: "0.04em", lineHeight: 1.1,
          }}
        >
          {step === "address"
            ? (isPickup ? "Pickup Point" : "Your Address")
            : step === "delivery"
              ? "Pick a Time"
              : "Payment"}
        </h1>

        {/* Delivery vs Pickup toggle — hoisted OUT of the address step so
            it renders on ALL 3 steps. Returning customers with a saved
            address auto-skip the address step (setStep("payment") at the
            OTP-verified branch), so a toggle nested inside address never
            rendered for them. Rendering here (below H1, above the >20 km
            warning) means every customer — new or returning, on address /
            delivery / payment — can switch Deliver ↔ Pickup. Any toggle
            snaps setStep("address") so the customer lands at the entry
            point of the chosen mode (pick a stall for pickup, confirm
            address for delivery). */}
        <FulfillmentToggle
          value={fulfillmentType}
          onChange={(next) => {
            if (next === fulfillmentType) return;
            setFulfillmentType(next);
            setError("");
            setAddressConfirmed(false);
            setStep("address");
          }}
        />

        {/* Standalone >20 km warning — surfaces independent of the
            summary so the customer sees why we can't deliver even
            before they've pressed Continue. */}
        {step === "address" && distanceUnserviceable && (
          <div
            style={{
              padding: "12px 16px", marginBottom: 24,
              background: "rgba(153,27,27,0.06)",
              border: "1px solid rgba(153,27,27,0.35)",
              fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200,
              color: "var(--warning-on-light)", letterSpacing: "0.03em", lineHeight: 1.5,
            }}
          >
            We don&apos;t deliver beyond 20 km yet. Please check our delivery area or choose a different address.
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
                  borderTop: "1px solid #024628",
                  padding: "12px 0",
                }}
              >
                <span style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "#024628", letterSpacing: "0.03em" }}>
                  {item.name} × {item.qty}
                </span>
                <span style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "#024628" }}>
                  ₹{item.price * item.qty}
                </span>
              </div>
            ))}
            <div
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                borderTop: "1px solid #024628",
                padding: "12px 0",
              }}
            >
              <span style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "#024628" }}>
                Delivery fee
                {deliveryQuote?.distanceKm !== null && deliveryQuote?.distanceKm !== undefined && (
                  <span style={{ fontSize: 16, color: "#024628", marginLeft: 6 }}>
                    ({deliveryQuote.distanceKm} km)
                  </span>
                )}
              </span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "#024628", opacity: quoteLoading ? 0.5 : 1 }}>
                {quoteLoading ? "…" : `₹${deliveryFee}`}
              </span>
            </div>
            <div
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                borderTop: "1px solid #024628",
                paddingTop: 14, marginTop: 4,
              }}
            >
              <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.4em", textTransform: "uppercase", color: "#024628" }}>Total (incl. GST)</span>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: 28, fontWeight: 300, color: "#024628" }}>₹{grandTotal}</span>
            </div>
          </section>
        )}

        {/* ── ADDRESS STEP ─────────────────────────────────────────────── */}
        {step === "address" && (
          <>
            {isPickup ? (
              <PickupSection
                formMode={formMode}
                savedCustomer={savedCustomer}
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
                onSwitchToFresh={() => {
                  setFormMode("fresh");
                  setName(""); setPhone("");
                  setOtpVerified(false); setOtpSent(false);
                  setOtpCode(""); setOtpError("");
                  setCustomer(null); setError("");
                }}
                pickupLocations={sortedPickupLocations}
                pickupLocationsLoading={pickupLocationsLoading}
                pickupLocationId={pickupLocationId}
                setPickupLocationId={(id) => { setPickupLocationId(id); setError(""); }}
                customerHasCoords={orderLat !== null && orderLng !== null}
              />
            ) : formMode === "returning" && savedCustomer ? (
              <section>
                <p style={sectionHead}>Saved Details</p>
                {/* Task G: cream-on-ash (1.52:1 FAIL) → paper card semantics.
                    Paper bg = cream #FBF3D4, FG text 6.49:1 AA + FG@75%
                    secondary. Delete uses --warning-on-light on paper
                    (≥4.5:1). */}
                <div
                  style={{
                    background: "var(--surface-paper)",
                    border: "1px solid #024628",
                    borderRadius: "var(--card-radius)",
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
                        background: "none", border: "1px solid #024628",
                        padding: "4px 10px", cursor: "pointer",
                        fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
                        letterSpacing: "0.3em", textTransform: "uppercase",
                        color: "#024628",
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
                        background: "none", border: "1px solid rgba(153,27,27,0.4)",
                        padding: "4px 10px", cursor: "pointer",
                        fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
                        letterSpacing: "0.3em", textTransform: "uppercase",
                        color: "var(--warning-on-light)",
                        WebkitTapHighlightColor: "transparent",
                      }}
                      aria-label="Delete saved address"
                    >
                      Delete
                    </button>
                  </div>
                  <p style={{ margin: "0 0 6px", paddingRight: 120, fontFamily: "var(--font-body)", fontSize: 17, fontWeight: 300, color: "#024628", letterSpacing: "0.04em" }}>
                    {savedCustomer.full_name}
                  </p>
                  <p style={{ margin: "0 0 6px", fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "#024628", letterSpacing: "0.04em" }}>
                    +91 {savedCustomer.phone}
                  </p>
                  {savedCustomer.delivery_address && (
                    <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "#024628", letterSpacing: "0.03em", lineHeight: 1.7 }}>
                      {savedCustomer.delivery_address}
                    </p>
                  )}
                </div>

                {/* Saved-book picker — appears only when the customer
                    has more than one address saved (via /account/addresses
                    or the mobile app). Clicking a row swaps the shipping
                    address in-place; the top card above reflects the pick.
                    A single-row book is redundant with the card above so
                    we suppress the picker in that case. */}
                {savedAddresses.length > 1 && (
                  <div style={{ marginBottom: 16 }}>
                    <p style={{
                      margin: "0 0 10px",
                      fontFamily: "var(--font-body)",
                      fontSize: 14,
                      fontWeight: 500,
                      letterSpacing: "0.35em",
                      textTransform: "uppercase",
                      color: "rgba(2,70,40,0.7)",
                    }}>
                      Ship to a different saved address
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {savedAddresses.map((a) => {
                        const active = a.id === selectedAddressId;
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => pickSavedAddress(a)}
                            style={{
                              display: "block",
                              textAlign: "left",
                              width: "100%",
                              padding: "12px 14px",
                              border: `1px solid ${active ? "#024628" : "rgba(2,70,40,0.35)"}`,
                              background: active ? "rgba(2,70,40,0.06)" : "transparent",
                              cursor: "pointer",
                              fontFamily: "var(--font-body)",
                              color: "#024628",
                              WebkitTapHighlightColor: "transparent",
                            }}
                            aria-pressed={active}
                          >
                            <div style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 4,
                              fontSize: 14,
                              fontWeight: 500,
                              letterSpacing: "0.25em",
                              textTransform: "uppercase",
                            }}>
                              <span>{a.label}</span>
                              {a.is_default && <span style={{ opacity: 0.7 }}>• Default</span>}
                              {active && <span style={{ marginLeft: "auto", opacity: 0.8 }}>Selected</span>}
                            </div>
                            <div style={{ fontSize: 16, fontWeight: 300, lineHeight: 1.5 }}>
                              {a.full_name}
                            </div>
                            <div style={{ fontSize: 16, fontWeight: 200, lineHeight: 1.5, opacity: 0.85 }}>
                              {a.line1}{a.area ? `, ${a.area}` : ""}
                            </div>
                            <div style={{ fontSize: 16, fontWeight: 200, lineHeight: 1.5, opacity: 0.75 }}>
                              {a.city}{a.pincode ? `, ${a.pincode}` : ""}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

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
                  <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.25em", textTransform: "uppercase", color: "#024628" }}>
                    ✓ Phone Verified
                  </p>
                )}

                <button
                  onClick={() => { setFormMode("edit"); setError(""); setAddressConfirmed(false); }}
                  style={{
                    display: "block", width: "100%",
                    background: "transparent",
                    border: "1px solid #024628",
                    minHeight: 48, padding: "14px 0",
                    cursor: "pointer",
                    fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
                    letterSpacing: "0.4em", textTransform: "uppercase",
                    color: "#024628",
                    WebkitTapHighlightColor: "transparent",
                    marginBottom: 20,
                  }}
                >
                  Edit Details
                </button>

                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <div style={{ flex: 1, height: 1, background: "#024628" }} />
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.35em", textTransform: "uppercase", color: "#024628" }}>or</span>
                  <div style={{ flex: 1, height: 1, background: "#024628" }} />
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
                    fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
                    letterSpacing: "0.35em", textTransform: "uppercase",
                    color: "#024628",
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
            preorderMode={!!preorderMode}
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
            preorderMode={!!preorderMode}
          />
        )}

        {error && (
          <p style={{ margin: "16px 0 0", fontFamily: "var(--font-body)", fontSize: 16, color: "var(--warning-on-light)", letterSpacing: "0.04em" }}>
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
              border: "1px solid #024628",
              background: "var(--surface-paper)",
              borderRadius: "var(--card-radius)",
            }}
          >
            <p
              style={{
                margin: "0 0 10px",
                fontFamily: "var(--font-body)",
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                color: "#024628",
              }}
            >
              Human Check
            </p>
            <p
              style={{
                margin: "0 0 12px",
                fontFamily: "var(--font-body)",
                fontSize: 16,
                fontWeight: 200,
                lineHeight: 1.5,
                letterSpacing: "0.02em",
                color: "#024628",
              }}
            >
              {TURNSTILE_BYPASS
                ? "Human-verification is bypassed on this preview build for payment testing."
                : "Solve once to verify your phone and continue to delivery."}
            </p>
            {!TURNSTILE_BYPASS && (
              <TurnstileWidget
                ref={turnstileRef}
                onVerify={(t) => setTurnstileToken(t)}
                onExpire={() => setTurnstileToken("")}
              />
            )}
          </div>
        )}
      </main>

      {/* ── Sticky bottom CTA bar ──────────────────────────────────────── */}
      {/* Task G: charcoal wash retired. Ash canvas continuity + FG@25% top
          rail. Sticky z 10 (was 60 pre-scale). All text FG on ash. */}
      <div
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 10,
          background: "var(--surface-canvas)",
          borderTop: "1px solid #024628",
          paddingBottom: "env(safe-area-inset-bottom)",
          boxShadow: "0 -8px 24px rgba(2,70,40,0.08)",
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
                borderBottom: "1px solid #024628",
                fontFamily: "var(--font-body)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 500, letterSpacing: "0.3em", textTransform: "uppercase", color: "#024628" }}>
                  Subtotal ₹{total} · Delivery {quoteLoading ? "…" : `₹${deliveryFee}`}
                  {deliveryQuote?.distanceKm !== null && deliveryQuote?.distanceKm !== undefined && (
                    <span style={{ color: "#024628" }}>
                      {" "}({deliveryQuote.distanceKm} km)
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 14, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "#024628" }}>
                  Total (incl. GST)
                </span>
              </div>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: 22, fontWeight: 300, color: "#024628", whiteSpace: "nowrap" }}>
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
                !humanVerified ||
                // locQuestion only applies to the delivery form (fresh/edit).
                // Pickup has no address to answer "are you there?" about.
                (!isPickup && formMode !== "returning" && locQuestion === "unanswered")
              }
              style={primaryBtn(
                submitting ||
                  !humanVerified ||
                  (!isPickup && formMode !== "returning" && locQuestion === "unanswered"),
              )}
            >
              {submitting ? "Saving…" : (isPickup ? "Continue to Payment" : "Continue to Delivery")}
            </button>
          ) : step === "delivery" ? (
            <button onClick={submitDeliveryStep} style={primaryBtn(false)}>
              Continue to Payment
            </button>
          ) : unserviceableAtPayment ? (
            <button
              onClick={submitDeliveryRequest}
              disabled={requestSubmitting}
              style={primaryBtn(requestSubmitting)}
            >
              {requestSubmitting ? "Sending…" : "Send Request to Deliver Here"}
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
// Task G Phase 2: bg stays solid --surface-brand always; disabled state uses
// element-level opacity 0.5 so the FG-bg+cream-label composite (9.88:1 AAA)
// never gets muddied by a semi-transparent FG over ash canvas.
function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "block", width: "100%",
    height: 56,
    background: "var(--surface-brand)",
    border: "none",
    cursor: disabled ? "default" : "pointer",
    fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
    letterSpacing: "0.4em", textTransform: "uppercase",
    color: "#FBF3D4",
    opacity: disabled ? 0.5 : 1,
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
  const [locating, setLocating] = useState(false);

  // Autocomplete instance ref
  const acRef = useRef<google.maps.places.Autocomplete | null>(null);

  // "Use current location" — browser GPS → reverse-geocode → fill the address
  // fields directly (mirrors the mobile app's handleUseLocation). This is the
  // fast path; the map picker remains for fine-tuning / manual pin.
  const handleUseLocation = useCallback(() => {
    if (locating) return;
    setLocMsg(null);
    setError("");
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocMsg("Your browser can't share location. Pin on the map or type your address below.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const result = await reverseGeocodeClient(latitude, longitude);
        if (!result) {
          // Still capture coords so the delivery quote uses the real GPS point,
          // but ask the user to fine-tune the address manually.
          onCoordsCapture(latitude, longitude);
          setLocating(false);
          setLocMsg("Got your location but couldn't read a full address. Pin on the map or type it in below.");
          return;
        }
        if (result.line1) setAddressLine(result.line1);
        if (result.area) setArea(result.area);
        if (result.city) setCity(result.city);
        if (result.pincode) setPincode(result.pincode);
        onCoordsCapture(result.lat ?? latitude, result.lng ?? longitude);
        setError("");
        setLocMsg(null);
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocMsg("Location permission denied. Allow access in your browser, pin on the map, or type your address below.");
        } else if (err.code === err.TIMEOUT) {
          setLocMsg("Timed out getting your location. Try again, pin on the map, or type your address below.");
        } else {
          setLocMsg("Couldn't get your location. Pin on the map or type your address below.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }, [locating, onCoordsCapture, setAddressLine, setArea, setCity, setPincode, setError]);

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
          {/* inputSt carries display:"block", so it must be spread BEFORE the
              flex properties or it silently wins and drops the "+91" prefix
              onto its own line above the field.
              minWidth:0 is required too: as a flex item this defaults to
              min-width:auto, which floors it at the inner <input>'s intrinsic
              width (~185px), so flex:1 cannot actually shrink and the
              non-shrinking "Send OTP" button spills past the viewport at 390px. */}
          <div style={{ ...inputSt, flex: 1, minWidth: 0, display: "flex", alignItems: "center", padding: 0 }}>
            <span style={{ padding: "0 6px 0 14px", fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "#024628", userSelect: "none", letterSpacing: "0.05em" }}>+91</span>
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
                // minWidth:0 for the same reason as the wrapper — without it
                // the input keeps its ~186px intrinsic width and its text
                // renders past the field's right border.
                flex: 1, minWidth: 0,
                background: "none", border: "none", outline: "none",
                padding: "0 12px", height: 46,
                fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200,
                color: "#024628", letterSpacing: "0.05em",
              }}
            />
          </div>
          {otpVerified ? (
            <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", gap: 4 }}>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.2em", color: "#024628" }}>✓ Verified</span>
              <button
                onClick={() => { setOtpVerified(false); setOtpSent(false); setOtpCode(""); setOtpError(""); }}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.3em", textTransform: "uppercase", color: "#024628", WebkitTapHighlightColor: "transparent" }}
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
                border: "1px solid #024628",
                padding: "0 16px",
                cursor: (sendingOtp || phone.replace(/\D/g, "").length < 10) ? "default" : "pointer",
                fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: "#024628",
                opacity: (sendingOtp || phone.replace(/\D/g, "").length < 10) ? 0.5 : 1,
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
              style={{ ...inputSt, letterSpacing: "0.4em", fontSize: 19, borderColor: "#024628" }}
              autoFocus
            />
            <button
              onClick={verifyOtp}
              disabled={verifyingOtp || otpCode.replace(/\D/g, "").length < 6}
              style={{
                marginTop: 12, display: "block", width: "100%",
                height: 48,
                background: "var(--surface-brand)",
                border: "none",
                cursor: (verifyingOtp || otpCode.replace(/\D/g, "").length < 6) ? "default" : "pointer",
                fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
                letterSpacing: "0.4em", textTransform: "uppercase",
                color: "#FBF3D4",
                opacity: (verifyingOtp || otpCode.replace(/\D/g, "").length < 6) ? 0.5 : 1,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {verifyingOtp ? "Verifying…" : "Verify"}
            </button>
          </div>
        )}

        {otpError && (
          <p style={{ margin: "8px 0 0", fontFamily: "var(--font-body)", fontSize: 16, color: "var(--warning-on-light)", letterSpacing: "0.04em" }}>
            {otpError}
          </p>
        )}
      </div>

      {/* ── Location question (REQUIRED) ───────────────────────────── */}
      {/* Task G: gold-tinted pills → matrix-legal FG-fill selected, ash+FG
          border unselected. Mirrors .cdx-tab is-active semantics. */}
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
                background: locQuestion === choice ? "var(--surface-brand)" : "transparent",
                border: "1px solid #024628",
                cursor: "pointer",
                fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: locQuestion === choice ? "#FBF3D4" : "#024628",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {choice === "yes" ? "Yes" : "No"}
            </button>
          ))}
        </div>

        {locQuestion === "yes" && (
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button
              type="button"
              onClick={handleUseLocation}
              disabled={locating}
              style={{
                flex: 1, minHeight: 44,
                background: "transparent",
                border: "1px solid #024628",
                cursor: locating ? "default" : "pointer",
                fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: "#024628",
                opacity: locating ? 0.5 : 1,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {locating ? "Locating…" : "🎯 Current location"}
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              style={{
                flex: 1, minHeight: 44,
                background: "transparent",
                border: "1px solid #024628",
                cursor: "pointer",
                fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: "#024628",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              📍 Pin on map
            </button>
          </div>
        )}

        {locQuestion === "no" && (
          <p style={{ margin: "8px 0 0", fontFamily: "var(--font-body)", fontSize: 16, color: "#024628", letterSpacing: "0.03em", lineHeight: 1.5 }}>
            No problem — please enter the delivery address below.
          </p>
        )}

        {locMsg && (
          <p style={{ margin: "8px 0 0", fontFamily: "var(--font-body)", fontSize: 16, color: "var(--warning-on-light)", letterSpacing: "0.03em", lineHeight: 1.5 }}>
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
                  background: selected ? "var(--surface-brand)" : "transparent",
                  border: "1px solid #024628",
                  cursor: "pointer",
                  fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
                  letterSpacing: "0.3em", textTransform: "uppercase",
                  color: selected ? "#FBF3D4" : "#024628",
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
            fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
            letterSpacing: "0.3em", textTransform: "uppercase",
            color: "#024628",
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
        background: "var(--surface-paper)",
        border: "1px solid #024628",
        borderRadius: "var(--card-radius)",
        padding: "16px 18px",
        marginBottom: 16,
      }}
    >
      <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.35em", textTransform: "uppercase", color: "#024628" }}>
        Verify Phone
      </p>
      <p style={{ margin: "0 0 14px", fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "#024628", letterSpacing: "0.03em", lineHeight: 1.5 }}>
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
          border: "1px solid #024628",
          padding: "0 16px",
          cursor: sendingOtp ? "default" : "pointer",
          fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
          letterSpacing: "0.35em", textTransform: "uppercase",
          color: "#024628",
          opacity: sendingOtp ? 0.5 : 1,
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
            style={{ ...inputSt, letterSpacing: "0.4em", fontSize: 19, borderColor: "#024628" }}
            autoFocus
          />
          <button
            onClick={verifyOtp}
            disabled={verifyingOtp || otpCode.replace(/\D/g, "").length < 6}
            style={{
              marginTop: 12, display: "block", width: "100%",
              height: 48,
              background: "var(--surface-brand)",
              border: "none",
              cursor: (verifyingOtp || otpCode.replace(/\D/g, "").length < 6) ? "default" : "pointer",
              fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
              letterSpacing: "0.4em", textTransform: "uppercase",
              color: "#FBF3D4",
              opacity: (verifyingOtp || otpCode.replace(/\D/g, "").length < 6) ? 0.5 : 1,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {verifyingOtp ? "Verifying…" : "Verify"}
          </button>
        </div>
      )}

      {otpError && (
        <p style={{ margin: "10px 0 0", fontFamily: "var(--font-body)", fontSize: 16, color: "var(--warning-on-light)", letterSpacing: "0.04em" }}>
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
  preorderMode: boolean;
}) {
  const {
    grandTotal, deliveryFee,
    customerName, customerPhone, fullAddress,
    deliveryDate, deliverySlot, preorderMode,
  } = props;

  return (
    <section>
      {preorderMode ? (
        <div
          style={{
            background: "#FBF3D4",
            border: "1px solid rgba(2,70,40,0.25)",
            padding: "16px 20px",
            marginBottom: 18,
          }}
        >
          <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.35em", textTransform: "uppercase", color: "#024628" }}>
            Pre-order
          </p>
          <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 300, lineHeight: 1.55, color: "#024628" }}>
            First deliveries begin soon. We&apos;ll confirm your delivery date by SMS + WhatsApp as soon as the schedule opens.
          </p>
        </div>
      ) : null}
      {/* Task G: cream-tinted card → paper card, FG text. Delivery slot line
          retires walnut-gold → FG@85% (still hierarchically stronger than
          address body text at 65%). */}
      <div style={{ background: "var(--surface-paper)", border: "1px solid #024628", borderRadius: "var(--card-radius)", padding: "18px 20px", marginBottom: 22 }}>
        <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.4em", textTransform: "uppercase", color: "#024628" }}>
          Order Total
        </p>
        <p style={{ margin: "4px 0 0", fontFamily: "var(--font-heading)", fontSize: 30, fontWeight: 300, color: "#024628" }}>
          ₹{grandTotal}
        </p>
        <p style={{ margin: "4px 0 12px", fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "#024628", letterSpacing: "0.04em" }}>
          Includes ₹{deliveryFee} delivery
        </p>
        <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "#024628", letterSpacing: "0.03em" }}>
          {customerName} · +91 {customerPhone.replace(/\D/g, "")}
        </p>
        <p style={{ margin: "4px 0 0", fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "#024628", letterSpacing: "0.03em", lineHeight: 1.6 }}>
          {fullAddress}
        </p>
        {preorderMode ? (
          <p style={{ margin: "10px 0 0", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.2em", textTransform: "uppercase", color: "#024628" }}>
            Delivery date to be scheduled
          </p>
        ) : (
          deliveryDate && deliverySlot && (
            <p style={{ margin: "10px 0 0", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.2em", textTransform: "uppercase", color: "#024628" }}>
              {formatDeliveryDate(deliveryDate)} · {formatSlot12(deliverySlot)}
            </p>
          )
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

/* ── Fulfillment toggle (Delivery / Pickup) ─────────────────────────── */
// Compact two-tab picker rendered at the top of the address step. Toggling
// resets addressConfirmed in the parent so the summary re-arms cleanly for
// the new flow. Matrix-legal on ash: solid #024628 border, brand-fill for
// the active tab, transparent for the inactive.
function FulfillmentToggle({
  value,
  onChange,
}: {
  value: "delivery" | "pickup";
  onChange: (next: "delivery" | "pickup") => void;
}) {
  const tab = (
    key: "delivery" | "pickup",
    label: string,
    hint: string,
  ) => {
    const active = value === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onChange(key)}
        aria-pressed={active}
        style={{
          flex: 1,
          display: "flex", flexDirection: "column", alignItems: "flex-start",
          gap: 4,
          padding: "14px 16px",
          minHeight: 62,
          background: active ? "var(--surface-brand)" : "transparent",
          border: "1px solid #024628",
          cursor: "pointer",
          fontFamily: "var(--font-body)",
          color: active ? "#FBF3D4" : "#024628",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 500, letterSpacing: "0.35em", textTransform: "uppercase" }}>
          {label}
        </span>
        <span style={{ fontSize: 16, fontWeight: 200, letterSpacing: "0.02em", opacity: active ? 0.85 : 0.7 }}>
          {hint}
        </span>
      </button>
    );
  };
  return (
    <section style={{ marginBottom: 22 }}>
      <p style={{ margin: "0 0 10px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.4em", textTransform: "uppercase", color: "#024628" }}>
        How would you like your bread?
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        {tab("delivery", "Delivery", "We deliver to your door")}
        {tab("pickup",   "Pickup",   "Free · collect from a stall")}
      </div>
    </section>
  );
}

/* ── Pickup section (address-step body when isPickup) ────────────────── */
// Replaces the returning/fresh AddressForm branch when Pickup is selected.
// Shows (a) the customer identity block — saved details for returning, or a
// compact name + phone + OTP form for fresh — and (b) the stall picker,
// already sorted nearest-first by the parent via haversineKm.
function PickupSection(props: {
  formMode: FormMode;
  savedCustomer: Customer | null;
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
  onSwitchToFresh: () => void;
  pickupLocations: Array<{
    id: string; name: string; area: string;
    latitude: number; longitude: number;
    address?: string | null;
    type?: string | null;
  }>;
  pickupLocationsLoading: boolean;
  pickupLocationId: string | null;
  setPickupLocationId: (id: string) => void;
  customerHasCoords: boolean;
}) {
  const {
    formMode, savedCustomer,
    name, setName, phone, setPhone,
    otpSent, otpCode, setOtpCode,
    otpVerified, setOtpVerified, setOtpSent,
    otpError, setOtpError,
    sendOtp, verifyOtp, sendingOtp, verifyingOtp,
    onSwitchToFresh,
    pickupLocations, pickupLocationsLoading,
    pickupLocationId, setPickupLocationId,
    customerHasCoords,
  } = props;

  const isReturning = formMode === "returning" && !!savedCustomer;

  return (
    <>
      {/* ── Identity block ─────────────────────────────────────────── */}
      {isReturning ? (
        <section>
          <p style={sectionHead}>Your Details</p>
          <div
            style={{
              background: "var(--surface-paper)",
              border: "1px solid #024628",
              borderRadius: "var(--card-radius)",
              padding: "16px 18px",
              marginBottom: 16,
            }}
          >
            <p style={{ margin: "0 0 6px", fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 300, color: "#024628", letterSpacing: "0.04em" }}>
              {savedCustomer!.full_name}
            </p>
            <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "#024628", letterSpacing: "0.03em" }}>
              +91 {savedCustomer!.phone}
            </p>
          </div>

          {!otpVerified ? (
            <SavedCustomerOtpBlock
              phone={savedCustomer!.phone}
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
          ) : (
            <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.25em", textTransform: "uppercase", color: "#024628" }}>
              ✓ Phone Verified
            </p>
          )}

          <button
            type="button"
            onClick={onSwitchToFresh}
            style={{
              display: "block", width: "100%",
              background: "none", border: "none",
              cursor: "pointer", padding: "12px 0",
              fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
              letterSpacing: "0.35em", textTransform: "uppercase",
              color: "#024628",
              WebkitTapHighlightColor: "transparent",
              marginBottom: 8,
            }}
          >
            Order with a Different Number
          </button>
        </section>
      ) : (
        <section>
          <p style={sectionHead}>Your Details</p>

          <div style={{ marginBottom: 14 }}>
            <span style={labelSt}>Full name *</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Anisha Rao"
              style={inputSt}
              autoComplete="name"
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <span style={labelSt}>Phone number *</span>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => {
                  const next = e.target.value.replace(/\D/g, "").slice(0, 10);
                  setPhone(next);
                  if (otpVerified) {
                    setOtpVerified(false); setOtpSent(false); setOtpCode(""); setOtpError("");
                  }
                }}
                placeholder="10-digit mobile"
                // minWidth:0 so flex:1 can shrink below the input's intrinsic
                // width — otherwise the flexShrink:0 sibling button overflows.
                style={{ ...inputSt, flex: 1, minWidth: 0 }}
                autoComplete="tel"
                maxLength={10}
              />
              {otpVerified ? (
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", padding: "0 12px" }}>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.2em", color: "#024628" }}>
                    ✓ Verified
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={sendOtp}
                  disabled={sendingOtp || phone.replace(/\D/g, "").length < 10}
                  style={{
                    flexShrink: 0, minHeight: 48,
                    background: "none",
                    border: "1px solid #024628",
                    padding: "0 16px",
                    cursor: (sendingOtp || phone.replace(/\D/g, "").length < 10) ? "default" : "pointer",
                    fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
                    letterSpacing: "0.35em", textTransform: "uppercase",
                    color: "#024628",
                    opacity: (sendingOtp || phone.replace(/\D/g, "").length < 10) ? 0.4 : 1,
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  {sendingOtp ? "Sending…" : otpSent ? "Resend" : "Send OTP"}
                </button>
              )}
            </div>
          </div>

          {otpSent && !otpVerified && (
            <div style={{ marginBottom: 14 }}>
              <span style={labelSt}>Enter OTP *</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otpCode}
                onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setOtpError(""); }}
                placeholder="6-digit code"
                style={{ ...inputSt, letterSpacing: "0.4em", fontSize: 19 }}
              />
              <button
                type="button"
                onClick={verifyOtp}
                disabled={verifyingOtp || otpCode.replace(/\D/g, "").length < 6}
                style={{
                  marginTop: 10, display: "block", width: "100%",
                  height: 48,
                  background: "var(--surface-brand)",
                  border: "none",
                  cursor: (verifyingOtp || otpCode.replace(/\D/g, "").length < 6) ? "default" : "pointer",
                  fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
                  letterSpacing: "0.4em", textTransform: "uppercase",
                  color: "#FBF3D4",
                  opacity: (verifyingOtp || otpCode.replace(/\D/g, "").length < 6) ? 0.5 : 1,
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {verifyingOtp ? "Verifying…" : "Verify"}
              </button>
              {otpError && (
                <p style={{ margin: "8px 0 0", fontFamily: "var(--font-body)", fontSize: 16, color: "var(--warning-on-light)", letterSpacing: "0.04em" }}>
                  {otpError}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Stall picker ───────────────────────────────────────────── */}
      <section style={{ marginTop: 8, marginBottom: 8 }}>
        <p style={sectionHead}>Choose a pickup point</p>
        {pickupLocationsLoading && pickupLocations.length === 0 && (
          <p style={{ margin: "0 0 12px", fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "#024628", letterSpacing: "0.03em" }}>
            Loading nearby stalls…
          </p>
        )}
        {!pickupLocationsLoading && pickupLocations.length === 0 && (
          <p style={{ margin: "0 0 12px", fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "var(--warning-on-light)", letterSpacing: "0.03em" }}>
            No pickup points available right now. Please switch to Delivery, or try again in a moment.
          </p>
        )}
        {pickupLocations.length > 0 && (
          <>
            {customerHasCoords && (
              <p style={{ margin: "0 0 10px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.35em", textTransform: "uppercase", color: "#024628" }}>
                Sorted by nearest to you
              </p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {pickupLocations.map((loc) => {
                const active = loc.id === pickupLocationId;
                return (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => setPickupLocationId(loc.id)}
                    aria-pressed={active}
                    style={{
                      display: "block", textAlign: "left", width: "100%",
                      padding: "12px 14px",
                      border: `1px solid ${active ? "#024628" : "rgba(2,70,40,0.35)"}`,
                      background: active ? "rgba(2,70,40,0.06)" : "transparent",
                      cursor: "pointer",
                      fontFamily: "var(--font-body)",
                      color: "#024628",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8, marginBottom: 4,
                      fontSize: 14, fontWeight: 500,
                      letterSpacing: "0.25em", textTransform: "uppercase",
                    }}>
                      <span>{loc.area}</span>
                      {active && <span style={{ marginLeft: "auto", opacity: 0.8 }}>Selected</span>}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 300, lineHeight: 1.5 }}>
                      {loc.name}
                    </div>
                    {loc.address && (
                      <div style={{ marginTop: 2, fontSize: 16, fontWeight: 200, lineHeight: 1.5, opacity: 0.8 }}>
                        {loc.address}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>
    </>
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
          background: "#024628",
          border: "none",
          cursor: loading ? "default" : "pointer",
          fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
          letterSpacing: "0.4em", textTransform: "uppercase",
          color: "#FBF3D4",
          opacity: loading ? 0.6 : 1,
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
          border: "1px solid #024628",
          cursor: loading ? "default" : "pointer",
          fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
          letterSpacing: "0.4em", textTransform: "uppercase",
          color: "#024628",
          opacity: loading ? 0.5 : 1,
          WebkitTapHighlightColor: "transparent",
        }}
      >
        Cash on Delivery
      </button>
    </div>
  );
}

/* ── Pincode serviceability indicator ────────────────────────────────── */
// Task G: green-on-green + amber-on-amber → matrix-legal FG "success" (brand
// IS green) and --warning-on-light for unserviceable/error. Checking uses
// FG@75%.
function PincodeStatusStrip({ pinStatus }: { pinStatus: PinState }) {
  if (pinStatus.state === "idle") return null;
  const isOk = pinStatus.state === "serviceable";
  const isBad = pinStatus.state === "unserviceable";
  const isChecking = pinStatus.state === "checking";
  const isErr = pinStatus.state === "error";
  const border = isOk
    ? "1px solid #024628"
    : (isBad || isErr)
      ? "1px solid rgba(153,27,27,0.4)"
      : "1px solid #024628";
  const bg = isOk
    ? "rgba(2,70,40,0.06)"
    : (isBad || isErr)
      ? "rgba(153,27,27,0.06)"
      : "transparent";
  const fg = isOk
    ? "#024628"
    : (isBad || isErr)
      ? "var(--warning-on-light)"
      : "#024628";
  return (
    <div
      style={{
        marginBottom: 22,
        padding: "12px 14px",
        border,
        background: bg,
        fontFamily: "var(--font-body)",
        fontSize: 16,
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
  preorderMode,
}: {
  tomorrowIso: string;
  dayAfterIso: string;
  deliveryDate: string;
  deliverySlot: string;
  onPickDate: (d: string) => void;
  onPickSlot: (s: string) => void;
  preorderMode: boolean;
}) {
  const dates: { iso: string; tag: string }[] = [
    { iso: tomorrowIso, tag: "Tomorrow" },
    { iso: dayAfterIso, tag: "Day after" },
  ];
  return (
    <section style={{ marginBottom: 24 }}>
      {preorderMode ? (
        <div
          style={{
            background: "#FBF3D4",
            border: "1px solid rgba(2,70,40,0.25)",
            padding: "16px 20px",
            marginBottom: 22,
          }}
        >
          <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.35em", textTransform: "uppercase", color: "#024628" }}>
            Pre-order
          </p>
          <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 300, lineHeight: 1.55, color: "#024628" }}>
            First deliveries begin soon. Delivery date + time will be scheduled shortly — we&apos;ll confirm by SMS + WhatsApp.
          </p>
        </div>
      ) : null}

      <p style={sectionHead}>Pick a Date</p>

      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 26,
          opacity: preorderMode ? 0.5 : 1,
          pointerEvents: preorderMode ? "none" : "auto",
        }}
        aria-disabled={preorderMode || undefined}
      >
        {dates.map((d) => {
          const active = d.iso === deliveryDate;
          return (
            <button
              key={d.iso}
              type="button"
              disabled={preorderMode}
              onClick={() => onPickDate(d.iso)}
              style={{
                flex: 1,
                minHeight: 72,
                padding: "14px 12px",
                background: active ? "var(--surface-brand)" : "transparent",
                border: "1px solid #024628",
                cursor: preorderMode ? "not-allowed" : "pointer",
                fontFamily: "var(--font-body)",
                color: active ? "#FBF3D4" : "#024628",
                textAlign: "left",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <div
                style={{
                  fontSize: 14, fontWeight: 500,
                  letterSpacing: "0.35em", textTransform: "uppercase",
                  color: active ? "rgba(251,243,212,0.75)" : "#024628",
                  marginBottom: 6,
                }}
              >
                {d.tag}
              </div>
              <div style={{ fontSize: 16, fontWeight: 300, letterSpacing: "0.04em" }}>
                {formatDeliveryDate(d.iso)}
              </div>
            </button>
          );
        })}
      </div>

      <p style={sectionHead}>Pick a Time</p>
      <div
        style={{
          opacity: preorderMode ? 0.5 : 1,
          pointerEvents: preorderMode ? "none" : "auto",
        }}
        aria-disabled={preorderMode || undefined}
      >
        <SlotPicker
          deliveryDate={deliveryDate}
          deliverySlot={deliverySlot}
          onPickSlot={onPickSlot}
        />
      </div>
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
          borderRadius: "var(--card-radius)",
          border: "1px solid #024628",
          background: "var(--surface-paper)",
          color: "#024628",
          fontSize: 16,
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
      <Select
        value={deliverySlot}
        onChange={onPickSlot}
        ariaLabel="Delivery time slot"
        placeholder="Select a delivery time…"
        options={slots.map((s) => ({
          value: s.value,
          label: `${formatSlot12(s.value)}${s.disabled ? " — too soon" : ""}`,
          disabled: s.disabled,
        }))}
      />
    </label>
  );
}
