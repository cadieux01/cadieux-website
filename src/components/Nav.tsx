"use client";

import { useState, useEffect } from "react";
import { getLenis } from "@/lib/scroll";

type Page = "blogs" | "making" | "store-locator" | "shop" | null;

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const LINKS: { id: Page; label: string }[] = [
  { id: "blogs",          label: "Blogs" },
  { id: "making",         label: "Making" },
  { id: "store-locator",  label: "Store Locator" },
];

const PRODUCTS = [
  {
    name: "Multi-Grain Protein Bread",
    tags: ["Multi Grains", "No Maida"],
    price: 140,
    protein: "7.2g protein per slice",
    weight: "240g net weight",
    desc: "Ancient grains, seeds, and five distinct protein sources — slow-fermented, cold-proofed, and baked to lock in structure.",
    image: "/hero.jpg",
  },
  {
    name: "Plain High Protein Bread",
    tags: ["Sandwich Bread", "10 Slices"],
    price: 110,
    protein: "7.2g protein per slice",
    weight: "400g packet",
    desc: "Clean, everyday bread built for high protein without the fuss. Soft sandwich slices with no compromise on nutrition.",
    image: "/grains.png",
  },
];

/* ── Sub-page content ── */
function BlogsContent() {
  const posts = [
    "Why Protein Bread Is the Future of Everyday Eating",
    "The Ancient Grains We Swear By",
    "What Happens to Your Body When You Switch to Better Bread",
  ];
  return (
    <>
      <h1 style={{
        margin: "0 0 64px", fontFamily: "var(--font-heading)",
        fontSize: "clamp(52px,12vw,96px)", fontWeight: 300,
        color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1,
      }}>Stories &amp; Bakes</h1>
      {posts.map((title, i) => (
        <div key={i} style={{ borderTop: "1px solid rgba(240,223,200,0.08)", paddingTop: 28, marginBottom: 36 }}>
          <p style={{
            margin: 0, fontFamily: "var(--font-heading)",
            fontSize: "clamp(20px,4vw,32px)", fontWeight: 300,
            color: "rgba(251,243,212,0.75)", letterSpacing: "0.01em", lineHeight: 1.2,
          }}>{title}</p>
        </div>
      ))}
    </>
  );
}

function MakingContent() {
  return (
    <>
      <h1 style={{
        margin: "0 0 48px", fontFamily: "var(--font-heading)",
        fontSize: "clamp(52px,12vw,96px)", fontWeight: 300,
        color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1,
      }}>How It&apos;s Made</h1>
      <p style={{
        margin: 0, fontFamily: "var(--font-body)", fontSize: 11,
        fontWeight: 200, letterSpacing: "0.25em", textTransform: "uppercase",
        color: "#4369B2", lineHeight: 2.2, maxWidth: 640,
      }}>
        Every loaf begins with slow fermentation — rye sourdough cultures
        developed over days, not hours. We cold-proof overnight, layer in
        five distinct protein sources, and bake at precise temperatures to
        lock in structure without sacrificing crust. Nothing is rushed.
        Nothing is stripped away.
      </p>
    </>
  );
}

const VIZAG_AREAS = [
  "Madhurawada",
  "Gajuwaka",
  "MVP Colony",
  "Rushikonda",
  "Seethammadhara",
  "Dwaraka Nagar",
  "Bheemunipatnam",
  "Kommadi",
  "Pendurthi",
  "Waltair Uplands",
];

const STORES: Record<string, { name: string; address: string }[]> = {
  Madhurawada: [
    { name: "Madhu Super Market", address: "Madhurawada, Visakhapatnam — Cadieux Stockist" },
  ],
};

