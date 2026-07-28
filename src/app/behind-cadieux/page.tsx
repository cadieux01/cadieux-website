// Behind Cadieux — long-form, magazine-style founder/origin page.
// Mirror of the app's behind-cadieux screen. Foundation Green canvas
// (brand bible), cream serif headings, gold rule + signature, and
// Endurance Blue accents on the stat values.
//
// Copy lives in top-of-file constants so non-engineers can edit copy
// without touching JSX. Page is a server component with metadata
// export; ScrollReveal is a client component but importable here.
//
// Confidentiality: this page never references the recipe's supplier,
// country-of-origin, premix, or formulation provenance. The story
// frames the recipe as developed and refined in-house.

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import ScrollReveal from "@/components/ScrollReveal";
import { ShareButton } from "@/components/ShareButton";
import { getPageContent, pickString } from "@/lib/content";

// ── Brand bible palette ─────────────────────────────────────────────
const FOUNDATION_GREEN = "#024628";
const GRAIN_CREAM = "#FBF3D4";
const GOLD = "#024628";
const ENDURANCE_BLUE = "#4369B2";

const GRAIN = "url(/grain.svg)";

// ── SEO ─────────────────────────────────────────────────────────────
// Reads behind.seo.title + behind.seo.description from content_strings so
// non-engineers can edit meta copy in the admin CMS. Inline fallbacks keep
// tags meaningful even if the DB row is empty (pickString returns "" when
// no CRITICAL_FALLBACKS entry exists).
const BEHIND_TITLE_FALLBACK =
  "The Story Behind Cadieux Protein Bread | Cadieux";
const BEHIND_DESCRIPTION_FALLBACK =
  "Why we built Cadieux — a protein bread brand from Visakhapatnam. Founder story, lab-tested loaves, and the mission to make everyday bread better.";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getPageContent({ page: "behind" });
  const title =
    pickString(content, "behind.seo.title") || BEHIND_TITLE_FALLBACK;
  const description =
    pickString(content, "behind.seo.description") ||
    BEHIND_DESCRIPTION_FALLBACK;
  return {
    title,
    description,
    alternates: { canonical: "/behind-cadieux" },
  };
}

// ── Page title ──────────────────────────────────────────────────────
const PAGE_TITLE = "Behind Cadieux";
const PAGE_EYEBROW = "A LETTER FROM THE FOUNDER";

// ── Story sections (ordered) ────────────────────────────────────────
type StorySection = { heading: string; paragraphs: string[] };

const SECTIONS: StorySection[] = [
  {
    heading: "It started with a chore.",
    paragraphs: [
      "Same shake. Same eggs. Same bar. Every day. The discipline was working, but eating well had stopped feeling like anything but survival.",
    ],
  },
  {
    heading: "The bread didn\u2019t exist.",
    paragraphs: [
      "I went looking for high-protein bread. I found it online. I couldn\u2019t find it in Vizag — not in a single store, not even delivered to my door.",
      "So I built it.",
    ],
  },
  {
    heading: "The name",
    paragraphs: [
      "I searched for six months. Across seven languages. Looking for one word that meant something.",
      "I found Cadieux. It means little fighter.",
      "It stayed with me. Because a fighter isn\u2019t defined by the outcome, or the success, or the stage they\u2019re at. A little fighter can be anyone, anywhere, still going. To be called one felt like a quiet honour — a respect for the effort a life takes.",
      "The name is hard to pronounce. I kept it anyway. It\u2019s how I run this brand: the right way, not the easy way. No shortcuts. No compromise on quality or commitment — even when easier paths exist. A brand that does the right thing, not the popular thing.",
      "Nike, Audi, Hermès — every name worth remembering had to be learned first.",
    ],
  },
  {
    heading: "The work nobody sees",
    paragraphs: [
      "The idea came in September 2024. Core Element was registered four months later. What ran for the next two years was the work.",
      "Hundreds of trials. Sixty to seventy parameters measured on every fresh batch — from the obvious (protein, fibre, sodium) to the obscure (protein structure, amino acid profile, absorption). Each parameter retested around ten times.",
      "Three independent NABL-accredited laboratories. Travel through four Indian states. Consultations with specialists overseas. Competitor breads taken apart, parameter by parameter, to understand what \u201chigh protein\u201d was actually supposed to mean.",
    ],
  },
];

