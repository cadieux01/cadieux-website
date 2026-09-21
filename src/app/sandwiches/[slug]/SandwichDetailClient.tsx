"use client";

// Sandwich PDP client half. Bread selector (only the variants with a live
// is_available row make it here from the server), quantity stepper, add-to
// -cart, and the closed-window banner when the kitchen is dark. The
// add-to-cart CTA is disabled outside the open window.
//
// Cart line uses the sandwich shape from CartItem: productIndex=-1
// (sentinel), kind='sandwich', sandwichSlug + breadSlug + breadLabel frozen
// at add time so a rename downstream can never change what a customer
// already saw.

import { useState } from "react";
import { useRouter } from "next/navigation";
import BackLink from "@/components/BackLink";
import ScrollReveal from "@/components/ScrollReveal";
import { useCart } from "@/context/CartContext";
import type { Sandwich, SandwichVariant } from "@/lib/sandwich-menu";

const GRAIN = "url(/grain.svg)";
const FG = "#024628";
const CREAM = "#FBF3D4";

export default function SandwichDetailClient({
  sandwich,
  openNow,
  opensAt,
  closesAt,
}: {
  sandwich: Sandwich;
  openNow: boolean;
  opensAt: string;
  closesAt: string;
}) {
  const router = useRouter();
  const { addToCart } = useCart();

  // Preselect the cheapest bread — matches how the list card advertises
  // "From ₹N". A customer opening a card labelled "From ₹99" and seeing the
  // ₹109 variant preselected reads as a bait.
  const initialVariantId = sandwich.variants.reduce(
    (min, v) => (min === null || v.priceInr < min.priceInr ? v : min),
    null as SandwichVariant | null,
  )?.id ?? sandwich.variants[0]?.id ?? null;

  const [variantId, setVariantId] = useState<string | null>(initialVariantId);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);

  const variant = sandwich.variants.find((v) => v.id === variantId) ?? null;
  const price = variant?.priceInr ?? 0;

  function onAddToCart() {
    if (!variant || busy) return;
    setBusy(true);
    addToCart({
      kind: "sandwich",
      productIndex: -1, // sentinel; sandwich lines are keyed by slug + bread
      sandwichSlug: sandwich.slug,
      breadSlug: variant.breadSlug,
      breadLabel: variant.breadLabel,
      name: `${sandwich.name} on ${variant.breadLabel}`,
      price: variant.priceInr,
      qty,
      orderType: "once",
    });
    // Match the loaf PDP behaviour — go to the cart on successful add.
    router.push("/cart");
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#C0C8CE", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      <BackLink href="/sandwiches" color="#4369B2">Sandwiches</BackLink>

      <div style={{ position: "relative", zIndex: 1, padding: "72px clamp(18px,5vw,80px) 80px", maxWidth: 900, margin: "0 auto" }}>
        <ScrollReveal>
          <div
            data-stagger
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr)",
              gap: 24,
            }}
          >
            <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", borderRadius: 14, overflow: "hidden", background: FG, border: "1px solid rgba(2,70,40,0.25)" }}>
              {sandwich.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sandwich.imageUrl}
                  alt={sandwich.name}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 16,
                    textAlign: "center",
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    letterSpacing: "0.28em",
                    textTransform: "uppercase",
                    color: "rgba(251,243,212,0.65)",
                  }}
                >
                  Photography coming soon
                </div>
              )}
            </div>
          </div>

          <div data-stagger style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 24 }}>
            <VegMarker category={sandwich.category} size={16} />
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: FG,
              }}
            >
              {sandwich.category === "veg" ? "Veg" : "Non-veg"}
            </span>
          </div>

          <h1
            data-stagger
            style={{
              margin: "8px 0 12px",
              fontFamily: "var(--font-heading)",
              fontSize: "clamp(28px,6vw,52px)",
              fontWeight: 300,
              color: FG,
              letterSpacing: "0.02em",
              lineHeight: 1.1,
            }}
          >
            {sandwich.name}
          </h1>

          {sandwich.description && (
            <p
              data-stagger
              style={{
                margin: "0 0 20px",
                fontFamily: "var(--font-body)",
                fontSize: 16,
                lineHeight: 1.6,
                color: FG,
                maxWidth: 640,
              }}
            >
              {sandwich.description}
            </p>
          )}

          {!openNow && (
            <div data-stagger style={{
              marginBottom: 20,
              padding: "12px 16px",
              borderRadius: 10,
              border: `1px solid ${FG}`,
              background: "transparent",
              color: FG,
              fontFamily: "var(--font-body)",
              fontSize: 15,
              lineHeight: 1.5,
              maxWidth: 560,
            }}>
              Kitchen closed — opens {opensAt}. Ordering re-opens at {opensAt} and closes at {closesAt}.
            </div>
          )}

          <div data-stagger style={{ marginBottom: 20 }}>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: FG,
                marginBottom: 10,
              }}
            >
              Bread
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {sandwich.variants.map((v) => {
                const active = v.id === variantId;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVariantId(v.id)}
                    aria-pressed={active}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 16px",
                      borderRadius: 999,
                      border: `1px solid ${FG}`,
                      background: active ? FG : "transparent",
                      color: active ? CREAM : FG,
                      fontFamily: "var(--font-body)",
                      fontSize: 15,
                      fontWeight: 500,
                      letterSpacing: "0.06em",
                      cursor: "pointer",
                    }}
                  >
                    <span>{v.breadLabel}</span>
                    <span style={{ opacity: 0.8 }}>₹{v.priceInr}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div data-stagger style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
            <QtyStepper qty={qty} setQty={setQty} />
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 24,
                fontWeight: 400,
                color: FG,
              }}
            >
              ₹{price * qty}
            </div>
          </div>

          <button
            data-stagger
            type="button"
            onClick={onAddToCart}
            disabled={!variant || !openNow || busy}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "14px 28px",
              borderRadius: 999,
              background: FG,
              color: CREAM,
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              border: "none",
              cursor: !variant || !openNow || busy ? "not-allowed" : "pointer",
              opacity: !variant || !openNow || busy ? 0.5 : 1,
            }}
          >
            {openNow ? "Add to cart" : `Opens ${opensAt}`}
          </button>
        </ScrollReveal>
      </div>
    </div>
  );
}

function VegMarker({ category, size = 14 }: { category: "veg" | "nonveg"; size?: number }) {
  const color = category === "veg" ? "#2E8B2E" : "#C13B3B";
  return (
    <span
      aria-label={category === "veg" ? "Vegetarian" : "Non-vegetarian"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        border: `1.5px solid ${color}`,
        borderRadius: 2,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: size * 0.45,
          height: size * 0.45,
          background: color,
          borderRadius: 999,
        }}
      />
    </span>
  );
}

function QtyStepper({ qty, setQty }: { qty: number; setQty: (n: number) => void }) {
  const btn: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: 999,
    border: `1px solid ${FG}`,
    background: "transparent",
    color: FG,
    fontFamily: "var(--font-heading)",
    fontSize: 20,
    fontWeight: 400,
    cursor: "pointer",
  };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
      <button type="button" style={btn} onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease quantity">−</button>
      <div style={{ minWidth: 24, textAlign: "center", fontFamily: "var(--font-heading)", fontSize: 20, color: FG }}>{qty}</div>
      <button type="button" style={btn} onClick={() => setQty(Math.min(20, qty + 1))} aria-label="Increase quantity">+</button>
    </div>
  );
}
