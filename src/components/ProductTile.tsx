"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef, useState } from "react";
import type { ProductMedia, ProductStat } from "@/lib/data";
import { useCart } from "@/context/CartContext";

const qtyBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 18,
  lineHeight: 1,
  fontWeight: 400,
  color: "#FBF3D4",
  background: "rgba(251,243,212,0.06)",
  border: "none",
  padding: "8px 12px",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};

type Props = {
  slug: string;
  productIndex: number;
  name: string;
  tag: string;
  title: string;
  subtitle: string;
  price: number;
  stats: ProductStat[];
  media: ProductMedia[];
  outOfStock?: boolean;
};

export default function ProductTile({ slug, productIndex, name, tag, title, subtitle, price, stats, media, outOfStock = false }: Props) {
  const [hover, setHover] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Per-tile add-to-cart. The stepper reflects the LIVE cart quantity for
  // this product (0 when it isn't in the cart), so the controls are exact:
  // "Add" goes 0 → 1, "+" increments, and "−" at 1 removes the line (1 → 0).
  // Lives inside the wrapping <Link>, so every control stops propagation +
  // preventDefault to avoid navigating to the PDP.
  const { cart, addToCart, updateQty, removeFromCart } = useCart();
  const cartIndex = cart.findIndex(
    (c) => c.productIndex === productIndex && c.orderType === "once"
  );
  const inCartQty = cartIndex >= 0 ? cart[cartIndex].qty : 0;

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleAdd = (e: React.MouseEvent) => {
    stop(e);
    if (outOfStock) return;
    addToCart({ productIndex, name, price, qty: 1, orderType: "once" });
  };

  const handleIncrease = (e: React.MouseEvent) => {
    stop(e);
    if (outOfStock || cartIndex < 0) return;
    updateQty(cartIndex, Math.min(99, inCartQty + 1));
  };

  const handleDecrease = (e: React.MouseEvent) => {
    stop(e);
    if (cartIndex < 0) return;
    if (inCartQty <= 1) removeFromCart(cartIndex);
    else updateQty(cartIndex, inCartQty - 1);
  };

  // Track pointer drag on the media so a horizontal swipe doesn't get interpreted
  // as a click on the wrapping <Link> (which would navigate mid-swipe).
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);

  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== activeIdx) setActiveIdx(idx);
  };

  const onMediaPointerDown = (e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
    draggedRef.current = false;
  };

  const onMediaPointerMove = (e: React.PointerEvent) => {
    const s = pointerStart.current;
    if (!s) return;
    if (Math.abs(e.clientX - s.x) > 6 || Math.abs(e.clientY - s.y) > 6) {
      draggedRef.current = true;
    }
  };

  const onMediaClickCapture = (e: React.MouseEvent) => {
    if (draggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <Link
      href={`/shop/${slug}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        background: "#0a0805",
        borderRadius: 14,
        border: `1px solid rgba(201, 169, 110, ${hover ? 0.45 : 0.18})`,
        overflow: "hidden",
        transform: hover ? "translateY(-4px)" : "translateY(0)",
        transition: "transform 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease",
        boxShadow: hover ? "0 18px 40px rgba(0,0,0,0.45)" : "0 8px 20px rgba(0,0,0,0.25)",
      }}
    >
      {/* Swipeable media gallery — pointer-drag is detected so a swipe doesn't
          fire the parent Link's click. */}
      <div
        className="tile-media"
        onPointerDown={onMediaPointerDown}
        onPointerMove={onMediaPointerMove}
        onClickCapture={onMediaClickCapture}
        style={{ position: "relative", width: "100%", background: "#1a1510" }}
      >
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="tile-scroller"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            overflowX: "auto",
            overflowY: "hidden",
            scrollSnapType: "x mandatory",
            scrollbarWidth: "none",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {media.map((m, i) => (
            <div
              key={i}
              style={{
                flex: "0 0 100%",
                width: "100%",
                height: "100%",
                scrollSnapAlign: "center",
                position: "relative",
                background: "#1a1510",
              }}
            >
              {m.type === "video" ? (
                <video
                  autoPlay
                  muted
                  loop
                  playsInline
                  poster={m.src.replace(/\.mp4$/, ".poster.jpg")}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    backgroundColor: "#1a1510",
                    display: "block",
                    pointerEvents: "none",
                  }}
                >
                  <source src={m.src.replace(/\.mp4$/, ".av1.mp4")} type='video/mp4; codecs="av01.0.05M.08"' />
                  <source src={m.src} type="video/mp4" />
                </video>
              ) : (
                <Image
                  src={m.src}
                  alt={m.alt || title}
                  fill
                  draggable={false}
                  sizes="(max-width: 768px) 100vw, 600px"
                  priority={i === 0}
                  style={{
                    objectFit: "cover",
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* gradient overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(10,8,5,0) 55%, rgba(10,8,5,0.65) 100%)",
            pointerEvents: "none",
          }}
        />

        {/* Test Reports badge */}
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            fontFamily: "var(--font-body)",
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#024628",
            padding: "5px 10px",
            background: "rgba(10,8,5,0.7)",
            border: "0.5px solid rgba(201,169,110,0.4)",
            borderRadius: 4,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            backdropFilter: "blur(4px)",
            pointerEvents: "none",
          }}
        >
          <span>Test Reports</span>
          <span aria-hidden="true" style={{ fontSize: 10, lineHeight: 1 }}>✓</span>
        </div>

        {/* Out-of-stock pill — only when the live products row has
            in_stock=false. The tile stays clickable so customers can
            still read the PDP. */}
        {outOfStock && (
          <div
            style={{
              position: "absolute",
              bottom: 12,
              right: 12,
              fontFamily: "var(--font-body)",
              fontSize: 9,
              fontWeight: 500,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: "#fecaca",
              padding: "5px 10px",
              background: "rgba(10,8,5,0.75)",
              border: "0.5px solid rgba(239,68,68,0.55)",
              borderRadius: 4,
              backdropFilter: "blur(4px)",
              pointerEvents: "none",
            }}
          >
            Out of stock
          </div>
        )}

        {/* "Swipe" hint — only when more than one media */}
        {media.length > 1 && activeIdx === 0 && (
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              fontFamily: "var(--font-body)",
              fontSize: 8,
              fontWeight: 500,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "rgba(245,240,232,0.7)",
              padding: "5px 10px",
              background: "rgba(10,8,5,0.55)",
              border: "0.5px solid rgba(245,240,232,0.2)",
              borderRadius: 4,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              backdropFilter: "blur(4px)",
              pointerEvents: "none",
            }}
          >
            Swipe <span aria-hidden="true">→</span>
          </div>
        )}

        {/* Dot indicators */}
        {media.length > 1 && (
          <div
            style={{
              position: "absolute",
              bottom: 10,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
              gap: 6,
              pointerEvents: "none",
            }}
          >
            {media.map((_, i) => (
              <span
                key={i}
                style={{
                  width: i === activeIdx ? 18 : 6,
                  height: 6,
                  borderRadius: 999,
                  background: i === activeIdx ? "#024628" : "rgba(245,240,232,0.45)",
                  transition: "all 0.25s ease",
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Info — whole card is the Link, so any tap on this area navigates too */}
      <div className="tile-body">
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "#024628",
            marginBottom: 8,
          }}
        >
          {tag}
        </div>
        <h3
          className="tile-title"
          style={{
            margin: 0,
            fontFamily: "var(--font-heading)",
            fontWeight: 400,
            color: "#f5f0e8",
            letterSpacing: "0.01em",
            lineHeight: 1.05,
          }}
        >
          {title}
        </h3>
        <p
          style={{
            margin: "10px 0 14px",
            fontFamily: "var(--font-body)",
            fontSize: 12,
            lineHeight: 1.5,
            fontWeight: 300,
            color: "rgba(245,240,232,0.55)",
          }}
        >
          {subtitle}
        </p>

        <div
          style={{
            display: "flex",
            gap: 14,
            paddingTop: 12,
            borderTop: "0.5px solid rgba(201,169,110,0.18)",
            marginBottom: 16,
          }}
        >
          {stats.map((s) => (
            <div key={s.label} style={{ flex: 1, textAlign: "left" }}>
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 20,
                  fontWeight: 500,
                  color: "#024628",
                  lineHeight: 1,
                }}
              >
                {s.blank ? "—" : <>{s.target}{s.suffix}</>}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: "var(--font-body)",
                  fontSize: 8,
                  fontWeight: 300,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "rgba(245,240,232,0.45)",
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 28,
              fontWeight: 500,
              color: "#f5f0e8",
              lineHeight: 1,
            }}
          >
            ₹{price}
          </div>

          {outOfStock ? (
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "rgba(245,240,232,0.45)",
              }}
            >
              Unavailable
            </span>
          ) : (
            inCartQty === 0 ? (
              /* Not in cart — single Add button takes it 0 → 1. */
              <button
                type="button"
                onClick={handleAdd}
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "#FBF3D4",
                  background: "#024628",
                  border: "1px solid #024628",
                  borderRadius: 8,
                  padding: "10px 16px",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                  whiteSpace: "nowrap",
                }}
              >
                Add
              </button>
            ) : (
              /* In cart — stepper reflects the live cart qty; − at 1 removes. */
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  border: "1px solid rgba(251,243,212,0.25)",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  aria-label={inCartQty <= 1 ? "Remove from cart" : "Decrease quantity"}
                  onClick={handleDecrease}
                  style={qtyBtnStyle}
                >
                  −
                </button>
                <span
                  aria-live="polite"
                  style={{
                    minWidth: 26,
                    textAlign: "center",
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#FBF3D4",
                  }}
                >
                  {inCartQty}
                </span>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  onClick={handleIncrease}
                  style={qtyBtnStyle}
                >
                  +
                </button>
              </div>
            )
          )}
        </div>
      </div>

      <style jsx>{`
        .tile-media {
          aspect-ratio: 16 / 11;
        }
        .tile-body {
          padding: 16px 16px 18px;
        }
        .tile-title {
          font-size: 22px;
        }
        .tile-scroller::-webkit-scrollbar {
          display: none;
        }
        @media (min-width: 640px) {
          .tile-media {
            aspect-ratio: 4 / 5;
          }
          .tile-body {
            padding: 18px 20px 20px;
          }
          .tile-title {
            font-size: 28px;
          }
        }
      `}</style>
    </Link>
  );
}