// ── Milestones (visual timeline under "The work nobody sees") ──────
// Bundled fallback used when behind_milestones is empty (DB unreachable
// or freshly seeded). Content-driven via getPageContent otherwise.
type Milestone = { marker: string; label: string };

const MILESTONES_FALLBACK: Milestone[] = [
  { marker: "September 2024", label: "The Idea" },
  { marker: "January 2025", label: "Core Element registered" },
  { marker: "24 months", label: "Recipe development and trials" },
  { marker: "September 2026", label: "Cadieux launches" },
];

// ── Stat callouts ───────────────────────────────────────────────────
type Stat = { value: string; label: string };

const STATS_HEADING = "Engineered for absorption, not just content";
const STATS_LEAD =
  "Most \u201chigh protein\u201d products tell you what\u2019s in them. Cadieux is engineered for what your body can actually absorb.";

// Bundled fallback used when behind_stats is empty.
const STATS_FALLBACK: Stat[] = [
  { value: "\u2014", label: "Protein" },
  { value: "\u2014", label: "Fibre" },
  { value: "Dense & nourishing", label: "Every loaf" },
  { value: "In-house", label: "Recipe development" },
  { value: "\u2014", label: "Trans fat \u00b7 No animal fat \u00b7 Multigrain" },
];

const STATS_TRIALS_NOTE = "Final trials are under process.";

const STATS_FOOTNOTE =
  "Verified by three independent NABL-accredited laboratories.";

// ── Closing block ──────────────────────────────────────────────────
const CLOSING_SECTION: StorySection = {
  heading: "Same routine. More of what your body\u2019s asking for.",
  paragraphs: [
    "Baked in Vizag, in small batches, every morning. No crumbs. Real sourdough fermentation. The bread you\u2019d eat anyway — engineered to give back more.",
  ],
};

const CLOSING_PUNCH = "More protein. Same routine.";
const SIGNATURE = "— Sunny Raja, Founder";

// Cap copy width on desktop so paragraphs read as a magazine column
// rather than stretching edge-to-edge. The outer page pads still scale
// with viewport via clamp().
const CONTENT_MAX = 720;

