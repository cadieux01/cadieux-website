"use client";

import { useEffect, useRef, useState } from "react";
import { useCart } from "@/context/CartContext";
import { flyToCart } from "@/lib/fly-to-cart";
import type { CartItem } from "@/lib/data";

const GRAIN =
  "url(/grain.svg)";

/** Ease-out cubic count-up from 0 to `target` over `duration` ms (after optional delay). */
function useCountUp(target: number, duration = 800, delay = 0) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start: number | null = null;
    const timeout = window.setTimeout(() => {
      const tick = (t: number) => {
        if (start === null) start = t;
        const p = Math.min((t - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setValue(Math.round(target * eased));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      window.clearTimeout(timeout);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [target, duration, delay]);
  return value;
}

export type ProductCardStat = { target: number; suffix?: string; label: string; blank?: boolean };

export type ProductCardProps = {
  productIndex: number;
  name: string;
  tag: string;
  title: string;
  subtitle: string;
  price: number;
  stats: [ProductCardStat, ProductCardStat, ProductCardStat];
};

export default function ProductCard({
  productIndex,
  name,
  tag,
  title,
  subtitle,
  price,
  stats,
}: ProductCardProps) {
  const { addToCart } = useCart();
  const cardRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);

  const s0 = useCountUp(stats[0].target);
  const s1 = useCountUp(stats[1].target);
  const s2 = useCountUp(stats[2].target);
  const statValues = [s0, s1, s2];

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    setTilt({ x: -dy / 20, y: dx / 20 });
  }

  function handleLeave() {
    setTilt({ x: 0, y: 0 });
    setHovered(false);
  }

  function handleAdd() {
    const item: CartItem = {
      productIndex,
      name,
      price,
      qty: 1,
      orderType: "once",
    };
    addToCart(item);
    // Fire the fly-to-cart from the button itself so the trail starts
    // exactly where the user tapped. The floating cart picks up the
    // landing event and pulses.
    flyToCart(addBtnRef.current);
  }

  const seeds = [
    { l: 22, t: 18 },
    { l: 45, t: 10 },
    { l: 65, t: 20 },
    { l: 88, t: 12 },
    { l: 108, t: 22 },
  ];

  const particles = [
    { l: "12%", t: "22%", d: "0s", dx: "6px", dy: "-10px" },
    { l: "82%", t: "40%", d: "0.6s", dx: "-8px", dy: "-6px" },
    { l: "24%", t: "76%", d: "1.2s", dx: "10px", dy: "-12px" },
    { l: "78%", t: "82%", d: "1.8s", dx: "-6px", dy: "-8px" },
  ];

  return (
    <div style={{ perspective: 1200, width: "min(320px, 85vw)", flexShrink: 0, scrollSnapAlign: "center" }}>
      <style>{`
        @keyframes pc-slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pc-float {
          0%,100% { transform: translateY(0); }
          50%     { transform: translateY(-6px); }
        }
        @keyframes pc-seedPop {
          from { transform: scale(0); }
          to   { transform: scale(1); }
        }
        @keyframes pc-particle {
          0%,100% { transform: translate(0,0); opacity: 0.35; }
          50%     { transform: translate(var(--pc-dx,0), var(--pc-dy,-8px)); opacity: 0.85; }
        }
        @keyframes pc-shine {
          from { transform: translateX(-100%); }
          to   { transform: translateX(220%); }
        }
      `}</style>

      <div
        ref={cardRef}
        onMouseMove={handleMove}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={handleLeave}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 360,
          background: "#024628",
          border: "0.5px solid rgba(201,169,110,0.25)",
          borderRadius: 16,
          overflow: "hidden",
          transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
          transition: "transform 0.15s ease-out",
          transformStyle: "preserve-3d",
          boxShadow: "0 30px 60px rgba(0,0,0,0.45)",
        }}
      >
        {/* Grain overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: GRAIN,
            opacity: 0.03,
            pointerEvents: "none",
            zIndex: 6,
            mixBlendMode: "overlay",
          }}
        />

        {/* ───────────── IMAGE SECTION ───────────── */}
        <div
          style={{
            position: "relative",
            height: 220,
            overflow: "hidden",
            background: "linear-gradient(145deg, #1a1508, #0d0b06)",
          }}
        >
          {/* Test Reports badge */}
          <div
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              zIndex: 4,
              fontFamily: "var(--font-body)",
              fontSize: 9,
              fontWeight: 500,
              letterSpacing: "2px",
              textTransform: "uppercase",
              color: "#024628",
              padding: "5px 10px",
              background: "rgba(201,169,110,0.08)",
              border: "0.5px solid rgba(201,169,110,0.35)",
              borderRadius: 4,
              opacity: 0,
              animation: "pc-slideUp 0.6s ease 0.3s forwards",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>Test Reports</span>
            <span aria-hidden="true" style={{ fontSize: 10, lineHeight: 1 }}>✓</span>
          </div>

          {/* Floating particles */}
          {particles.map((p, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: p.l,
                top: p.t,
                width: 2,
                height: 2,
                borderRadius: "50%",
                background: "#024628",
                opacity: 0.5,
                animation: `pc-particle 3.6s ease-in-out ${p.d} infinite`,
                ["--pc-dx" as string]: p.dx,
                ["--pc-dy" as string]: p.dy,
                zIndex: 2,
              }}
            />
          ))}

          {/* Shine sweep on hover */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 3,
              pointerEvents: "none",
              overflow: "hidden",
            }}
          >
            <div
              key={hovered ? "on" : "off"}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: "55%",
                background:
                  "linear-gradient(105deg, transparent 40%, rgba(201,169,110,0.08) 50%, transparent 60%)",
                animation: hovered ? "pc-shine 1.1s ease forwards" : "none",
                transform: "translateX(-100%)",
              }}
            />
          </div>

          {/* Bread illustration */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: `translate(-50%, -50%) translateY(${hovered ? "-8px" : "0"}) scale(${hovered ? 1.05 : 1})`,
              transition: "transform 0.4s ease",
              zIndex: 1,
            }}
          >
            <div
              style={{
                position: "relative",
                width: 140,
                height: 100,
                animation: "pc-float 4s ease-in-out infinite",
              }}
            >
              {/* Bread body */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  bottom: 0,
                  width: 140,
                  height: 80,
                  background: "linear-gradient(165deg, #024628, #8b6d3a)",
                  borderRadius: "50% 50% 8px 8px / 60% 60% 15% 15%",
                  boxShadow:
                    "inset 0 -10px 20px rgba(0,0,0,0.3), 0 10px 24px rgba(0,0,0,0.5)",
                }}
              />
              {/* Bread top (lighter ellipse) */}
              <div
                style={{
                  position: "absolute",
                  left: 5,
                  top: 20,
                  width: 130,
                  height: 45,
                  background: "linear-gradient(160deg, #d4b87a, #024628)",
                  borderRadius: "50%",
                  boxShadow: "inset 0 -4px 10px rgba(0,0,0,0.15)",
                }}
              >
                {seeds.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: s.l,
                      top: s.t,
                      width: 3,
                      height: 3,
                      borderRadius: "50%",
                      background: "#3a2a15",
                      transform: "scale(0)",
                      animation: `pc-seedPop 0.4s ease-out ${0.8 + i * 0.1}s forwards`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ───────────── CONTENT SECTION ───────────── */}
        <div style={{ position: "relative", padding: "20px 24px 24px", zIndex: 4 }}>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 10,
              fontWeight: 400,
              letterSpacing: "3px",
              textTransform: "uppercase",
              color: "#8a7a5a",
              marginBottom: 10,
              opacity: 0,
              animation: "pc-slideUp 0.6s ease 0.2s forwards",
            }}
          >
            {tag}
          </div>

          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 24,
              fontWeight: 400,
              color: "#f5f0e8",
              lineHeight: 1.2,
              marginBottom: 8,
              opacity: 0,
              animation: "pc-slideUp 0.6s ease 0.3s forwards",
            }}
          >
            {title}
          </div>

          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 12,
              fontWeight: 300,
              color: "#7a7060",
              lineHeight: 1.55,
              marginBottom: 22,
              opacity: 0,
              animation: "pc-slideUp 0.6s ease 0.4s forwards",
            }}
          >
            {subtitle}
          </div>

          {/* Stats */}
          <div
            style={{
              display: "flex",
              padding: "16px 0",
              marginBottom: 22,
              borderTop: "0.5px solid rgba(201,169,110,0.14)",
              borderBottom: "0.5px solid rgba(201,169,110,0.14)",
              opacity: 0,
              animation: "pc-slideUp 0.6s ease 0.5s forwards",
            }}
          >
            {stats.map((s, i) => ({
              v: s.blank ? "—" : `${statValues[i]}${s.suffix ?? ""}`,
              l: s.label,
            })).map((s, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  textAlign: "center",
                  borderLeft: i > 0 ? "0.5px solid rgba(201,169,110,0.14)" : "none",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 20,
                    fontWeight: 500,
                    color: "#024628",
                    lineHeight: 1,
                  }}
                >
                  {s.v}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 9,
                    letterSpacing: "1.5px",
                    textTransform: "uppercase",
                    color: "#5a5040",
                    marginTop: 6,
                  }}
                >
                  {s.l}
                </div>
              </div>
            ))}
          </div>

          {/* Price row */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              opacity: 0,
              animation: "pc-slideUp 0.6s ease 0.6s forwards",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 28,
                fontWeight: 400,
                color: "#f5f0e8",
                lineHeight: 1,
              }}
            >
              <span style={{ fontSize: 18, color: "#8a7a5a", marginRight: 2 }}>₹</span>
              {price}
            </div>

            <button
              ref={addBtnRef}
              onClick={handleAdd}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(201,169,110,0.1)";
                e.currentTarget.style.borderColor = "rgba(201,169,110,0.8)";
                e.currentTarget.style.transform = "scale(1.02)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "rgba(201,169,110,0.5)";
                e.currentTarget.style.transform = "scale(1)";
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = "scale(0.98)";
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = "scale(1.02)";
              }}
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 11,
                fontWeight: 400,
                letterSpacing: "2px",
                textTransform: "uppercase",
                color: "#024628",
                background: "transparent",
                border: "0.5px solid rgba(201,169,110,0.5)",
                padding: "10px 18px",
                borderRadius: 6,
                cursor: "pointer",
                transition:
                  "background 0.2s, border-color 0.2s, transform 0.1s",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Add to Cart
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
