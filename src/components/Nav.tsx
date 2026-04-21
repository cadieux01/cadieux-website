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

const BLOG_POSTS = [
  {
    title: "Why Protein Bread Is the Future of Everyday Eating",
    brief: "Most people don't realise their bread is working against them. White bread spikes blood sugar, provides almost no protein, and leaves you hungry within hours. The future isn't eating less — it's eating smarter. Protein bread delivers what your body actually needs: sustained energy, muscle support, and real fullness. Cadieux is built on this idea. Every loaf is engineered to fuel your day without asking you to change your habits.",
    body: `Most people grab bread without a second thought. It's familiar, convenient, and cheap. But the loaf sitting on most kitchen counters is doing very little for the person eating it.

Standard white bread is mostly refined carbohydrates — stripped of fibre, protein, and nutrients during processing. It digests fast, spikes blood sugar, and leaves you hungry again within two hours. Over time, that cycle wears on your energy, your focus, and your body composition.

Protein bread changes that equation entirely.

When you replace empty carbohydrates with high-quality protein sources — whey, oat protein, seeds, and ancient grains — the same slice of bread becomes something functional. It slows digestion, feeds muscle tissue, supports your immune system, and keeps hunger at bay far longer.

The shift doesn't require a new diet plan or a lifestyle overhaul. It just requires better bread.

Cadieux was created for exactly this reason. We believe the most powerful health decisions are the quiet ones — the ones you make without thinking about it. Choosing Cadieux over ordinary bread is one of those decisions. Same routine. Better result. Every single day.`,
  },
  {
    title: "The Ancient Grains We Swear By",
    brief: "Long before modern wheat dominated our plates, humanity thrived on a diverse range of grains — each with its own nutritional fingerprint. Rye, oats, linseed, and sunflower seeds have been feeding people for thousands of years. Cadieux brings them back together, slow-fermented and cold-proofed, to create bread that carries the intelligence of centuries in every slice.",
    body: `For most of human history, bread was made from whatever grains grew nearby — rye in northern Europe, spelt in the Mediterranean, millet across Africa and Asia. These grains weren't just calories. They were dense in fibre, minerals, and slow-digesting carbohydrates that kept communities strong through long winters and hard labour.

Then came industrial agriculture. The focus shifted to yield and shelf life. Ancient grains were replaced by high-output wheat varieties, and the nutritional depth was lost in the process.

At Cadieux, we've gone back.

Rye sourdough ferment forms the base of every loaf. Rye has a lower glycaemic index than wheat, promotes better gut health, and carries a depth of flavour that modern bread simply can't replicate. The fermentation process — slow, cold, and carefully timed — breaks down phytic acid and makes nutrients more bioavailable.

Linseeds bring omega-3 fatty acids that support heart health and brain function. Oat bran lowers LDL cholesterol and feeds beneficial gut bacteria. Sunflower seeds add vitamin E and healthy fats that protect cells from oxidative stress.

These aren't ingredients we chose because they're trendy. They're ingredients that have proven themselves over thousands of years. We just brought them back together.`,
  },
  {
    title: "What Happens to Your Body When You Switch to Better Bread",
    brief: "The first week feels subtle. By week four, the difference is hard to ignore. Switching from refined bread to protein-rich, grain-dense bread changes how your body processes food, maintains energy, and builds tissue. Here's what the science says — and what our customers report feeling — when they make the swap.",
    body: `Week one is usually the most surprising.

People who switch to Cadieux from ordinary bread often notice they're not as hungry mid-morning. The slice they had at breakfast is still working — releasing energy slowly, keeping blood sugar stable, avoiding the sharp drop that normally sends them reaching for a snack by 10am.

By week two, something else tends to shift. Digestion improves. The combination of oat bran, rye ferment, and linseeds feeds the gut microbiome in ways that refined bread simply doesn't. Bloating decreases. Regularity improves. The gut is getting what it needs.

Weeks three and four bring the changes that matter most to anyone who trains or stays active. With 7.2g of protein per slice, Cadieux provides meaningful muscle support with every meal. Amino acids from whey and oat protein are available after a workout, supporting recovery without requiring a separate shake or supplement.

The cumulative effect of better bread isn't dramatic. It isn't a transformation story. It's quieter than that — more energy in the afternoon, less hunger between meals, a body that's being consistently nourished rather than just filled.

That's what switching to better bread feels like. Not a revolution. Just a better baseline, every single day.`,
  },
];

