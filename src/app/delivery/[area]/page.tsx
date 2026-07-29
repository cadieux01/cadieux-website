// Prompt 8 — local SEO landing pages at /delivery/[area].
//
// One page per row in public.service_areas that has a populated slug
// (see src/lib/service-areas.ts::getServiceAreaGroups). Rendered as a
// server component so every fact — pincodes, stockists, contact number,
// product links — is in the initial HTML for crawlers and no-JS users.
//
// Data policy (guardrails set by the SEO backlog):
//   • Delivery WINDOW is city-wide — one fact for every area, sourced
//     directly from src/lib/delivery-slots.ts. No per-area column, no
//     placeholder copy.
//   • Stockists are drawn from RETAILERS in src/lib/data.ts (same
//     source as /store-locator). Not every service area has stockists
//     yet — those pages omit the block entirely.
//   • No FAQPage schema, no aggregateRating, no nutrition figures,
//     no invented "opening hours" or freshness claims.
//   • local_note is admin-written copy. If null, the paragraph is
//     omitted (no placeholder).
//   • Product links go through toUrlSlug() so they always point to
//     the canonical URL-slug form (Prompts 4+5).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RETAILERS } from "@/lib/data";
import { ADMIN_PHONE } from "@/lib/delivery-slots";
import { toUrlSlug } from "@/lib/product-slugs";
import {
  displayAreaName,
  getServiceAreaBySlug,
  getServiceAreaGroups,
} from "@/lib/service-areas";

const SITE_URL = "https://www.cadieux.in";
const GRAIN = "url(/grain.svg)";
const GOLD = "251,243,212";

// Regenerate at most once an hour — content is admin-edited on a
// slow cadence. Revalidation tag "service-areas" flushes this + the
// checkout lookups together when admin updates a row.
export const revalidate = 3600;

// Static list of URL-visible service-area slugs → RETAILERS keys.
// Explicit, hand-mapped — the two sets have no shared join key and
// fuzzy matching would misfile stockists onto the wrong area page.
// Slugs not in this map render without a "Also stocked at" block.
const STOCKISTS_BY_SLUG: Record<string, string[]> = {
  madhurawada: ["Madhurawada / P.M. Palem"],
  "mvp-colony": ["MVP Colony"],
  // Pothinamallayya Palem (P.M. Palem) is grouped with Madhurawada in
  // RETAILERS — same two nearby stockists apply.
  "pothinamallayya-palem": ["Madhurawada / P.M. Palem"],
};