function StoreContent() {
  const [selected, setSelected] = useState<string>("");
  const results = selected ? (STORES[selected] ?? []) : null;

  return (
    <>
      <h1 style={{
        margin: "0 0 48px", fontFamily: "var(--font-heading)",
        fontSize: "clamp(52px,12vw,96px)", fontWeight: 300,
        color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1,
      }}>Find Cadieux</h1>
      <div style={{ maxWidth: 440 }}>
        <p style={{
          margin: "0 0 24px",
          fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200,
          letterSpacing: "0.3em", textTransform: "uppercase",
          color: "rgba(251,243,212,0.5)",
        }}>Select your area in Vizag</p>

        {/* Area list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {VIZAG_AREAS.map((area) => (
            <button
              key={area}
              onClick={() => setSelected(area)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                borderBottom: "1px solid rgba(251,243,212,0.08)",
                padding: "14px 0",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200,
                letterSpacing: "0.35em", textTransform: "uppercase",
                color: selected === area ? "#FBF3D4" : "rgba(251,243,212,0.45)",
                textAlign: "left",
                WebkitTapHighlightColor: "transparent",
                transition: "color 0.2s",
              }}
            >
              <span>{area}</span>
              {selected === area && (
                <span style={{ fontSize: 10, color: "#4369B2", letterSpacing: "0.3em" }}>
                  SELECTED
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Results */}
        {results !== null && (
          <div style={{ marginTop: 36 }}>
            {results.length === 0 ? (
              <p style={{
                margin: 0, fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: "rgba(251,243,212,0.35)",
              }}>No stores found in this area yet.</p>
            ) : (
              <>
                <p style={{
                  margin: "0 0 20px", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200,
                  letterSpacing: "0.4em", textTransform: "uppercase",
                  color: "rgba(251,243,212,0.4)",
                }}>Stores near {selected}</p>
                {results.map((s, i) => (
                  <div key={i} style={{
                    borderTop: "1px solid rgba(251,243,212,0.1)",
                    paddingTop: 20, paddingBottom: 20,
                  }}>
                    <p style={{
                      margin: "0 0 6px", fontFamily: "var(--font-heading)",
                      fontSize: "clamp(20px,4vw,28px)", fontWeight: 300,
                      color: "#FBF3D4", letterSpacing: "0.01em",
                    }}>{s.name}</p>
                    <p style={{
                      margin: 0, fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
                      letterSpacing: "0.25em", textTransform: "uppercase",
                      color: "rgba(251,243,212,0.4)",
                    }}>{s.address}</p>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function ShopContent() {
  return (
    <>
      <h1 style={{
        margin: "0 0 64px", fontFamily: "var(--font-heading)",
        fontSize: "clamp(52px,12vw,96px)", fontWeight: 300,
        color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1,
      }}>Our Breads</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {PRODUCTS.map((p, i) => (
          <div key={i} style={{
            borderTop: "1px solid rgba(240,223,200,0.1)",
            paddingTop: 36, paddingBottom: 48,
            display: "flex", flexDirection: "column", gap: 16,
          }}>
            {/* Product image */}
            <div style={{
              width: "100%", aspectRatio: "16/9",
              overflow: "hidden", marginBottom: 8,
              background: "rgba(255,255,255,0.04)",
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.image}
                alt={p.name}
                style={{
                  width: "100%", height: "100%",
                  objectFit: "cover",
                  display: "block",
                  filter: "brightness(0.88) contrast(1.05)",
                }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <p style={{
                margin: 0, fontFamily: "var(--font-heading)",
                fontSize: "clamp(22px,5vw,38px)", fontWeight: 300,
                color: "#FBF3D4", letterSpacing: "0.01em", lineHeight: 1.2,
                maxWidth: "65%",
              }}>{p.name}</p>
              <p style={{
                margin: 0, fontFamily: "var(--font-heading)",
                fontSize: "clamp(28px,6vw,44px)", fontWeight: 300,
                color: "#FBF3D4", letterSpacing: "0.02em",
              }}>₹{p.price}</p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {p.tags.map((tag, j) => (
                <span key={j} style={{
                  fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200,
                  letterSpacing: "0.4em", textTransform: "uppercase",
                  color: "rgba(251,243,212,0.5)",
                  border: "1px solid rgba(251,243,212,0.15)",
                  padding: "6px 14px",
                }}>{tag}</span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 32 }}>
              <p style={{
                margin: 0, fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: "rgba(251,243,212,0.45)",
              }}>{p.protein}</p>
              <p style={{
                margin: 0, fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: "rgba(251,243,212,0.45)",
              }}>{p.weight}</p>
            </div>
            <p style={{
              margin: 0, fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200,
              lineHeight: 1.8, color: "rgba(251,243,212,0.55)", maxWidth: 480,
            }}>{p.desc}</p>
            <button style={{
              alignSelf: "flex-start", marginTop: 8,
              background: "#024628", border: "none",
              padding: "12px 32px", cursor: "pointer",
              fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300,
              letterSpacing: "0.4em", textTransform: "uppercase",
              color: "#FBF3D4", WebkitTapHighlightColor: "transparent",
            }}>Add to Cart</button>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Nav ── */
export default function Nav() {
  const [active, setActive] = useState<Page>(null);

  useEffect(() => {
    const el = document.getElementById("main-page");
    if (!el) return;
    el.style.transition = "opacity 0.4s ease";
    el.style.opacity        = active ? "0" : "1";
    el.style.pointerEvents  = active ? "none" : "auto";
    // Pause Lenis so overlays can scroll independently
    if (active) getLenis()?.stop(); else getLenis()?.start();
  }, [active]);

  useEffect(() => {
    const handler = () => setActive("shop");
    window.addEventListener("openShop", handler);
    return () => window.removeEventListener("openShop", handler);
  }, []);

  // When overlay is open, intercept wheel events before Lenis sees them
  // and redirect them to the active overlay div
  useEffect(() => {
    if (!active) return;
    const wheelHandler = (e: WheelEvent) => {
      const overlay = document.querySelector<HTMLElement>(`[data-overlay="${active}"]`);
      if (!overlay) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      overlay.scrollTop += e.deltaY;
    };
    window.addEventListener("wheel", wheelHandler, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", wheelHandler, { capture: true });
  }, [active]);

  const close = () => setActive(null);

  return (
    <>
      <style>{`
        .nav-btn {
          background: none; border: none; cursor: pointer; padding: 0;
          font-family: var(--font-body); font-size: 12px; font-weight: 200;
          letter-spacing: 0.45em; text-transform: uppercase;
          color: rgba(251,243,212,0.5); transition: color 0.4s ease;
        }
        .nav-btn:hover { color: #4369B2; }
        .nav-btn.nav-active {
          color: #FBF3D4; font-weight: 300; cursor: default;
        }
        .nav-cadieux {
          background: none; border: none; padding: 0; display: block;
          font-family: var(--font-body); font-size: 9px; font-weight: 200;
          letter-spacing: 0.45em; text-transform: uppercase;
          color: rgba(251,243,212,0.22); transition: color 0.4s ease;
          margin-bottom: 10px; text-align: center;
        }
        .nav-cadieux.is-close { color: #4369B2; cursor: pointer; }
        .nav-cadieux.is-close:hover { color: #FBF3D4; }
        input::placeholder { color: rgba(67,105,178,0.5); }
      `}</style>

      {/* Back button — top left when subpage open */}
      {active && (
        <button
          onClick={close}
          style={{
            position: "fixed", top: 24, left: 28, zIndex: 101,
            background: "none", border: "none", cursor: "pointer", padding: 0,
            display: "flex", alignItems: "center", gap: 8,
            fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
            letterSpacing: "0.35em", textTransform: "uppercase",
            color: "#4369B2",
            pointerEvents: "auto",
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>←</span>
          <span>Cadieux</span>
        </button>
      )}

      {/* Fixed nav bar */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "20px 28px 0", pointerEvents: "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "clamp(24px,5vw,56px)" }}>
          {active ? (
            <span className="nav-btn nav-active">
              {LINKS.find(l => l.id === active)?.label}
            </span>
          ) : (
            LINKS.map(({ id, label }) => (
              <button
                key={id}
                className="nav-btn"
                onClick={() => setActive(id)}
                style={{ pointerEvents: "auto" }}
              >
                {label}
              </button>
            ))
          )}
        </div>
      </nav>

      {/* Sub-page overlays */}
      {(["blogs", "making", "store-locator", "shop"] as Page[]).map((id) => (
        <div
          key={id}
          data-overlay={id}
          style={{
            position: "fixed", inset: 0, zIndex: 99,
            background: "#1D1D1F",
            transform: active === id ? "translateY(0)" : "translateY(100vh)",
            transition: "transform 0.6s cubic-bezier(0.22,1,0.36,1)",
            pointerEvents: active === id ? "auto" : "none",
            overflowY: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch" as never,
          }}
        >
          {/* Grain overlay */}
          <div style={{
            position: "fixed", inset: 0, backgroundImage: GRAIN,
            opacity: 0.055, pointerEvents: "none", zIndex: 0,
          }} />
          <div style={{
            position: "relative", zIndex: 1,
            padding: "120px clamp(28px,8vw,120px) 80px",
          }}>
            {id === "blogs"          && <BlogsContent />}
            {id === "making"         && <MakingContent />}
            {id === "store-locator"  && <StoreContent />}
            {id === "shop"           && <ShopContent />}
          </div>
        </div>
      ))}
    </>
  );
}
