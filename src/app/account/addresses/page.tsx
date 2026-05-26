"use client";

// /account/addresses — standalone view for the user's saved address.
//
// The website's data model keeps one address per customer (derived from
// orders.delivery_address on the latest order, surfaced by the
// /api/checkout?slim=1 prefill). Multi-address support lives only in the
// mobile app (/api/mobile/addresses, Bearer-auth). To keep the website
// honest about its single-address model, this page mirrors the
// saved-details card shown on the checkout step: read-only display,
// "Edit" hops to /checkout?edit=1 (which lands the wizard in edit mode
// using the same form the user already knows), "Delete" clears the
// cadieux_phone localStorage entry the rest of the site uses as a
// soft "logged-in" signal.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const GRAIN = "url(/grain.svg)";

type SavedAddress = {
  full_name: string | null;
  phone: string | null;
  city: string | null;
  delivery_address: string;
};

export default function AddressesPage() {
  const router = useRouter();
  const [phoneMissing, setPhoneMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<SavedAddress | null>(null);

  async function fetchAddress() {
    const phone =
      typeof window !== "undefined"
        ? localStorage.getItem("cadieux_phone")
        : null;
    if (!phone) {
      setPhoneMissing(true);
      setLoading(false);
      return;
    }
    setPhoneMissing(false);
    setLoading(true);
    try {
      const r = await fetch(
        `/api/checkout?phone=${encodeURIComponent(phone)}&slim=1`,
        { cache: "no-store" },
      );
      const d = await r.json();
      if (d?.customer) {
        setSaved({
          full_name: d.customer.full_name ?? null,
          phone: d.customer.phone ?? phone,
          city: d.customer.city ?? null,
          delivery_address: d.customer.delivery_address ?? "",
        });
      } else {
        // localStorage has a phone but the customer row doesn't exist
        // (first-time visit on this device, or the row was deleted).
        // Treat as no saved address rather than an error.
        setSaved(null);
      }
    } catch {
      setSaved(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAddress();
  }, []);

  function handleEdit() {
    // The checkout step already exposes a fully-validated Edit Details
    // flow (label picker, place autocomplete, pincode serviceability,
    // GPS capture). Hopping there with ?edit=1 lands the wizard in
    // formMode="edit" so the user can update fields inline and re-save
    // by placing their next order. We don't bypass that — modifying
    // address mid-life would diverge from the actual order's
    // delivery_address column (the historical source of truth).
    router.push("/checkout?edit=1");
  }

  function handleDelete() {
    if (
      !window.confirm(
        "Forget this saved address? You'll need to enter it again next time you check out.",
      )
    ) {
      return;
    }
    try {
      localStorage.removeItem("cadieux_phone");
    } catch {
      /* private mode */
    }
    try {
      sessionStorage.removeItem("cadieux_verified_phone");
    } catch {
      /* private mode */
    }
    setSaved(null);
    setPhoneMissing(true);
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "rgb(6,4,2)",
        position: "relative",
        overflowX: "clip",
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: GRAIN,
          opacity: 0.055,
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
          fontSize: 10,
          fontWeight: 200,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          color: "#4369B2",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "100px clamp(24px,6vw,80px) 120px",
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(48px,11vw,88px)",
            fontWeight: 300,
            color: "#FBF3D4",
            letterSpacing: "0.02em",
            lineHeight: 1,
          }}
        >
          Your Address
        </h1>
        <p
          style={{
            margin: "8px 0 36px",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 200,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(251,243,212,0.5)",
          }}
        >
          Saved delivery details
        </p>

        {loading && (
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 15,
              color: "rgba(240,223,200,0.3)",
              letterSpacing: "0.1em",
            }}
          >
            Loading…
          </p>
        )}

        {!loading && phoneMissing && (
          <div>
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 15,
                fontWeight: 200,
                color: "rgba(240,223,200,0.55)",
                lineHeight: 1.7,
                marginBottom: 24,
              }}
            >
              No address saved on this device. Place an order from the cart and
              we&apos;ll remember your delivery details for next time.
            </p>
            <Link
              href="/cart"
              style={{
                display: "inline-block",
                padding: "14px 28px",
                border: "1px solid rgba(200,144,58,0.45)",
                background: "rgba(200,144,58,0.06)",
                fontFamily: "var(--font-body)",
                fontSize: 11,
                fontWeight: 300,
                letterSpacing: "0.4em",
                textTransform: "uppercase",
                color: "rgba(240,223,200,0.85)",
                textDecoration: "none",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Go to Cart
            </Link>
          </div>
        )}

        {!loading && !phoneMissing && saved && (
          <section
            style={{
              position: "relative",
              padding: "22px 22px 20px",
              border: "1px solid rgba(240,223,200,0.12)",
              background: "rgba(240,223,200,0.02)",
              marginBottom: 24,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 10,
                right: 12,
                display: "flex",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={handleEdit}
                style={{
                  background: "none",
                  border: "1px solid rgba(240,223,200,0.18)",
                  padding: "4px 10px",
                  cursor: "pointer",
                  fontFamily: "var(--font-body)",
                  fontSize: 9,
                  fontWeight: 300,
                  letterSpacing: "0.3em",
                  textTransform: "uppercase",
                  color: "rgba(240,223,200,0.7)",
                  WebkitTapHighlightColor: "transparent",
                }}
                aria-label="Edit saved address"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={handleDelete}
                style={{
                  background: "none",
                  border: "1px solid rgba(245,75,75,0.35)",
                  padding: "4px 10px",
                  cursor: "pointer",
                  fontFamily: "var(--font-body)",
                  fontSize: 9,
                  fontWeight: 300,
                  letterSpacing: "0.3em",
                  textTransform: "uppercase",
                  color: "#f87171",
                  WebkitTapHighlightColor: "transparent",
                }}
                aria-label="Delete saved address"
              >
                Delete
              </button>
            </div>
            <p
              style={{
                margin: "0 0 6px",
                paddingRight: 120,
                fontFamily: "var(--font-body)",
                fontSize: 17,
                fontWeight: 300,
                color: "#FBF3D4",
                letterSpacing: "0.04em",
              }}
            >
              {saved.full_name || "—"}
            </p>
            <p
              style={{
                margin: "0 0 6px",
                fontFamily: "var(--font-body)",
                fontSize: 15,
                fontWeight: 200,
                color: "rgba(240,223,200,0.65)",
                letterSpacing: "0.04em",
              }}
            >
              {saved.phone ? `+91 ${saved.phone}` : ""}
            </p>
            {saved.delivery_address ? (
              <p
                style={{
                  margin: 0,
                  fontFamily: "var(--font-body)",
                  fontSize: 14,
                  fontWeight: 200,
                  color: "rgba(240,223,200,0.5)",
                  letterSpacing: "0.03em",
                  lineHeight: 1.7,
                }}
              >
                {saved.delivery_address}
              </p>
            ) : (
              <p
                style={{
                  margin: 0,
                  fontFamily: "var(--font-body)",
                  fontSize: 13,
                  fontWeight: 200,
                  color: "rgba(240,223,200,0.35)",
                  letterSpacing: "0.03em",
                  lineHeight: 1.7,
                }}
              >
                No delivery address yet — place an order to save one.
              </p>
            )}
          </section>
        )}

        {!loading && !phoneMissing && !saved && (
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 15,
              fontWeight: 200,
              color: "rgba(240,223,200,0.4)",
              lineHeight: 1.7,
            }}
          >
            No address found for this account. Place an order to save your
            delivery details.
          </p>
        )}
      </div>
    </div>
  );
}
