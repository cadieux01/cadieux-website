// Prompt 9 — SEO landing at /subscribe.
//
// Top-of-funnel page for "protein bread subscription" / "bread subscription
// Vizag" intent. This is NOT the wizard (that lives at /subscriptions/setup)
// and NOT the signed-in hub (that lives at /subscription — now noindexed via
// its layout). Purpose: educate a cold visitor about the subscription, show
// the real subscriber price, list serviceable areas, and hand off to the
// wizard with a single primary CTA.
//
// Data policy:
//   • Prices are read live from getSubscriptionPlans() (revalidate 3600 +
//     tag "subscription-plans" so admin MRP/discount edits bust the SSR
//     copy). If a plan's price can't resolve, the whole price block is
//     omitted — no placeholder like "₹—".
//   • Area chips derive from getServiceAreaGroups() so this list stays in
//     lockstep with the /delivery/[area] pages shipped in Prompt 8.
//   • Contact number is the single ADMIN_PHONE constant (NAP consistency).
//   • Delivery window is the same citywide fact used on /delivery/[area]
//     — one sentence, sourced from delivery-slots.ts semantics.
//
// Guardrails (SEO backlog compliance):
//   • No FAQPage schema (deprecated May 2026, no rich result).
//   • No aggregateRating.
//   • No nutrition figures (Raja's standing rule: no macros on public
//     pages until lab numbers are approved).
//   • No invented per-outlet opening hours, no "made-today" freshness
//     claims beyond the 12-hour lead we actually enforce.

import type { Metadata } from "next";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { ADMIN_PHONE } from "@/lib/delivery-slots";
import { toUrlSlug } from "@/lib/product-slugs";
import { getServiceAreaGroups, displayAreaName } from "@/lib/service-areas";
import {
  getSubscriptionPlans,
  type SubscriptionPlanDTO,
} from "@/lib/subscription-plans";
import { getPreorderMode } from "@/lib/preorderMode";

const SITE_URL = "https://www.cadieux.in";
const GRAIN = "url(/grain.svg)";
const GOLD = "251,243,212";

// Regenerate at most once an hour — plan prices and area rows are
// admin-edited on a slow cadence, and the shared cache tags
// ("subscription-plans", "service-areas") bust both the SSR copy and
// the downstream API/checkout paths together on write.
export const revalidate = 3600;

// Dial form of ADMIN_PHONE — matches /store-locator and /delivery/[area]
// so LocalBusiness NAP consistency is preserved everywhere the number
// appears on a page.
const CADIEUX_PHONE_DIAL = ADMIN_PHONE.replace(/\s/g, "");

// Citywide delivery-window fact. Same sentence used on /delivery/[area]
// so the two SEO surfaces state one identical delivery promise. If slot
// hours change, edit both this file and delivery/[area]/page.tsx.
const DELIVERY_WINDOW_TEXT =
  "Fresh delivery daily, 7:30 AM to 9:00 PM IST, except 1–2 PM.";

// Rupee formatter — drops decimals for whole numbers so "₹120" stays
// clean and "₹143.10" keeps its paisa. Mirrors the wizard's fmtMoney.
function fmtMoney(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString("en-IN")
    : n.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}

