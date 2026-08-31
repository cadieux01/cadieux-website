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
import ProductTile, { type TileStat } from "@/components/ProductTile";
import ScrollReveal from "@/components/ScrollReveal";
import { PRODUCTS, type ProductMedia } from "@/lib/data";
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
  {
    name: string;
    tag: string;
    title: string;
    subtitle: string;
    // Resolved product_stat_tiles for this slug. Empty = no strip.
    stats: TileStat[];
  }
>;

export default function ShopListClient({
  availability,
  priceBySlug,
  mediaBySlug,
  contentBySlug,
}: {
  availability: AvailabilityMap | null;
  // Live DB price per slug. Falls back to the bundled PRODUCTS price only
  // when a slug is missing (offline / fetch failure) so display + cart can
  // never silently disagree with the products table.
  priceBySlug?: Record<string, number>;
  // Live DB image/gallery media per slug (products.image_url +
  // products.gallery_urls, resolved server-side). A slug may be absent
  // (offline / fetch failure) or map to an empty array when no admin photo
  // exists — the tile renders its empty state in both cases.
  mediaBySlug?: Record<string, ProductMedia[]>;
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
        fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#4369B2", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>←</span> Cadieux
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "72px clamp(18px,5vw,80px) 80px", maxWidth: 1200, margin: "0 auto" }}>
        <ScrollReveal>
          <h1 data-stagger style={{ margin: "0 0 12px", fontFamily: "var(--font-heading)", fontSize: "clamp(34px,8vw,80px)", fontWeight: 300, color: "#024628", letterSpacing: "0.02em", lineHeight: 1 }}>
            Cadieux Protein Bread
          </h1>
          <p data-stagger style={{
            margin: "0 0 20px",
            fontFamily: "var(--font-body)",
            fontSize: 16,
            fontWeight: 400,
            lineHeight: 1.55,
            color: "#024628",
            maxWidth: 520,
          }}>
            Two clean, high-protein loaves. High in protein, slow-fermented and lab-tested. A protein bread with no artificial preservatives, baked fresh in Vizag and delivered across Andhra Pradesh. Pick a variant to see photos, ingredients, and reports.
          </p>

          <div data-stagger className="cdx-tab-group" style={{ marginBottom: 28 }} role="tablist">
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
                  <div data-stagger key={p.slug} style={{ height: "100%" }}>
                    <ProductTile
                      slug={p.slug}
                      productIndex={PRODUCTS.findIndex((x) => x.slug === p.slug)}
                      name={c?.name || p.name}
                      tag={c?.tag || p.tag}
                      title={c?.title || p.title}
                      subtitle={c?.subtitle || p.subtitle}
                      price={priceBySlug?.[p.slug] ?? p.price}
                      stats={c?.stats ?? []}
                      media={mediaBySlug?.[p.slug] ?? []}
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
  // Geometry, type, and colour pairing are locked in `.cdx-tab` (globals.css).
  // Active state = FG bg + Cream label (9.88:1 AAA). Inactive = transparent + FG.
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`cdx-tab${active ? " is-active" : ""}`}
      onClick={onClick}
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
                  border: "1px solid #024628",
                  background: "transparent",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontWeight: 300, fontSize: 22, color: "#024628" }}>
                    {p.title}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    {showStrike && (
                      <span style={{ fontSize: 16, color: "#024628", opacity: 0.55, textDecoration: "line-through" }}>
                        ₹{money(mrp!)}
                      </span>
                    )}
                    <span style={{ fontSize: 16, fontWeight: 500, color: "#024628" }}>₹{money(p.price)}</span>
                  </div>
                </div>
                <div style={{ marginTop: 4, fontSize: 16, color: "#024628" }}>{p.blurb}</div>
                {savings > 0 && (
                  <div style={{ marginTop: 6, fontSize: 16, fontWeight: 500, color: "#1D1D1F" }}>
                    You save ₹{money(savings)}{pct > 0 ? ` (${pct}%)` : ""} per loaf
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p style={{ fontSize: 16, color: "#024628", lineHeight: 1.55, marginBottom: 18, maxWidth: 460 }}>
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
            fontSize: 14,
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