export default async function BehindCadieuxPage() {
  // Content-driven milestones + stat callouts (with bundled fallbacks
  // if the DB read returns empty).
  const content = await getPageContent({ page: "behind" });
  const milestones: Milestone[] =
    content.milestones.length > 0
      ? content.milestones.map((m) => ({ marker: m.marker, label: m.label }))
      : MILESTONES_FALLBACK;
  const stats: Stat[] =
    content.stats.length > 0
      ? content.stats.map((s) => ({ value: s.value, label: s.label }))
      : STATS_FALLBACK;

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: FOUNDATION_GREEN,
        position: "relative",
        overflowX: "clip",
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: GRAIN,
          opacity: 0.05,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* Back link */}
      <Link
        href="/"
        style={{
          position: "fixed",
          top: 24,
          left: 20,
          zIndex: 101,
          fontFamily: "var(--font-body)",
          fontSize: 10,
          fontWeight: 200,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          color: ENDURANCE_BLUE,
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <main
        style={{
          position: "relative",
          zIndex: 1,
          padding: "100px clamp(28px,8vw,120px) 120px",
          maxWidth: CONTENT_MAX,
          margin: "0 auto",
        }}
      >
        {/* Hero */}
        <ScrollReveal>
          <div
            data-stagger
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: 40,
            }}
          >
            <div
              style={{
                width: "min(280px, 70vw)",
                aspectRatio: "4 / 5",
                borderRadius: 8,
                overflow: "hidden",
                position: "relative",
                background: "rgba(251,243,212,0.06)",
              }}
            >
              <Image
                src="/founder.jpg"
                alt="Sunny Raja, founder of Cadieux"
                fill
                priority
                sizes="(max-width: 640px) 70vw, 280px"
                style={{ objectFit: "cover" }}
              />
            </div>
          </div>

          <p
            data-stagger
            style={{
              margin: "0 0 12px",
              fontFamily: "var(--font-body)",
              fontSize: 11,
              fontWeight: 300,
              letterSpacing: "0.35em",
              textTransform: "uppercase",
              color: GOLD,
              textAlign: "center",
            }}
          >
            {PAGE_EYEBROW}
          </p>
          <h1
            data-stagger
            style={{
              margin: "0 0 24px",
              fontFamily: "var(--font-heading)",
              fontSize: "clamp(40px,9vw,72px)",
              fontWeight: 300,
              color: GRAIN_CREAM,
              letterSpacing: "0.02em",
              lineHeight: 1.05,
              textAlign: "center",
            }}
          >
            {PAGE_TITLE}
          </h1>
          <div
            data-stagger
            style={{
              width: 48,
              height: 1,
              background: GOLD,
              opacity: 0.7,
              margin: "0 auto 28px",
            }}
          />
          <div
            data-stagger
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: 56,
            }}
          >
            <ShareButton
              title="Behind Cadieux"
              text="Behind Cadieux — two years of trials, three NABL labs, one high-protein bread engineered for absorption."
              url="https://www.cadieux.in/behind-cadieux"
              label="Share story"
              size={42}
            />
          </div>
        </ScrollReveal>

        {/* Story sections */}
        {SECTIONS.map((section, sIdx) => (
          <ScrollReveal key={section.heading}>
            <section style={{ marginBottom: 48 }}>
              <h2
                data-stagger
                style={{
                  margin: "0 0 20px",
                  fontFamily: "var(--font-heading)",
                  fontSize: "clamp(26px,5vw,36px)",
                  fontWeight: 300,
                  color: GRAIN_CREAM,
                  letterSpacing: "0.01em",
                  lineHeight: 1.15,
                }}
              >
                {section.heading}
              </h2>
              {section.paragraphs.map((p, pIdx) => (
                <p
                  key={pIdx}
                  data-stagger
                  style={{
                    margin: "0 0 16px",
                    fontFamily: "var(--font-heading)",
                    fontSize: "clamp(15px,1.8vw,18px)",
                    fontWeight: 300,
                    color: "rgba(251,243,212,0.92)",
                    letterSpacing: "0.01em",
                    lineHeight: 1.75,
                  }}
                >
                  {p}
                </p>
              ))}

              {/* Inline milestone timeline under "The work nobody sees". */}
              {sIdx === SECTIONS.length - 1 ? (
                <div
                  data-stagger
                  style={{
                    marginTop: 40,
                    position: "relative",
                    paddingLeft: 4,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 9,
                      top: 8,
                      bottom: 8,
                      width: 1,
                      background: "rgba(251,243,212,0.35)",
                    }}
                  />
                  {milestones.map((m) => (
                    <div
                      key={m.marker}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 18,
                        marginBottom: 24,
                      }}
                    >
                      <div
                        style={{
                          width: 11,
                          height: 11,
                          borderRadius: 999,
                          background: GOLD,
                          marginTop: 6,
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p
                          style={{
                            margin: 0,
                            fontFamily: "var(--font-body)",
                            fontSize: 12,
                            fontWeight: 500,
                            letterSpacing: "0.25em",
                            textTransform: "uppercase",
                            color: GOLD,
                          }}
                        >
                          {m.marker}
                        </p>
                        <p
                          style={{
                            margin: "4px 0 0",
                            fontFamily: "var(--font-heading)",
                            fontSize: 16,
                            fontWeight: 300,
                            color: GRAIN_CREAM,
                            letterSpacing: "0.02em",
                          }}
                        >
                          {m.label}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          </ScrollReveal>
        ))}

        {/* Stat callouts */}
        <ScrollReveal>
          <section style={{ marginBottom: 48 }}>
            <h2
              data-stagger
              style={{
                margin: "0 0 20px",
                fontFamily: "var(--font-heading)",
                fontSize: "clamp(26px,5vw,36px)",
                fontWeight: 300,
                color: GRAIN_CREAM,
                letterSpacing: "0.01em",
                lineHeight: 1.15,
              }}
            >
              {STATS_HEADING}
            </h2>
            <p
              data-stagger
              style={{
                margin: "0 0 24px",
                fontFamily: "var(--font-heading)",
                fontSize: "clamp(15px,1.8vw,18px)",
                fontWeight: 300,
                color: "rgba(251,243,212,0.92)",
                letterSpacing: "0.01em",
                lineHeight: 1.75,
              }}
            >
              {STATS_LEAD}
            </p>

            <div
              data-stagger
              style={{
                marginBottom: 24,
                padding: "12px 16px",
                border: "0.5px solid rgba(251,243,212,0.3)",
                borderRadius: 4,
                fontFamily: "var(--font-body)",
                fontSize: 13,
                fontWeight: 300,
                letterSpacing: "0.04em",
                color: "rgba(251,243,212,0.9)",
                background: "rgba(251,243,212,0.06)",
              }}
            >
              {STATS_TRIALS_NOTE}
            </div>

            <div
              data-stagger
              style={{
                marginTop: 16,
                borderTop: "1px solid rgba(251,243,212,0.25)",
              }}
            >
              {stats.map((s) => (
                <div
                  key={s.label}
                  style={{
                    padding: "20px 0",
                    borderBottom: "1px solid rgba(251,243,212,0.25)",
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 16,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontSize: "clamp(28px,5vw,40px)",
                      fontWeight: 300,
                      color: ENDURANCE_BLUE,
                      letterSpacing: "0.01em",
                      lineHeight: 1,
                    }}
                  >
                    {s.value}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 11,
                      fontWeight: 400,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: "rgba(251,243,212,0.75)",
                      textAlign: "right",
                      flex: "1 1 200px",
                    }}
                  >
                    {s.label}
                  </span>
                </div>
              ))}
            </div>

            <p
              data-stagger
              style={{
                margin: "20px 0 0",
                fontFamily: "var(--font-body)",
                fontSize: 13,
                fontWeight: 300,
                fontStyle: "italic",
                color: "rgba(251,243,212,0.7)",
                letterSpacing: "0.02em",
                lineHeight: 1.6,
              }}
            >
              {STATS_FOOTNOTE}
            </p>
          </section>
        </ScrollReveal>

        {/* Closing section */}
        <ScrollReveal>
          <section style={{ marginBottom: 64 }}>
            <h2
              data-stagger
              style={{
                margin: "0 0 20px",
                fontFamily: "var(--font-heading)",
                fontSize: "clamp(26px,5vw,36px)",
                fontWeight: 300,
                color: GRAIN_CREAM,
                letterSpacing: "0.01em",
                lineHeight: 1.15,
              }}
            >
              {CLOSING_SECTION.heading}
            </h2>
            {CLOSING_SECTION.paragraphs.map((p, i) => (
              <p
                key={i}
                data-stagger
                style={{
                  margin: "0 0 16px",
                  fontFamily: "var(--font-heading)",
                  fontSize: "clamp(15px,1.8vw,18px)",
                  fontWeight: 300,
                  color: "rgba(251,243,212,0.92)",
                  letterSpacing: "0.01em",
                  lineHeight: 1.75,
                }}
              >
                {p}
              </p>
            ))}
          </section>
        </ScrollReveal>

        {/* Closing punch + signature */}
        <ScrollReveal>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              marginTop: 24,
            }}
          >
            <div
              data-stagger
              style={{
                width: 64,
                height: 1,
                background: GOLD,
                opacity: 0.7,
                marginBottom: 40,
              }}
            />
            <p
              data-stagger
              style={{
                margin: 0,
                fontFamily: "var(--font-heading)",
                fontSize: "clamp(28px,5vw,40px)",
                fontWeight: 300,
                fontStyle: "italic",
                color: GRAIN_CREAM,
                letterSpacing: "0.02em",
                lineHeight: 1.2,
              }}
            >
              {CLOSING_PUNCH}
            </p>
            <p
              data-stagger
              style={{
                margin: "32px 0 0",
                fontFamily: "var(--font-body)",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: GOLD,
              }}
            >
              {SIGNATURE}
            </p>
          </div>
        </ScrollReveal>
      </main>
    </div>
  );
}
