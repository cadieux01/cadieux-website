"use client";

// Swiggy-style sandwich menu. Cadieux chrome (cream on FG, DM Sans, 14px
// letter-spaced labels) with the veg / non-veg dot convention Indian menus
// use everywhere — green outlined square for veg, red outlined square for
// non-veg. The filter row at the top toggles the marker into a solid filter;
// tapping the currently-active filter clears it (single-tap toggle rather
// than a third "All" button — a filter that must be re-enabled to disable
// is a footgun).
//
// A card shows a photo (or the "Photography coming soon" placeholder — same
// treatment as the shop / bun PDP) plus the CHEAPEST variant's price as a
// "from ₹N" line. The PDP is where a customer picks a bread; the list is
// just a quick browse.
//
// Closed-window banner: shown when the kitchen is on but outside its
// open/close hours. The list still renders — a customer coming home from
// work at 11:30 PM should be able to see what's on the menu tomorrow, they
// just can't order right now. Add-to-cart lives on the PDP so this list
// stays purely browsable.

import { useMemo, useState } from "react";
import Link from "next/link";
import BackLink from "@/components/BackLink";
import ScrollReveal from "@/components/ScrollReveal";
import type { Sandwich } from "@/lib/sandwich-menu";

const GRAIN = "url(/grain.svg)";
const FG = "#024628";
const CREAM = "#FBF3D4";

type CategoryFilter = "all" | "veg" | "nonveg";

export default function SandwichesListClient({
  menu,
  openNow,
  opensAt,
  closesAt,
}: {
  menu: Sandwich[];
  openNow: boolean;
  opensAt: string;
  closesAt: string;
}) {
  const [filter, setFilter] = useState<CategoryFilter>("all");

  const visible = useMemo(() => {
    if (filter === "all") return menu;
    return menu.filter((s) => s.category === filter);
  }, [menu, filter]);

  return (
    <div style={{ minHeight: "100dvh", background: "#C0C8CE", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      <BackLink href="/shop" color="#4369B2">Cadieux</BackLink>

      <div style={{ position: "relative", zIndex: 1, padding: "72px clamp(18px,5vw,80px) 80px", maxWidth: 1200, margin: "0 auto" }}>
        <ScrollReveal>
          <h1 data-stagger style={{ margin: 0, fontFamily: "var(--font-heading)", fontSize: "clamp(34px,8vw,80px)", fontWeight: 300, color: FG, letterSpacing: "0.02em", lineHeight: 1 }}>
            Sandwiches
          </h1>
          <p data-stagger style={{
            margin: "12px 0 20px",
            fontFamily: "var(--font-body)",
            fontSize: 16,
            fontWeight: 400,
            lineHeight: 1.55,
            color: FG,
            maxWidth: 520,
          }}>
            Made on Cadieux protein bread. Pick a bread on the sandwich page — Plain or Multigrain — and we bake it to order.
          </p>

          {!openNow && (
            // Wording follows the storefront spec ("Kitchen closed — opens 1 PM").
            // formatHour12 renders "1 PM" for 13:00 and "1:30 PM" for 13:30 —
            // deliberately no minutes on the round hour so the banner reads
            // like a human wrote it.
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
              Kitchen closed — opens {opensAt}. Browse the menu; ordering re-opens at {opensAt} and closes at {closesAt}.
            </div>
          )}

          <div data-stagger style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
            <FilterChip
              active={filter === "veg"}
              // Solid green square when active; outlined when not. Standard
              // Indian menu convention — no legend needed.
              markerColor="#2E8B2E"
              label="Veg"
              onClick={() => setFilter((f) => (f === "veg" ? "all" : "veg"))}
            />
            <FilterChip
              active={filter === "nonveg"}
              markerColor="#C13B3B"
              label="Non-veg"
              onClick={() => setFilter((f) => (f === "nonveg" ? "all" : "nonveg"))}
            />
          </div>

          {visible.length === 0 ? (
            <p data-stagger style={{ fontFamily: "var(--font-body)", fontSize: 16, color: FG }}>
              Nothing on the menu right now.
            </p>
          ) : (
            <div
              data-stagger
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 16,
                alignItems: "stretch",
              }}
            >
              {visible.map((s) => (
                <SandwichCard key={s.id} sandwich={s} />
              ))}
            </div>
          )}
        </ScrollReveal>
      </div>
    </div>
  );
}

function VegMarker({ category, size = 14 }: { category: "veg" | "nonveg"; size?: number }) {
  // Outlined square with an inner dot. Matches Indian food-labelling
  // convention (FSSAI): green square + green dot for veg, red for non-veg.
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

function FilterChip({
  active,
  markerColor,
  label,
  onClick,
}: {
  active: boolean;
  markerColor: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        borderRadius: 999,
        border: `1px solid ${FG}`,
        background: active ? FG : "transparent",
        color: active ? CREAM : FG,
        fontFamily: "var(--font-body)",
        fontSize: 14,
        fontWeight: 500,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 14,
          height: 14,
          border: `1.5px solid ${markerColor}`,
          borderRadius: 2,
          background: active ? markerColor : "transparent",
        }}
      >
        {active ? null : (
          <span style={{ width: 6, height: 6, background: markerColor, borderRadius: 999 }} />
        )}
      </span>
      {label}
    </button>
  );
}

function SandwichCard({ sandwich }: { sandwich: Sandwich }) {
  const fromPrice = sandwich.variants.reduce(
    (min, v) => (min === null || v.priceInr < min ? v.priceInr : min),
    null as number | null,
  );
  return (
    <Link
      href={`/sandwiches/${sandwich.slug}`}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        textDecoration: "none",
        color: "inherit",
        background: FG,
        borderRadius: 14,
        border: "1px solid rgba(251,243,212,0.2)",
        overflow: "hidden",
        boxShadow: "0 8px 20px rgba(0,0,0,0.25)",
      }}
    >
      <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 11", background: FG }}>
        {sandwich.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sandwich.imageUrl}
            alt={sandwich.name}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          // Verbatim reuse of the ProductTile / ShopSandwichTile placeholder.
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
              letterSpacing: "0.26em",
              textTransform: "uppercase",
              color: "rgba(251,243,212,0.6)",
            }}
          >
            Photography coming soon
          </div>
        )}
      </div>
      <div style={{ padding: "16px 16px 18px", display: "flex", flexDirection: "column", flex: 1, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <VegMarker category={sandwich.category} />
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: CREAM,
            }}
          >
            {sandwich.category === "veg" ? "Veg" : "Non-veg"}
          </div>
        </div>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 22,
            fontWeight: 300,
            color: CREAM,
            letterSpacing: "0.02em",
            lineHeight: 1.15,
          }}
        >
          {sandwich.name}
        </div>
        {sandwich.description && (
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 14,
              lineHeight: 1.5,
              color: "#C0C8CE",
            }}
          >
            {sandwich.description}
          </div>
        )}
        {fromPrice !== null && (
          <div
            style={{
              marginTop: "auto",
              fontFamily: "var(--font-body)",
              fontSize: 15,
              fontWeight: 500,
              color: CREAM,
            }}
          >
            From ₹{fromPrice}
          </div>
        )}
      </div>
    </Link>
  );
}
