"use client";

// Entry tile for the sandwich menu, rendered AFTER the three product tiles on
// /shop. Deliberately NOT a variant of ProductTile: this card is a nav
// affordance (one Link to /sandwiches), not an add-to-cart, so the shared
// media-swipe / OOS / dot-indicator plumbing is dead weight here.
//
// The "Photography coming soon" placeholder reuses the ProductTile block
// verbatim (bg #024628, cream-at-60% caption, 0.26em tracking) so a viewer
// scanning the grid does not read "why does the sandwich card look
// different?" — same brand chrome, one photo away from being fully live.
//
// Rendered ONLY when the kitchen switch is on. See ShopListClient.

import Link from "next/link";
import { useState } from "react";

export default function ShopSandwichTile() {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href="/sandwiches"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        textDecoration: "none",
        color: "inherit",
        background: "#024628",
        borderRadius: 14,
        border: `1px solid rgba(251, 243, 212, ${hover ? 0.45 : 0.2})`,
        overflow: "hidden",
        transform: hover ? "translateY(-4px)" : "translateY(0)",
        transition: "transform 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease",
        boxShadow: hover ? "0 18px 40px rgba(0,0,0,0.45)" : "0 8px 20px rgba(0,0,0,0.25)",
      }}
    >
      <div
        className="shop-sandwich-media"
        style={{ position: "relative", width: "100%", background: "#024628" }}
      >
        {/* Verbatim reuse of the ProductTile empty-media placeholder styling. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#024628",
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
      </div>

      <div className="shop-sandwich-body">
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "#FBF3D4",
            marginBottom: 8,
          }}
        >
          Kitchen
        </div>
        <div
          className="shop-sandwich-title"
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 300,
            color: "#FBF3D4",
            letterSpacing: "0.02em",
            lineHeight: 1.1,
            marginBottom: 8,
          }}
        >
          Sandwich
        </div>
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 15,
            fontWeight: 400,
            lineHeight: 1.5,
            color: "#C0C8CE",
            // Spec: description reads "Sandwiches". Keep it short — the /shop
            // subhead already introduces the catalogue, and the tile only
            // needs enough context for the customer to know what a tap does.
          }}
        >
          Sandwiches
        </div>
      </div>

      <style jsx>{`
        .shop-sandwich-media {
          aspect-ratio: 16 / 11;
        }
        .shop-sandwich-body {
          padding: 16px 16px 18px;
          display: flex;
          flex-direction: column;
          flex: 1;
        }
        .shop-sandwich-title {
          font-size: 22px;
        }
        @media (min-width: 640px) {
          .shop-sandwich-media {
            aspect-ratio: 4 / 5;
          }
          .shop-sandwich-body {
            padding: 18px 20px 20px;
          }
          .shop-sandwich-title {
            font-size: 28px;
          }
        }
      `}</style>
    </Link>
  );
}