// Universal Google Maps directions URL — mirrors /store-locator so
// tap behaviour is identical (opens Maps app on mobile, google.com/maps
// on desktop). No coordinates guessed; Google geocodes the storefront.
function directionsUrl(name: string, address: string): string {
  const dest = encodeURIComponent(`${name}, ${address}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}

// Dial form of ADMIN_PHONE — matches /store-locator so LocalBusiness
// NAP consistency is preserved across every page that renders a phone.
const CADIEUX_PHONE_DIAL = ADMIN_PHONE.replace(/\s/g, "");

// Full delivery-window fact. Derived from SLOT_START/SLOT_END + the
// lunch break in delivery-slots.ts, kept as a single sentence so the
// whole page reads as one story. Update in ONE place if slot hours
// change — this string only. No per-area override.
const DELIVERY_WINDOW_TEXT =
  "Fresh delivery daily, 7:30 AM to 9:00 PM IST, except 1–2 PM.";

export async function generateStaticParams() {
  const groups = await getServiceAreaGroups();
  return groups.map((g) => ({ area: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { area: string };
}): Promise<Metadata> {
  const group = await getServiceAreaBySlug(params.area);
  if (!group) {
    return {
      title: "Delivery area not found",
      description: "This delivery area is not available.",
    };
  }
  const name = displayAreaName(group.area_name);
  const title = `Cadieux Protein Bread Delivery in ${name}, Visakhapatnam`;
  // Meta description kept under 160 chars. Avoid duplicating "Fresh" —
  // the loaf is described as slow-fermented; delivery is described as
  // daily with the citywide window.
  const description = `Slow-fermented protein bread delivered in ${name}. Delivered daily, 7:30 AM to 9:00 PM IST, except 1–2 PM. Serving pincode ${group.pincodes.join(", ")}.`;
  return {
    title,
    description,
    alternates: { canonical: `/delivery/${group.slug}` },
    openGraph: {
      type: "website",
      url: `${SITE_URL}/delivery/${group.slug}`,
      title,
      description,
      images: [{ url: `${SITE_URL}/og-cover.jpg` }],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function DeliveryAreaPage({
  params,
}: {
  params: { area: string };
}) {
  const group = await getServiceAreaBySlug(params.area);
  if (!group) notFound();

  const name = displayAreaName(group.area_name);
  const stockistKeys = STOCKISTS_BY_SLUG[group.slug] ?? [];
  const stockists = stockistKeys.flatMap((k) => RETAILERS[k] ?? []);

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
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(32px,7vw,56px)",
            fontWeight: 300,
            color: "#024628",
            letterSpacing: "0.02em",
            lineHeight: 1.05,
          }}
        >
          Cadieux protein bread delivery in {name}
        </h1>

        <p
          style={{
            margin: "0 0 28px",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 200,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(2,70,40,0.75)",
          }}
        >
          Visakhapatnam
        </p>

        {/* Admin-written local paragraph. Omitted entirely when null —
            we never render placeholder or "coming soon" copy. */}
        {group.local_note ? (
          <p
            style={{
              margin: "0 0 28px",
              fontFamily: "var(--font-body)",
              fontSize: 16,
              fontWeight: 400,
              color: "#024628",
              lineHeight: 1.6,
            }}
          >
            {group.local_note}
          </p>
        ) : null}

        {/* Pincode + delivery window facts. Rendered together — both
            come from server state and are the two things a customer
            searches to check. */}
        <section
          aria-labelledby="delivery-facts-heading"
          style={{
            background: "#024628",
            border: `0.5px solid rgba(${GOLD},0.45)`,
            borderRadius: 12,
            padding: "20px 22px",
            marginBottom: 28,
            color: "#FBF3D4",
          }}
        >
          <h2
            id="delivery-facts-heading"
            style={{
              margin: "0 0 14px",
              fontFamily: "var(--font-body)",
              fontSize: 11,
              fontWeight: 300,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: `rgba(${GOLD},0.7)`,
            }}
          >
            Where and when
          </h2>

          <p
            style={{
              margin: "0 0 10px",
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 400,
              color: "#FBF3D4",
              lineHeight: 1.55,
            }}
          >
            <span style={{ fontWeight: 500 }}>
              {group.pincodes.length === 1 ? "Pincode" : "Pincodes"}:
            </span>{" "}
            {group.pincodes.join(", ")}
          </p>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 400,
              color: "#FBF3D4",
              lineHeight: 1.55,
            }}
          >
            <span style={{ fontWeight: 500 }}>Delivery window:</span>{" "}
            {DELIVERY_WINDOW_TEXT}
          </p>
        </section>

        {/* Cadieux contact block — one number, imported from ADMIN_PHONE
            so /delivery, /store-locator, and LocalBusiness schema all
            speak the same NAP. */}
        <section
          aria-labelledby="contact-heading"
          style={{ marginBottom: 28 }}
        >
          <h2
            id="contact-heading"
            style={{
              margin: "0 0 10px",
              fontFamily: "var(--font-body)",
              fontSize: 11,
              fontWeight: 300,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: "rgba(2,70,40,0.75)",
            }}
          >
            Order from Cadieux
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
            Place an order for delivery to {name} on our{" "}
            <Link
              href={`/shop/${toUrlSlug("high-protein")}`}
              style={{
                color: "#024628",
                textDecoration: "underline",
                textUnderlineOffset: 3,
                fontWeight: 500,
              }}
            >
              Plain Protein Bread
            </Link>{" "}
            or{" "}
            <Link
              href={`/shop/${toUrlSlug("multigrain")}`}
              style={{
                color: "#024628",
                textDecoration: "underline",
                textUnderlineOffset: 3,
                fontWeight: 500,
              }}
            >
              Multigrain Protein Bread
            </Link>{" "}
            pages. Questions? Call us on{" "}
            <a
              href={`tel:${CADIEUX_PHONE_DIAL}`}
              aria-label={`Call Cadieux at ${ADMIN_PHONE}`}
              style={{
                color: "#024628",
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
        </section>

        {/* Stockists — SSR'd only when the slug is mapped AND the
            RETAILERS lookup returns ≥1 store. Otherwise the whole
            section is omitted. No placeholder, no "coming soon". */}
        {stockists.length > 0 ? (
          <section aria-labelledby="stockists-heading" style={{ marginBottom: 28 }}>
            <h2
              id="stockists-heading"
              style={{
                margin: "0 0 12px",
                fontFamily: "var(--font-body)",
                fontSize: 11,
                fontWeight: 300,
                letterSpacing: "0.25em",
                textTransform: "uppercase",
                color: "rgba(2,70,40,0.75)",
              }}
            >
              Also stocked at
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {stockists.map((r, i) => (
                <article
                  key={`${group.slug}-stockist-${i}`}
                  style={{
                    background: "#024628",
                    border: `0.25px solid rgba(${GOLD},0.35)`,
                    borderRadius: 10,
                    padding: "14px 18px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontFamily: "var(--font-body)",
                      fontSize: 14,
                      fontWeight: 400,
                      color: "#FBF3D4",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {r.name}
                  </p>
                  <p
                    style={{
                      margin: 0,
                      fontFamily: "var(--font-body)",
                      fontSize: 11,
                      fontWeight: 300,
                      color: "rgba(251,243,212,0.7)",
                      letterSpacing: "0.04em",
                      lineHeight: 1.5,
                    }}
                  >
                    {r.address}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginTop: 6,
                    }}
                  >
                    <a
                      href={directionsUrl(r.name, r.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Get directions to ${r.name}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: "transparent",
                        border: `1px solid rgba(${GOLD},0.5)`,
                        borderRadius: 6,
                        padding: "8px 14px",
                        fontFamily: "var(--font-body)",
                        fontSize: 10,
                        fontWeight: 400,
                        letterSpacing: "0.25em",
                        textTransform: "uppercase",
                        color: `rgba(${GOLD},0.95)`,
                        textDecoration: "none",
                      }}
                    >
                      <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>
                        ↗
                      </span>
                      Directions
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {/* Back-link to store-locator — every page carries one, so a
            visitor arriving from search can browse the full network. */}
        <p
          style={{
            margin: "8px 0 0",
            fontFamily: "var(--font-body)",
            fontSize: 12,
            fontWeight: 400,
            color: "rgba(2,70,40,0.8)",
            letterSpacing: "0.02em",
            lineHeight: 1.5,
          }}
        >
          Looking for a specific store?{" "}
          <Link
            href="/store-locator"
            style={{
              color: "#024628",
              textDecoration: "underline",
              textUnderlineOffset: 3,
              fontWeight: 500,
            }}
          >
            See every stockist in Visakhapatnam
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
