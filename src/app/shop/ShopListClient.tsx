"use client";

// Client half of the shop catalogue. The parent server component
// hands in an availability map so we can:
//   - hide archived/inactive products (anything not in `listed`)
//   - badge out-of-stock items via ProductTile's outOfStock prop
//
// availability=null means the live fetch failed; we render every
// static product as if it's live and in-stock so the shop never
// goes blank.

import { useEffect, useState } from "react";
import Link from "next/link";
import ProductTile from "@/components/ProductTile";
import ScrollReveal from "@/components/ScrollReveal";
import { PRODUCTS, PRODUCT_DETAILS, type ProductSlug } from "@/lib/data";
import type { AvailabilityMap } from "@/lib/products";
import {
  SETUP_PRODUCTS,
  fetchSubscriptionPlans,
  type WizardProduct,
} from "@/lib/subscription-setup";

const GRAIN = "url(/grain.svg)";
const GOLD = "#024628";

type ShopMode = "onetime" | "subscribe";

export type ShopContentBySlug = Record<
  string,
  { name: string; tag: string; title: string; subtitle: string }
>;

export default function ShopListClient({
  availability,
  priceBySlug,
  contentBySlug,
}: {
  availability: AvailabilityMap | null;
  // Live DB price per slug. Falls back to the bundled PRODUCTS price only
  // when a slug is missing (offline / fetch failure) so display + cart can
  // never silently disagree with the products table.
  priceBySlug?: Record<string, number>;
  // Per-slug content (name/tag/title/subtitle) sourced from
  // content_strings via getPageContent with critical-string fallbacks.
  contentBySlug?: ShopContentBySlug;
}) {
  const visibleProducts = availability
    ? PRODUCTS.filter((p) => availability.listed.has(p.slug))
    : PRODUCTS;

  // Tab mode. Initialised from ?mode= on mount (client-only, so the build
  // doesn't need a Suspense boundary around useSearchParams) and mirrored
  // back to the URL with history.replaceState so it's shareable.
  const [mode, setMode] = useState<ShopMode>("onetime");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("mode");
    if (q === "subscribe") setMode("subscribe");
  }, []);
  function switchMode(next: ShopMode) {
    setMode(next);
    const url = new URL(window.location.href);
    if (next === "subscribe") url.searchParams.set("mode", "subscribe");
    else url.searchParams.delete("mode");
    window.history.replaceState(null, "", url.toString());
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#C0C8CE", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      {/* Back link */}
      <Link href="/" style={{
        position: "fixed", top: "calc(24px + env(safe-area-inset-top))", left: "calc(20px + env(safe-area-inset-left))", zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#4369B2", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "72px clamp(18px,5vw,80px) 80px", maxWidth: 1200, margin: "0 auto" }}>
        <ScrollReveal>
          <h1 data-stagger style={{ margin: "0 0 12px", fontFamily: "var(--font-heading)", fontSize: "clamp(34px,8vw,80px)", fontWeight: 300, color: "#024628", letterSpacing: "0.02em", lineHeight: 1 }}>
            Our Breads
          </h1>
          <p data-stagger style={{
            margin: "0 0 20px",
            fontFamily: "var(--font-body)",
            fontSize: 12,
            fontWeight: 300,
            lineHeight: 1.55,
            color: "rgba(2, 70, 40, 0.75)",
            maxWidth: 520,
          }}>
            Two clean, high-protein loaves. Slow-fermented, lab-tested, and baked with nothing hidden. Pick a variant to see photos, ingredients, and reports.
          </p>

          <div data-stagger style={{ display: "flex", gap: 8, marginBottom: 28 }}>
            <TabButton active={mode === "onetime"} onClick={() => switchMode("onetime")}>
              One-time
            </TabButton>
            <TabButton active={mode === "subscribe"} onClick={() => switchMode("subscribe")}>
              Subscribe & save
            </TabButton>
          </div>
        </ScrollReveal>

        {mode === "onetime" ? (
          <ScrollReveal>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 16,
                alignItems: "stretch",
              }}
            >
              {visibleProducts.map((p) => {
                const c = contentBySlug?.[p.slug];
                return (
                  <div data-stagger key={p.slug}>
                    <ProductTile
                      slug={p.slug}
                      productIndex={PRODUCTS.findIndex((x) => x.slug === p.slug)}
                      name={c?.name || p.name}
                      tag={c?.tag || p.tag}
                      title={c?.title || p.title}
                      subtitle={c?.subtitle || p.subtitle}
                      price={priceBySlug?.[p.slug] ?? p.price}
                      stats={p.stats}
                      media={PRODUCT_DETAILS[p.slug as ProductSlug].media}
                      outOfStock={availability?.outOfStock.has(p.slug) ?? false}
                    />
                  </div>
                );
              })}
            </div>
          </ScrollReveal>
        ) : (
          <SubscribePanel />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "9px 18px",
        borderRadius: 999,
        border: `1px solid ${active ? GOLD : "rgba(2,70,40,0.25)"}`,
        background: active ? "rgba(201,169,110,0.12)" : "transparent",
        color: active ? GOLD : "rgba(2,70,40,0.7)",
        fontFamily: "var(--font-body)",
        fontSize: 11,
        fontWeight: 400,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// Subscribe tab: shows the DB-derived per-loaf subscription prices with the
// MRP struck through + savings, and a CTA into the multi-variant wizard.
// Prices come from /api/subscription-plans (same source the wizard uses),
// falling back to SETUP_PRODUCTS while the fetch is in flight / offline.
function SubscribePanel() {
  const [plans, setPlans] = useState<WizardProduct[]>(SETUP_PRODUCTS);
  useEffect(() => {
    fetchSubscriptionPlans().then(setPlans);
  }, []);

  const money = (n: number) =>
    Number.isInteger(n)
      ? n.toLocaleString("en-IN")
      : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <ScrollReveal>
      <div data-stagger style={{ maxWidth: 560 }}>
        <div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
          {plans.map((p) => {
            const mrp = typeof p.mrp_inr === "number" ? p.mrp_inr : null;
            const showStrike = mrp !== null && mrp > p.price;
            const savings =
              typeof p.subscription_savings_inr === "number"
                ? p.subscription_savings_inr
                : mrp !== null
                ? mrp - p.price
                : 0;
            const pct =
              typeof p.subscription_discount_pct === "number"
                ? p.subscription_discount_pct
                : mrp && mrp > 0
                ? Math.round((savings / mrp) * 100)
                : 0;
            return (
              <div
                key={p.slug}
                style={{
                  padding: 18,
                  borderRadius: 14,
                  border: "1px solid rgba(2,70,40,0.2)",
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 22, color: "#024628" }}>
                    {p.title}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    {showStrike && (
                      <span style={{ fontSize: 13, color: "rgba(2,70,40,0.55)", textDecoration: "line-through" }}>
                        ₹{money(mrp!)}
                      </span>
                    )}
                    <span style={{ fontSize: 15, color: GOLD }}>₹{money(p.price)}</span>
                  </div>
                </div>
                <div style={{ marginTop: 4, fontSize: 13, color: "rgba(2,70,40,0.75)" }}>{p.blurb}</div>
                {savings > 0 && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#8fce9b" }}>
                    You save ₹{money(savings)}{pct > 0 ? ` (${pct}%)` : ""} per loaf
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p style={{ fontSize: 12, color: "rgba(2,70,40,0.75)", lineHeight: 1.55, marginBottom: 18, maxWidth: 460 }}>
          Mix any combination of loaves — a subscription needs at least 2 loaves
          per delivery in total. Pick your dates and delivery windows in the next step.
        </p>

        <Link
          href="/subscriptions/setup"
          style={{
            display: "inline-block",
            padding: "13px 26px",
            borderRadius: 999,
            background: GOLD,
            color: "#FBF3D4",
            fontFamily: "var(--font-body)",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            textDecoration: "none",
          }}
        >
          Build your subscription
        </Link>
      </div>
    </ScrollReveal>
  );
}
