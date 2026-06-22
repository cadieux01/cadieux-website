"use client";

import Link from "next/link";
import ScrollReveal from "@/components/ScrollReveal";
import { BLOG_POSTS } from "@/lib/data";

const GRAIN = "url(/grain.svg)";

export default function BlogsClient() {
  return (
    <div style={{ minHeight: "100dvh", background: "rgb(6,4,2)", position: "relative", overflowX: "clip" }}>
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

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(28px,8vw,120px) 120px" }}>
        <ScrollReveal>
          <h1 data-stagger style={{ margin: "0 0 64px", fontFamily: "var(--font-heading)", fontSize: "clamp(52px,12vw,96px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>
            Stories &amp; Bakes
          </h1>
        </ScrollReveal>
        <ScrollReveal>
          {BLOG_POSTS.map((post, i) => (
            <Link
              key={i}
              href={`/blogs/${post.slug}`}
              data-stagger
              style={{
                borderTop: "1px solid rgba(240,223,200,0.08)",
                paddingTop: 28,
                marginBottom: 36,
                textDecoration: "none",
                display: "block",
              }}
            >
              <p style={{ margin: "0 0 12px", fontFamily: "var(--font-heading)", fontSize: "clamp(20px,4vw,32px)", fontWeight: 300, color: "rgba(251,243,212,0.85)", letterSpacing: "0.01em", lineHeight: 1.2 }}>{post.title}</p>
              <p style={{ margin: "0 0 14px", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, lineHeight: 1.8, color: "rgba(251,243,212,0.45)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as never, overflow: "hidden" }}>{post.brief}</p>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "#4369B2" }}>Read more →</span>
            </Link>
          ))}
        </ScrollReveal>
      </div>
    </div>
  );
}
