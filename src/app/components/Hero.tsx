"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import SplitText from "@/components/SplitTextLazy";
import IngredientCard from "@/components/IngredientCard";

interface HeroProps {
  animate: boolean;
}

const HERO_INGREDIENTS = [
  {
    name: "Atta",
    descriptor: "Stone-milled whole wheat",
    side: "left",
    top: "22%",
    left: "4%",
    right: undefined,
    rotation: -6,
    color: "#c9922e",
    benefits: [
      { icon: "◈", title: "Complete Nutrition", detail: "Whole wheat atta retains the bran and germ — delivering B vitamins, iron, and magnesium stripped out in refined flour." },
      { icon: "◈", title: "Sustained Energy", detail: "Complex carbohydrates release glucose slowly into the bloodstream, keeping you fuelled for hours without the crash." },
      { icon: "◈", title: "Digestive Health", detail: "Natural insoluble fibre from the wheat bran feeds good gut bacteria and supports regular, healthy digestion." },
    ],
  },
  {
    name: "Wheat Bran",
    descriptor: "High-fibre outer layer",
    side: "left",
    top: "44%",
    left: "2%",
    right: undefined,
    rotation: 4,
    color: "#b8832a",
    benefits: [
      { icon: "◈", title: "Highest Fibre Density", detail: "Wheat bran contains more dietary fibre per gram than almost any other food — one slice meaningfully contributes to your daily fibre target." },
      { icon: "◈", title: "Gut Microbiome Support", detail: "Prebiotic fibres in wheat bran selectively feed beneficial gut bacteria, improving the microbial diversity linked to immunity and mood." },
      { icon: "◈", title: "Cholesterol Management", detail: "Regular wheat bran consumption is clinically associated with reduced LDL cholesterol levels and improved cardiovascular markers." },
    ],
  },
  {
    name: "Yeast",
    descriptor: "Slow cold fermentation",
    side: "left",
    top: "66%",
    left: "6%",
    right: undefined,
    rotation: -3,
    color: "#a07828",
    benefits: [
      { icon: "◈", title: "Natural Leavening", detail: "Live yeast fermentation produces CO₂ that gives the bread its open crumb structure — no artificial raising agents, no shortcuts." },
      { icon: "◈", title: "Improved Digestibility", detail: "Slow fermentation partially breaks down gluten and phytic acid, making nutrients more bioavailable and the bread easier on the gut." },
      { icon: "◈", title: "Rich Flavour Development", detail: "24-hour cold fermentation develops organic acids and esters that create depth of flavour impossible to replicate with fast-rise methods." },
    ],
  },
  {
    name: "Wheat Gluten",
    descriptor: "Natural protein boost",
    side: "right",
    top: "20%",
    left: undefined,
    right: "4%",
    rotation: 5,
    color: "#c9922e",
    benefits: [
      { icon: "◈", title: "Elevated Protein Content", detail: "Vital wheat gluten is pure plant protein — it directly raises the protein per slice to levels that support muscle repair and recovery." },
      { icon: "◈", title: "Superior Texture", detail: "Gluten creates the elastic network that traps gas during fermentation — producing a chewy, structured crumb that holds together under load." },
      { icon: "◈", title: "Satiety & Appetite Control", detail: "High protein content increases satiety hormones and reduces hunger — helping you stay fuller for longer between meals." },
    ],
  },
  {
    name: "Protein Blend",
    descriptor: "Soya · Pea · Rice · WPC",
    side: "right",
    top: "43%",
    left: undefined,
    right: "2%",
    rotation: -4,
    color: "#b8832a",
    benefits: [
      { icon: "◈", title: "Complete Amino Acid Profile", detail: "The combination of soya, pea, rice protein, and WPC covers all 9 essential amino acids — a complete protein profile rare in bread." },
      { icon: "◈", title: "Muscle Synthesis Support", detail: "WPC (whey protein concentrate) delivers leucine-rich protein that directly triggers muscle protein synthesis post-workout." },
      { icon: "◈", title: "Multi-Source Absorption", detail: "Different protein sources digest at different rates — fast (whey), medium (soya), slow (pea/rice) — sustaining amino acid delivery over hours." },
    ],
  },
  {
    name: "Caramel",
    descriptor: "Natural depth of flavour",
    side: "right",
    top: "65%",
    left: undefined,
    right: "5%",
    rotation: 3,
    color: "#a07828",
    benefits: [
      { icon: "◈", title: "Natural Colouring", detail: "Caramel gives the crust its deep amber tone naturally — no artificial colourants, no synthetic dyes. What you see is what it is." },
      { icon: "◈", title: "Maillard Enhancement", detail: "Caramel accelerates Maillard browning on the crust, creating the complex roasted notes that make artisan bread smell and taste premium." },
      { icon: "◈", title: "Trace Mineral Content", detail: "Natural caramel retains small amounts of potassium and calcium from the base sugar — a minor but genuine nutritional contribution." },
    ],
  },
];