/* ── Sub-page content ── */
function BlogsContent() {
  const [open, setOpen] = useState<number | null>(null);

  if (open !== null) {
    const post = BLOG_POSTS[open];
    return (
      <>
        <button
          onClick={() => setOpen(null)}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            display: "flex", alignItems: "center", gap: 8, marginBottom: 48,
            fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
            letterSpacing: "0.35em", textTransform: "uppercase",
            color: "#4369B2", WebkitTapHighlightColor: "transparent",
          }}
        >
          <span style={{ fontSize: 14 }}>←</span> All Stories
        </button>
        <h1 style={{
          margin: "0 0 40px", fontFamily: "var(--font-heading)",
          fontSize: "clamp(28px,7vw,56px)", fontWeight: 300,
          color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1.15,
        }}>{post.title}</h1>
        <div style={{ maxWidth: 600 }}>
          {post.body.split("\n\n").map((para, i) => (
            <p key={i} style={{
              margin: "0 0 28px", fontFamily: "var(--font-body)",
              fontSize: 13, fontWeight: 200, lineHeight: 1.9,
              color: "rgba(251,243,212,0.7)",
            }}>{para}</p>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <h1 style={{
        margin: "0 0 64px", fontFamily: "var(--font-heading)",
        fontSize: "clamp(52px,12vw,96px)", fontWeight: 300,
        color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1,
      }}>Stories &amp; Bakes</h1>
      {BLOG_POSTS.map((post, i) => (
        <div
          key={i}
          onClick={() => setOpen(i)}
          style={{
            borderTop: "1px solid rgba(240,223,200,0.08)", paddingTop: 28, marginBottom: 36,
            cursor: "pointer",
          }}
        >
          <p style={{
            margin: "0 0 12px", fontFamily: "var(--font-heading)",
            fontSize: "clamp(20px,4vw,32px)", fontWeight: 300,
            color: "rgba(251,243,212,0.85)", letterSpacing: "0.01em", lineHeight: 1.2,
          }}>{post.title}</p>
          <p style={{
            margin: "0 0 14px", fontFamily: "var(--font-body)",
            fontSize: 12, fontWeight: 200, lineHeight: 1.8,
            color: "rgba(251,243,212,0.45)",
            display: "-webkit-box", WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical" as never, overflow: "hidden",
          }}>{post.brief}</p>
          <span style={{
            fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200,
            letterSpacing: "0.4em", textTransform: "uppercase",
            color: "#4369B2",
          }}>Read more →</span>
        </div>
      ))}
    </>
  );
}

const PROCESS_STEPS = [
  {
    num: "01",
    tag: "Mixing",
    tagColor: "#d0d8ff",
    title: "Spiral Blend",
    highlight: "4 min slow · 15–18 min fast",
    desc: "Every ingredient is placed in the bowl before the first rotation begins. We use a hook attachment and build structure in two stages — low speed to bind, high speed to develop the gluten network fully.",
  },
  {
    num: "02",
    tag: "Dough Temp",
    tagColor: "#f5e6c8",
    title: "Temperature Control",
    highlight: "24°C – 26°C",
    desc: "Dough temperature is checked before and after every mix. Staying within this window ensures the fermentation that follows runs at the right pace — not too fast, never sluggish.",
  },
  {
    num: "03",
    tag: "Fermentation",
    tagColor: "#c8e6d0",
    title: "Bulk Rest",
    highlight: "~15 minutes",
    desc: "After mixing, the dough is left undisturbed at room temperature. This short bulk ferment allows the gluten to relax and the cultures to begin their work quietly.",
  },
  {
    num: "04",
    tag: "Scale",
    tagColor: "#d0d8ff",
    title: "Precise Portioning",
    highlight: "500 – 600 g per loaf",
    desc: "Each portion is weighed and placed into moulds. Consistency here means consistency in crust, crumb, and protein distribution — every loaf performs the same way.",
  },
  {
    num: "05",
    tag: "Proofing",
    tagColor: "#c8e6d0",
    title: "Final Proof",
    highlight: "50–60 min · 32°C / 75% RH",
    desc: "Loaves proof in a controlled environment — warm, humid, and uninterrupted. This final rise develops the open crumb and the flavour complexity that distinguishes slow bread from fast bread.",
  },
  {
    num: "06",
    tag: "Bake",
    tagColor: "#f5d0d0",
    title: "Falling Temperature Bake",
    highlight: "230°C → 210°C over 50–60 min",
    desc: "We start hot to set the crust, then reduce by 20°C every ten minutes. The gradual fall drives moisture out slowly, locking in structure without sacrificing the tender interior.",
  },
];

function MakingContent() {
  return (
    <>
      <h1 style={{
        margin: "0 0 16px", fontFamily: "var(--font-heading)",
        fontSize: "clamp(52px,12vw,96px)", fontWeight: 300,
        color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1,
      }}>How It&apos;s Made</h1>
      <p style={{
        margin: "0 0 56px", fontFamily: "var(--font-body)", fontSize: 11,
        fontWeight: 200, letterSpacing: "0.25em", textTransform: "uppercase",
        color: "#4369B2", lineHeight: 2.2,
      }}>Six steps. No shortcuts.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {PROCESS_STEPS.map((step, i) => (
          <div key={i} style={{
            borderTop: "1px solid rgba(240,223,200,0.08)",
            paddingTop: 32, paddingBottom: 40,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <span style={{
                fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
                letterSpacing: "0.3em", color: "rgba(251,243,212,0.3)",
              }}>{step.num}</span>
              <span style={{
                fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 400,
                letterSpacing: "0.2em", textTransform: "uppercase",
                color: "rgba(30,30,30,0.85)", background: step.tagColor,
                padding: "3px 10px", borderRadius: 20,
              }}>{step.tag}</span>
            </div>
            <p style={{
              margin: "0 0 8px", fontFamily: "var(--font-heading)",
              fontSize: "clamp(22px,5vw,38px)", fontWeight: 300,
              color: "#FBF3D4", letterSpacing: "0.01em", lineHeight: 1.1,
            }}>{step.title}</p>
            <p style={{
              margin: "0 0 16px", fontFamily: "var(--font-body)",
              fontSize: 13, fontWeight: 300, letterSpacing: "0.05em",
              color: "#4369B2",
            }}>{step.highlight}</p>
            <p style={{
              margin: 0, fontFamily: "var(--font-body)",
              fontSize: 12, fontWeight: 200, lineHeight: 1.85,
              color: "rgba(251,243,212,0.45)", maxWidth: 520,
            }}>{step.desc}</p>
          </div>
        ))}
      </div>
    </>
  );
}

const VIZAG_AREAS = [
  "Bheemunipatnam",
  "Chinna Waltair",
  "Dwaraka Nagar",
  "Gajuwaka",
  "Kommadi",
  "Madhurawada",
  "MVP Colony",
  "Pendurthi",
  "Rushikonda",
  "Seethammadhara",
  "Waltair Uplands",
];

const STORES: Record<string, { name: string; address: string }[]> = {
  Madhurawada: [
    { name: "Madhu Super Market", address: "Madhurawada, Visakhapatnam — Cadieux Stockist" },
  ],
  "MVP Colony": [
    { name: "Sunny's Mart", address: "MVP Colony, Visakhapatnam — Cadieux Stockist" },
  ],
  "Chinna Waltair": [
    { name: "Robin's Nutri Store", address: "Chinna Waltair, Visakhapatnam — Cadieux Stockist" },
  ],
};

function StoreContent() {
  const [selected, setSelected] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = VIZAG_AREAS.filter(a =>
    a.toLowerCase().includes(query.toLowerCase())
  );
  const results = selected ? (STORES[selected] ?? []) : null;

  function pick(area: string) {
    setSelected(area);
    setQuery(area);
    setOpen(false);
  }

  return (
    <>
      <h1 style={{
        margin: "0 0 48px", fontFamily: "var(--font-heading)",
        fontSize: "clamp(52px,12vw,96px)", fontWeight: 300,
        color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1,
      }}>Find Cadieux</h1>
      <div style={{ maxWidth: 440 }}>
        <p style={{
          margin: "0 0 16px",
          fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200,
          letterSpacing: "0.3em", textTransform: "uppercase",
          color: "rgba(251,243,212,0.5)",
        }}>Select your area in Vizag</p>

        {/* Search bar */}
        <div style={{ position: "relative" }}>
          <div style={{
            display: "flex", alignItems: "center",
            border: "1px solid rgba(251,243,212,0.2)",
            borderBottom: open ? "1px solid rgba(251,243,212,0.08)" : "1px solid rgba(251,243,212,0.2)",
            background: "rgba(251,243,212,0.04)",
            padding: "14px 16px",
            cursor: "text",
          }}
            onClick={() => setOpen(true)}
          >
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setSelected(""); setOpen(true); }}
              onFocus={() => { setQuery(""); setOpen(true); }}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder="Type or select an area…"
              style={{
                flex: 1, background: "none", border: "none", outline: "none",
                fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: "#FBF3D4",
              }}
            />
            {/* Arrow icon */}
            <span
              onClick={e => {
                e.stopPropagation();
                if (open) {
                  setOpen(false);
                } else {
                  setQuery(""); // always clear so all areas show on re-open
                  setOpen(true);
                }
              }}
              style={{
                cursor: "pointer", userSelect: "none",
                color: "rgba(251,243,212,0.4)", fontSize: 14,
                transform: open ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
                display: "inline-block", lineHeight: 1,
              }}
            >▾</span>
          </div>

          {/* Dropdown list — 7 items visible, scrollable */}
          {open && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
              background: "#1a1a1c",
              border: "1px solid rgba(251,243,212,0.12)",
              borderTop: "none",
              maxHeight: "calc(7 * 48px)",
              overflowY: "auto",
              overscrollBehavior: "contain",
            }}>
              {filtered.length === 0 ? (
                <div style={{
                  padding: "14px 16px",
                  fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200,
                  letterSpacing: "0.3em", textTransform: "uppercase",
                  color: "rgba(251,243,212,0.3)",
                }}>No areas found</div>
              ) : filtered.map(area => (
                <button
                  key={area}
                  onMouseDown={e => { e.preventDefault(); pick(area); }}
                  style={{
                    display: "block", width: "100%", background: "none",
                    border: "none", borderBottom: "1px solid rgba(251,243,212,0.06)",
                    padding: "14px 16px", cursor: "pointer", textAlign: "left",
                    fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200,
                    letterSpacing: "0.3em", textTransform: "uppercase",
                    color: selected === area ? "#FBF3D4" : "rgba(251,243,212,0.55)",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >{area}</button>
              ))}
            </div>
          )}
        </div>

        {/* Result — shown only after selection */}
        {selected && results !== null && (
          <div style={{ marginTop: 40 }}>
            {results.length === 0 ? (
              <p style={{
                margin: 0, fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200,
                letterSpacing: "0.3em", textTransform: "uppercase",
                color: "rgba(251,243,212,0.35)",
              }}>No stores found in {selected} yet.</p>
            ) : results.map((s, i) => (
              <div key={i} style={{
                borderTop: "1px solid rgba(251,243,212,0.1)",
                paddingTop: 20,
              }}>
                <p style={{
                  margin: "0 0 8px", fontFamily: "var(--font-heading)",
                  fontSize: "clamp(22px,5vw,32px)", fontWeight: 300,
                  color: "#FBF3D4", letterSpacing: "0.01em",
                }}>{s.name}</p>
                <p style={{
                  margin: 0, fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
                  letterSpacing: "0.25em", textTransform: "uppercase",
                  color: "rgba(251,243,212,0.4)",
                }}>{s.address}</p>
              </div>
            ))}
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

  // When overlay is open, intercept wheel/touch events before Lenis sees them
  useEffect(() => {
    if (!active) return;

    function findScrollable(start: HTMLElement | null, boundary: HTMLElement): HTMLElement | null {
      let el = start;
      while (el && el !== boundary) {
        if (el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflowY !== "visible") return el;
        el = el.parentElement;
      }
      return null;
    }

    const wheelHandler = (e: WheelEvent) => {
      const overlay = document.querySelector<HTMLElement>(`[data-overlay="${active}"]`);
      if (!overlay) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const scrollable = findScrollable(e.target as HTMLElement, overlay) ?? overlay;
      scrollable.scrollTop += e.deltaY;
    };

    let touchStartY = 0;
    const touchStart = (e: TouchEvent) => { touchStartY = e.touches[0].clientY; };
    const touchMove = (e: TouchEvent) => {
      const overlay = document.querySelector<HTMLElement>(`[data-overlay="${active}"]`);
      if (!overlay) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const deltaY = touchStartY - e.touches[0].clientY;
      touchStartY = e.touches[0].clientY;
      const scrollable = findScrollable(e.target as HTMLElement, overlay) ?? overlay;
      scrollable.scrollTop += deltaY;
    };

    window.addEventListener("wheel", wheelHandler, { passive: false, capture: true });
    window.addEventListener("touchstart", touchStart, { passive: true, capture: true });
    window.addEventListener("touchmove", touchMove, { passive: false, capture: true });
    return () => {
      window.removeEventListener("wheel", wheelHandler, { capture: true });
      window.removeEventListener("touchstart", touchStart, { capture: true });
      window.removeEventListener("touchmove", touchMove, { capture: true });
    };
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