export const metadata: Metadata = {
  title: "Protein Bread Subscription in Visakhapatnam | Cadieux",
  description:
    "Save 10% on every loaf with a Cadieux subscription. Pick your dates, pick your slot, delivered fresh across Visakhapatnam.",
  alternates: { canonical: "/subscribe" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/subscribe`,
    title: "Protein Bread Subscription in Visakhapatnam | Cadieux",
    description:
      "Save 10% on every loaf with a Cadieux subscription. Pick your dates, pick your slot, delivered fresh across Visakhapatnam.",
    images: [{ url: `${SITE_URL}/og-cover.jpg` }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Protein Bread Subscription in Visakhapatnam | Cadieux",
    description:
      "Save 10% on every loaf with a Cadieux subscription. Pick your dates, pick your slot, delivered fresh across Visakhapatnam.",
  },
};

export default async function SubscribeLandingPage() {
  // Opt this render out of the ISR cache when preorder_mode is on, so an
  // admin flip of the toggle isn't stale for up to `revalidate` seconds.
  // noStore() marks the entire page dynamic — the CTA-disabled state must
  // never lag behind the DB truth. See src/lib/preorderMode.ts.
  noStore();
  // Fire both DB reads in parallel — each is independently cached with
  // its own tag so a miss on one doesn't block the other. preorderMode
  // read is intentionally uncached (see helper).
  const [plans, areaGroups, preorderMode] = await Promise.all([
    getSubscriptionPlans(),
    getServiceAreaGroups(),
    getPreorderMode(),
  ]);

  const hasPlans = plans.length > 0;

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#C0C8CE",
        position: "relative",
        overflowX: "clip",
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: GRAIN,
          opacity: 0.04,
          mixBlendMode: "multiply",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* Back link — matches /delivery/[area] and /store-locator. */}
      <Link
        href="/"
        style={{
          position: "fixed",
          top: "calc(24px + env(safe-area-inset-top))",
          left: "calc(20px + env(safe-area-inset-left))",
          zIndex: 101,
          fontFamily: "var(--font-body)",
          fontSize: 10,
          fontWeight: 200,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          color: "#024628",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "100px clamp(24px,6vw,80px) 120px",
          maxWidth: 780,
          margin: "0 auto",
        }}
      >
        {/* Eyebrow — deliberately different from the /subscription hub's
            "Fresh bread, on your schedule." sub-line so the two pages
            don't compete on identical copy. Brand-voice tagline. */}
        <p
          style={{
            margin: "0 0 20px",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 200,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(2,70,40,0.75)",
          }}
        >
          More protein. Same routine.
        </p>

        <h1
          style={{
            margin: "0 0 20px",
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(36px,8vw,64px)",
            fontWeight: 300,
            color: "#024628",
            letterSpacing: "0.02em",
            lineHeight: 1.05,
          }}
        >
          Cadieux protein bread subscription in Visakhapatnam
        </h1>

        {preorderMode ? (
          <div
            style={{
              background: "#FBF3D4",
              border: "1px solid rgba(2,70,40,0.25)",
              padding: "16px 20px",
              margin: "0 0 24px",
            }}
          >
            <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 500, letterSpacing: "0.35em", textTransform: "uppercase", color: "#024628" }}>
              Pre-order
            </p>
            <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 300, lineHeight: 1.55, color: "#024628" }}>
              Subscriptions open once daily deliveries begin. In the meantime, reserve a single loaf now — we&apos;ll confirm your first delivery date by SMS + WhatsApp.
            </p>
          </div>
        ) : null}

        {/* Trust paragraph — leads with the real, verifiable 10% number
            (Raja standing rule: no nutrition macros in copy until lab
            numbers are approved). */}
        <p
          style={{
            margin: "0 0 28px",
            fontFamily: "var(--font-body)",
            fontSize: 15,
            fontWeight: 400,
            color: "#024628",
            lineHeight: 1.55,
            letterSpacing: "0.01em",
          }}
        >
          Save 10% on every loaf. A Cadieux subscription locks in the same
          slow-fermented protein bread you would buy one-off, at a
          subscriber price, on the dates you choose across Vizag.
        </p>

        {/* ── How it works ─────────────────────────────────────────── */}
        <section aria-labelledby="how-heading" style={{ margin: "0 0 32px" }}>
          <h2
            id="how-heading"
            style={{
              margin: "0 0 14px",
              fontFamily: "var(--font-heading)",
              fontSize: 22,
              fontWeight: 400,
              color: "#024628",
              letterSpacing: "0.01em",
            }}
          >
            How it works
          </h2>
          <ol
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {[
              "Pick your loaves — a minimum of two per delivery, mixed in any ratio between multigrain and plain.",
              "Pick your dates — no fixed weekly cycle. Choose the days that fit your week.",
              "Pick a 30-minute slot — anywhere from 7:30 AM to 9:00 PM IST, except the 1–2 PM kitchen lunch.",
              "We bake to order — every delivery leaves the kitchen the same day it reaches you. Twelve hours' notice keeps the loaf oven-fresh.",
            ].map((line, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  gap: 14,
                  fontFamily: "var(--font-body)",
                  fontSize: 14,
                  fontWeight: 400,
                  color: "#024628",
                  lineHeight: 1.55,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    flex: "0 0 auto",
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    border: "1px solid rgba(2,70,40,0.35)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-heading)",
                    fontSize: 13,
                    color: "#024628",
                    background: "transparent",
                  }}
                >
                  {i + 1}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* ── What subscribers get (server-rendered from DB) ─────────
            Rendered ONLY when the API returned at least one plan whose
            price resolves to a positive number. If Supabase is unreachable
            the block is omitted entirely — no "₹—" placeholder. */}
        {hasPlans ? (
          <section
            aria-labelledby="plans-heading"
            style={{ margin: "0 0 32px" }}
          >
            <h2
              id="plans-heading"
              style={{
                margin: "0 0 14px",
                fontFamily: "var(--font-heading)",
                fontSize: 22,
                fontWeight: 400,
                color: "#024628",
                letterSpacing: "0.01em",
              }}
            >
              What subscribers get
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {plans.map((p) => (
                <PlanCard key={p.slug} plan={p} />
              ))}
            </div>
          </section>
        ) : null}

        {/* ── Where we deliver ─────────────────────────────────────── */}
        <section
          aria-labelledby="areas-heading"
          style={{ margin: "0 0 32px" }}
        >
          <h2
            id="areas-heading"
            style={{
              margin: "0 0 10px",
              fontFamily: "var(--font-heading)",
              fontSize: 22,
              fontWeight: 400,
              color: "#024628",
              letterSpacing: "0.01em",
            }}
          >
            Where we deliver
          </h2>
          <p
            style={{
              margin: "0 0 14px",
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 400,
              color: "#024628",
              lineHeight: 1.55,
            }}
          >
            {DELIVERY_WINDOW_TEXT} Serviceable pincodes across Visakhapatnam
            — details for each area on the delivery pages.
          </p>
          {areaGroups.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 12,
              }}
            >
              {areaGroups.map((g) => (
                <Link
                  key={g.slug}
                  href={`/delivery/${g.slug}`}
                  className="cdx-area-chip"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: "1px solid rgba(2,70,40,0.35)",
                    fontFamily: "var(--font-body)",
                    fontSize: 12,
                    fontWeight: 400,
                    letterSpacing: "0.02em",
                    color: "#024628",
                    textDecoration: "none",
                    background: "transparent",
                    transition:
                      "background 200ms ease, border-color 200ms ease",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  {displayAreaName(g.area_name)}
                </Link>
              ))}
            </div>
          ) : null}
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-body)",
              fontSize: 13,
              fontWeight: 300,
              color: "rgba(2,70,40,0.75)",
              lineHeight: 1.5,
            }}
          >
            Prefer picking up in person?{" "}
            <Link
              href="/store-locator"
              style={{
                color: "#024628",
                textDecoration: "underline",
                textUnderlineOffset: 3,
                fontWeight: 500,
              }}
            >
              See stockists across Vizag
            </Link>
            .
          </p>
        </section>

        {/* ── FAQ (plain HTML, no FAQPage schema) ──────────────────── */}
        <section aria-labelledby="faq-heading" style={{ margin: "0 0 32px" }}>
          <h2
            id="faq-heading"
            style={{
              margin: "0 0 14px",
              fontFamily: "var(--font-heading)",
              fontSize: 22,
              fontWeight: 400,
              color: "#024628",
              letterSpacing: "0.01em",
            }}
          >
            Frequently asked
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {FAQ.map((qa, i) => (
              <div key={i}>
                <h3
                  style={{
                    margin: "0 0 4px",
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#024628",
                    letterSpacing: "0.01em",
                  }}
                >
                  {qa.q}
                </h3>
                <p
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    fontWeight: 400,
                    color: "#024628",
                    lineHeight: 1.55,
                    letterSpacing: "0.01em",
                  }}
                >
                  {qa.a}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA block ────────────────────────────────────────────── */}
        <section
          aria-label="Start or manage your subscription"
          style={{
            background: "#024628",
            border: `0.5px solid rgba(${GOLD},0.45)`,
            borderRadius: 12,
            padding: "24px 22px",
            margin: "0 0 24px",
            color: "#FBF3D4",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-heading)",
              fontSize: 22,
              fontWeight: 400,
              letterSpacing: "0.01em",
              color: "#FBF3D4",
            }}
          >
            Ready when you are.
          </p>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 300,
              color: "rgba(251,243,212,0.85)",
              letterSpacing: "0.01em",
              lineHeight: 1.55,
            }}
          >
            The setup takes under two minutes. Bakes to your dates, delivered
            to your door in Vizag. Questions? Call us on{" "}
            <a
              href={`tel:${CADIEUX_PHONE_DIAL}`}
              aria-label={`Call Cadieux at ${ADMIN_PHONE}`}
              style={{
                color: "#FBF3D4",
                textDecoration: "underline",
                textUnderlineOffset: 3,
                fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {ADMIN_PHONE}
            </a>
            .
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              marginTop: 6,
            }}
          >
            {preorderMode ? (
              <span
                aria-disabled="true"
                title="Subscriptions open once daily deliveries begin. Reserve a single loaf now to be first in line."
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: "#FBF3D4",
                  color: "#024628",
                  border: "1px solid #FBF3D4",
                  borderRadius: 999,
                  padding: "12px 22px",
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.25em",
                  textTransform: "uppercase",
                  opacity: 0.55,
                  cursor: "not-allowed",
                  userSelect: "none",
                }}
              >
                Start your subscription
                <span aria-hidden="true" style={{ fontSize: 13, lineHeight: 1 }}>
                  →
                </span>
              </span>
            ) : (
              <Link
                href="/subscriptions/setup"
                className="cdx-subscribe-primary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: "#FBF3D4",
                  color: "#024628",
                  border: "1px solid #FBF3D4",
                  borderRadius: 999,
                  padding: "12px 22px",
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.25em",
                  textTransform: "uppercase",
                  textDecoration: "none",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                Start your subscription
                <span aria-hidden="true" style={{ fontSize: 13, lineHeight: 1 }}>
                  →
                </span>
              </Link>
            )}
            <Link
              href="/subscription"
              className="cdx-subscribe-secondary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "transparent",
                color: `rgba(${GOLD},0.95)`,
                border: `1px solid rgba(${GOLD},0.5)`,
                borderRadius: 999,
                padding: "12px 22px",
                fontFamily: "var(--font-body)",
                fontSize: 11,
                fontWeight: 400,
                letterSpacing: "0.25em",
                textTransform: "uppercase",
                textDecoration: "none",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Manage your plans
            </Link>
          </div>
        </section>

        {/* Cross-link back to shop for buyers still deciding. Kept as
            a soft line, not a card, so the CTA above stays the primary
            action. Product URLs go through toUrlSlug() so this always
            emits the canonical /shop/plain-protein-bread and
            /shop/multigrain-protein-bread slugs (Prompts 4+5). */}
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-body)",
            fontSize: 13,
            fontWeight: 300,
            color: "rgba(2,70,40,0.75)",
            lineHeight: 1.5,
          }}
        >
          Want to try one loaf first? Browse{" "}
          <Link
            href={`/shop/${toUrlSlug("multigrain")}`}
            style={{
              color: "#024628",
              textDecoration: "underline",
              textUnderlineOffset: 3,
              fontWeight: 500,
            }}
          >
            multigrain
          </Link>{" "}
          or{" "}
          <Link
            href={`/shop/${toUrlSlug("high-protein")}`}
            style={{
              color: "#024628",
              textDecoration: "underline",
              textUnderlineOffset: 3,
              fontWeight: 500,
            }}
          >
            plain
          </Link>
          .
        </p>
      </div>

      <style>{`
        .cdx-area-chip:hover {
          background: rgba(2,70,40,0.06) !important;
          border-color: rgba(2,70,40,0.55) !important;
        }
        .cdx-area-chip:focus-visible {
          outline: 2px solid rgba(2,70,40,0.9);
          outline-offset: 2px;
        }
        .cdx-subscribe-primary:hover {
          background: #ffffff !important;
        }
        .cdx-subscribe-primary:focus-visible,
        .cdx-subscribe-secondary:focus-visible {
          outline: 2px solid rgba(${GOLD},0.9);
          outline-offset: 2px;
        }
        .cdx-subscribe-secondary:hover {
          background: rgba(${GOLD},0.1) !important;
          border-color: rgba(${GOLD},0.85) !important;
          color: #FBF3D4 !important;
        }
      `}</style>
    </div>
  );
}

// ── Plan card ──────────────────────────────────────────────────────────

function PlanCard({ plan }: { plan: SubscriptionPlanDTO }) {
  const savings = plan.subscription_savings_inr;
  const pct = plan.subscription_discount_pct;
  const showStrike = plan.mrp_inr > plan.price;
  return (
    <div
      style={{
        background: "#024628",
        border: `0.5px solid rgba(${GOLD},0.45)`,
        borderRadius: 12,
        padding: "18px 20px",
        color: "#FBF3D4",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--font-heading)",
            fontSize: 20,
            fontWeight: 400,
            color: "#FBF3D4",
            letterSpacing: "0.01em",
          }}
        >
          {plan.title}
        </h3>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          {showStrike ? (
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 13,
                color: "rgba(251,243,212,0.55)",
                textDecoration: "line-through",
              }}
            >
              ₹{fmtMoney(plan.mrp_inr)}
            </span>
          ) : null}
          <span
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 16,
              fontWeight: 500,
              color: "#FBF3D4",
            }}
          >
            ₹{fmtMoney(plan.price)}
          </span>
        </div>
      </div>
      {plan.blurb ? (
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-body)",
            fontSize: 13,
            fontWeight: 300,
            color: "rgba(251,243,212,0.75)",
            lineHeight: 1.5,
          }}
        >
          {plan.blurb}
        </p>
      ) : null}
      {savings > 0 ? (
        <p
          style={{
            margin: "4px 0 0",
            fontFamily: "var(--font-body)",
            fontSize: 12,
            fontWeight: 400,
            color: `rgba(${GOLD},0.9)`,
            letterSpacing: "0.02em",
          }}
        >
          You save ₹{fmtMoney(savings)}
          {pct > 0 ? ` (${pct}%)` : ""} per loaf
        </p>
      ) : null}
    </div>
  );
}

// ── FAQ content ────────────────────────────────────────────────────────
// Plain data, rendered as headings + paragraphs. No FAQPage schema on
// purpose — Google deprecated FAQ rich results in May 2026, and the
// standing SEO backlog forbids emitting it.

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "How does the subscription work?",
    a: "You pick your loaves, your dates and a delivery slot for each date in one flow. Every plan runs on the dates you selected — there is no auto-renewal and no surprise deliveries.",
  },
  {
    q: "What is the minimum?",
    a: "Two loaves per delivery, in any combination of multigrain and plain. Frequency is up to you — a single-delivery plan is fine.",
  },
  {
    q: "Can I edit, pause, or cancel a plan?",
    a: "Yes. Each delivery on a plan can be rescheduled, moved to a different slot, or cancelled up to twelve hours before the slot. Whole plans can be cancelled from your account.",
  },
  {
    q: "When do you deliver?",
    a: "Every day of the week, in 30-minute slots between 7:30 AM and 9:00 PM IST, except the 1–2 PM kitchen lunch.",
  },
  {
    q: "Where do you deliver?",
    a: "Across serviceable pincodes in Visakhapatnam. The delivery pages linked above cover each area we cover today.",
  },
];