export default function Hero({ animate }: HeroProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const preLabelRef = useRef<HTMLDivElement>(null);
  const line1Ref = useRef<HTMLDivElement>(null);
  const line2Ref = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const subLineRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const scrollIndicatorRef = useRef<HTMLDivElement>(null);
  const scrollLineRef = useRef<HTMLDivElement>(null);
  const ingredientRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hasAnimated = useRef(false);
  const hasPulsed = useRef(false);

  // Active ingredient card state
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activeRect, setActiveRect] = useState<DOMRect | null>(null);

  const activeIngredient = activeIndex !== null ? HERO_INGREDIENTS[activeIndex] : null;

  const handleIngredientClick = useCallback((index: number) => {
    if (activeIndex === index) {
      setActiveIndex(null);
      setActiveRect(null);
    } else {
      const el = ingredientRefs.current[index];
      if (el) {
        setActiveRect(el.getBoundingClientRect());
      }
      setActiveIndex(index);
    }
  }, [activeIndex]);

  const handleCardClose = useCallback(() => {
    setActiveIndex(null);
    setActiveRect(null);
  }, []);

  // Active ingredient glow effect
  useEffect(() => {
    ingredientRefs.current.forEach((el, i) => {
      if (!el) return;
      const nameEl = el.querySelector(".hi-name") as HTMLElement;
      if (i === activeIndex) {
        gsap.to(el, { scale: 1.05, filter: "drop-shadow(0 0 12px rgba(201,146,46,0.35))", duration: 0.35, ease: "power2.out", overwrite: "auto" });
        if (nameEl) gsap.to(nameEl, { color: HERO_INGREDIENTS[i].color, duration: 0.35 });
      } else if (activeIndex !== null) {
        // Not active, reset
        gsap.to(el, { scale: 1, filter: "drop-shadow(0 0 0px rgba(201,146,46,0))", duration: 0.4, ease: "power2.out", overwrite: "auto" });
        if (nameEl) gsap.to(nameEl, { color: "#fbf3d4", duration: 0.4 });
      }
    });
  }, [activeIndex]);

  // Magnetic drift effect
  useEffect(() => {
    const isTouchDevice = window.matchMedia("(hover: none)").matches;
    if (isTouchDevice) return;

    const container = containerRef.current;
    if (!container) return;

    const handleMouseMove = (e: MouseEvent) => {
      const containerRect = container.getBoundingClientRect();
      const cursorX = e.clientX - containerRect.left;
      const cursorY = e.clientY - containerRect.top;

      ingredientRefs.current.forEach((el, i) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const elCenterX = rect.left + rect.width / 2 - containerRect.left;
        const elCenterY = rect.top + rect.height / 2 - containerRect.top;
        const dx = cursorX - elCenterX;
        const dy = cursorY - elCenterY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 220) {
          gsap.to(el, { x: dx * 0.08, y: dy * 0.08, duration: 0.6, ease: "power2.out", overwrite: "auto" });
          const lineEl = lineRefs.current[i];
          if (lineEl) {
            const stretch = 1 + (1 - distance / 220) * 0.6;
            gsap.to(lineEl, { scaleX: stretch, duration: 0.4, ease: "power2.out", overwrite: "auto" });
          }
        } else {
          gsap.to(el, { x: 0, y: 0, duration: 0.8, ease: "power2.out", overwrite: "auto" });
          const lineEl = lineRefs.current[i];
          if (lineEl) {
            gsap.to(lineEl, { scaleX: 1, duration: 0.6, ease: "power2.out", overwrite: "auto" });
          }
        }
      });

      const centerEls = [
        { ref: preLabelRef.current, strength: 0.04, radius: 200 },
        { ref: line1Ref.current, strength: 0.06, radius: 250 },
        { ref: line2Ref.current, strength: 0.06, radius: 250 },
        { ref: subLineRef.current, strength: 0.03, radius: 180 },
        { ref: ctaRef.current, strength: 0.05, radius: 180 },
      ];
      centerEls.forEach(({ ref, strength, radius }) => {
        if (!ref) return;
        const rect = ref.getBoundingClientRect();
        const cx = rect.left + rect.width / 2 - containerRect.left;
        const cy = rect.top + rect.height / 2 - containerRect.top;
        const dx = cursorX - cx;
        const dy = cursorY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < radius) {
          gsap.to(ref, { x: dx * strength, y: dy * strength, duration: 0.5, ease: "power2.out", overwrite: "auto" });
        } else {
          gsap.to(ref, { x: 0, y: 0, duration: 0.7, ease: "power2.out", overwrite: "auto" });
        }
      });

      if (dividerRef.current) {
        const divRect = dividerRef.current.getBoundingClientRect();
        const divCenterX = divRect.left + divRect.width / 2 - containerRect.left;
        const divCenterY = divRect.top + divRect.height / 2 - containerRect.top;
        const divDist = Math.sqrt((cursorX - divCenterX) ** 2 + (cursorY - divCenterY) ** 2);
        if (divDist < 180) {
          const expand = 1 + (1 - divDist / 180) * 1.8;
          gsap.to(dividerRef.current, { scaleX: expand, duration: 0.4, ease: "power2.out", overwrite: "auto" });
        } else {
          gsap.to(dividerRef.current, { scaleX: 1, duration: 0.6, ease: "power2.out", overwrite: "auto" });
        }
      }

      if (scrollIndicatorRef.current) {
        const scrollRect = scrollIndicatorRef.current.getBoundingClientRect();
        const scrollCenterX = scrollRect.left + scrollRect.width / 2 - containerRect.left;
        const scrollCenterY = scrollRect.top + scrollRect.height / 2 - containerRect.top;
        const scrollDist = Math.sqrt((cursorX - scrollCenterX) ** 2 + (cursorY - scrollCenterY) ** 2);
        if (scrollDist < 150) {
          const swayX = (cursorX - scrollCenterX) * 0.12;
          gsap.to(scrollIndicatorRef.current, { x: swayX, duration: 0.5, ease: "power2.out", overwrite: "auto" });
        } else {
          gsap.to(scrollIndicatorRef.current, { x: 0, duration: 0.8, ease: "power2.out", overwrite: "auto" });
        }
      }
    };

    container.addEventListener("mousemove", handleMouseMove);
    return () => container.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useGSAP(
    () => {
      ingredientRefs.current.forEach((el, i) => {
        if (el) gsap.set(el, { rotation: HERO_INGREDIENTS[i].rotation });
      });

      if (!animate || hasAnimated.current) return;
      hasAnimated.current = true;

      const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

      tl.to(preLabelRef.current, { opacity: 1, y: 0, duration: 0.8 }, 0.2)
        .to(line1Ref.current, { opacity: 1, y: 0, duration: 0.9 }, 0.35)
        .to(line2Ref.current, { opacity: 1, y: 0, duration: 0.9 }, 0.5)
        .to(dividerRef.current, { scaleX: 1, duration: 0.6, ease: "power2.inOut" }, 0.7)
        .to(subLineRef.current, { opacity: 1, duration: 0.8 }, 0.85)
        .to(ctaRef.current, { opacity: 1, y: 0, duration: 0.8 }, 1)
        .to(scrollIndicatorRef.current, { opacity: 1, duration: 1 }, 1.4);

      // Left ingredients stagger from left
      const leftEls = ingredientRefs.current.slice(0, 3);
      gsap.fromTo(
        leftEls,
        { opacity: 0, x: -40 },
        { opacity: 1, x: 0, duration: 0.9, ease: "power2.out", stagger: 0.12, delay: 0.6 }
      );

      // Right ingredients stagger from right
      const rightEls = ingredientRefs.current.slice(3);
      gsap.fromTo(
        rightEls,
        { opacity: 0, x: 40 },
        { opacity: 1, x: 0, duration: 0.9, ease: "power2.out", stagger: 0.12, delay: 0.6 }
      );

      // Looping scroll line
      gsap.fromTo(
        scrollLineRef.current,
        { scaleY: 0, transformOrigin: "top center" },
        { scaleY: 1, duration: 1.2, ease: "power1.inOut", repeat: -1, delay: 1.6 }
      );

      // Pulse hint — plays once after entrance completes
      if (!hasPulsed.current) {
        hasPulsed.current = true;
        const allEls = ingredientRefs.current.filter(Boolean);
        gsap.timeline({ delay: 2 })
          .to(allEls, {
            scale: 1.06,
            duration: 0.4,
            ease: "power1.inOut",
            stagger: 0.15,
          })
          .to(allEls, {
            scale: 1,
            duration: 0.4,
            ease: "power1.inOut",
            stagger: 0.15,
          })
          .to(allEls, {
            scale: 1.06,
            duration: 0.4,
            ease: "power1.inOut",
            stagger: 0.15,
          })
          .to(allEls, {
            scale: 1,
            duration: 0.4,
            ease: "power1.inOut",
            stagger: 0.15,
          });
      }
    },
    { scope: containerRef, dependencies: [animate] }
  );

  const handleIngredientEnter = (index: number) => {
    if (activeIndex === index) return; // Don't override active glow
    const el = ingredientRefs.current[index];
    if (!el) return;
    const nameEl = el.querySelector(".hi-name") as HTMLElement;
    const lineEl = lineRefs.current[index];
    gsap.to(el, { scale: 1.08, rotation: 0, boxShadow: "0 0 30px rgba(67,108,180,0.12)", duration: 0.35, ease: "power2.out", overwrite: "auto" });
    if (nameEl) gsap.to(nameEl, { color: "#436cb4", duration: 0.35 });
    if (lineEl) gsap.to(lineEl, { scaleX: 1.5, opacity: 1, duration: 0.35, ease: "power2.out", overwrite: "auto" });
  };

  const handleIngredientLeave = (index: number) => {
    if (activeIndex === index) return; // Don't reset active glow
    const el = ingredientRefs.current[index];
    if (!el) return;
    const nameEl = el.querySelector(".hi-name") as HTMLElement;
    const lineEl = lineRefs.current[index];
    gsap.to(el, { scale: 1, rotation: HERO_INGREDIENTS[index].rotation, boxShadow: "0 0 0px rgba(67,108,180,0)", duration: 0.5, ease: "power2.inOut", overwrite: "auto" });
    if (nameEl) gsap.to(nameEl, { color: "#fbf3d4", duration: 0.5 });
    if (lineEl) gsap.to(lineEl, { scaleX: 1, opacity: 0.7, duration: 0.5, ease: "power2.inOut", overwrite: "auto" });
  };

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100vh", overflow: "hidden" }}
    >
      {/* Video background */}
      <video
        autoPlay
        muted
        loop
        playsInline
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }}
      >
        <source src="/videos/hero.mp4" type="video/mp4" />
      </video>

      {/* Overlay: base darkening */}
      <div style={{ position: "absolute", inset: 0, backgroundColor: "rgba(29,29,31,0.52)", zIndex: 1 }} />
      {/* Overlay: warm vignette left */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(29,29,31,0.55) 0%, transparent 65%)", zIndex: 2 }} />
      {/* Overlay: top gradient */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(29,29,31,0.4) 0%, transparent 35%)", zIndex: 2 }} />
      {/* Overlay: bottom fade */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(29,29,31,0.85) 0%, transparent 45%)", zIndex: 2 }} />

      {/* Floating ingredients */}
      {HERO_INGREDIENTS.map((ingredient, i) => {
        const isRight = ingredient.side === "right";
        return (
          <div
            key={i}
            ref={(el) => { ingredientRefs.current[i] = el; }}
            className="hero-ingredient-wrapper"
            style={{
              position: "absolute",
              top: ingredient.top,
              ...(isRight ? { right: ingredient.right } : { left: ingredient.left }),
              zIndex: 8,
              opacity: 0,
              cursor: "pointer",
            }}
            onClick={() => handleIngredientClick(i)}
            onMouseEnter={() => handleIngredientEnter(i)}
            onMouseLeave={() => handleIngredientLeave(i)}
            onTouchStart={() => handleIngredientEnter(i)}
            onTouchEnd={() => handleIngredientLeave(i)}
          >
            <div className={`hero-ingredient${isRight ? " right-side" : ""}`} data-side={ingredient.side}>
              {!isRight && <div ref={(el) => { lineRefs.current[i] = el; }} className="hi-line" style={{ transformOrigin: "right center" }} />}
              <div className="hi-content">
                <span className="hi-name"><SplitText text={ingredient.name} repelStrength={50} repelRadius={110} staggerDelay={0.05} animateEntrance={false} /></span>
                <span className="hi-desc"><SplitText text={ingredient.descriptor} repelStrength={20} repelRadius={70} staggerDelay={0.02} animateEntrance={false} /></span>
              </div>
              {isRight && <div ref={(el) => { lineRefs.current[i] = el; }} className="hi-line" style={{ transformOrigin: "left center" }} />}
            </div>
          </div>
        );
      })}

      {/* Center block */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          textAlign: "center",
          width: "clamp(300px, 40vw, 560px)",
          zIndex: 10,
        }}
      >
        {/* Pre-label */}
        <div
          ref={preLabelRef}
          className="label-text"
          style={{ marginBottom: "1.2rem", color: "#c0c8ce", letterSpacing: "0.22em", opacity: 0, transform: "translateY(15px)" }}
        >
          <SplitText text="CORE ELEMENT — HIGH PROTEIN BREAD" repelStrength={45} repelRadius={100} staggerDelay={0.02} animateEntrance={false} />
        </div>

        {/* Headline */}
        <div
          ref={line1Ref}
          className="heading-xl"
          style={{
            display: "block",
            fontSize: "clamp(3.8rem, 8vw, 8rem)",
            fontWeight: 300,
            lineHeight: 0.92,
            color: "#fbf3d4",
            textShadow: "0 4px 60px rgba(0,0,0,0.5)",
            opacity: 0,
            transform: "translateY(35px)",
          }}
        >
          <SplitText text="SAME BREAD." repelStrength={80} repelRadius={140} staggerDelay={0.04} animateEntrance={false} />
        </div>
        <div
          ref={line2Ref}
          className="heading-xl"
          style={{
            display: "block",
            fontSize: "clamp(3.8rem, 8vw, 8rem)",
            fontWeight: 300,
            lineHeight: 0.92,
            color: "#fbf3d4",
            textShadow: "0 4px 60px rgba(0,0,0,0.5)",
            opacity: 0,
            transform: "translateY(35px)",
          }}
        >
          <SplitText text="BETTER BUILT." repelStrength={80} repelRadius={140} staggerDelay={0.04} animateEntrance={false} />
        </div>

        {/* Gold divider */}
        <div
          ref={dividerRef}
          style={{
            width: "48px",
            height: "1px",
            background: "#436cb4",
            margin: "1.4rem auto",
            transformOrigin: "center",
            transform: "scaleX(0)",
          }}
        />

        {/* Sub-line */}
        <div
          ref={subLineRef}
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.78rem",
            fontWeight: 300,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "rgba(192,200,206,0.55)",
            opacity: 0,
          }}
        >
          <SplitText text="12 real ingredients. Zero compromise." repelStrength={35} repelRadius={90} staggerDelay={0.015} animateEntrance={false} />
        </div>

        {/* CTA */}
        <button
          ref={ctaRef}
          style={{
            marginTop: "2.5rem",
            border: "1px solid rgba(67,108,180,0.6)",
            color: "#fbf3d4",
            background: "transparent",
            padding: "14px 40px",
            fontFamily: "var(--font-body)",
            fontSize: "0.75rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            cursor: "pointer",
            transition: "all 0.3s ease",
            opacity: 0,
            transform: "translateY(20px)",
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLButtonElement).style.background = "rgba(67,108,180,0.15)";
            (e.target as HTMLButtonElement).style.borderColor = "#436cb4";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLButtonElement).style.background = "transparent";
            (e.target as HTMLButtonElement).style.borderColor = "rgba(67,108,180,0.6)";
          }}
        >
          <SplitText text="Discover the Bread" repelStrength={25} repelRadius={80} staggerDelay={0.02} animateEntrance={false} />
        </button>
      </div>

      {/* Scroll indicator */}
      <div
        ref={scrollIndicatorRef}
        className="hidden-mobile"
        style={{
          position: "absolute",
          bottom: "2.5rem",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.75rem",
          opacity: 0,
          zIndex: 10,
        }}
      >
        <div style={{ width: "1px", height: "40px", backgroundColor: "rgba(192,200,206,0.3)", position: "relative", overflow: "hidden" }}>
          <div
            ref={scrollLineRef}
            style={{ position: "absolute", inset: 0, backgroundColor: "#c0c8ce", transformOrigin: "top center", transform: "scaleY(0)" }}
          />
        </div>
      </div>

      {/* Ingredient detail card */}
      {activeIngredient && (
        <IngredientCard
          ingredient={activeIngredient}
          anchorRect={activeRect}
          side={activeIngredient.side as "left" | "right"}
          onClose={handleCardClose}
        />
      )}
    </div>
  );
}
