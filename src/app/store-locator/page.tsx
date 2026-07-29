import Link from "next/link";
import ScrollReveal from "@/components/ScrollReveal";
import { RETAILERS } from "@/lib/data";
import { ADMIN_PHONE } from "@/lib/delivery-slots";
import StoreLocatorSearch from "./StoreLocatorSearch";

// Dial form of the standardised NAP phone — no spaces, for tel: hrefs.
// Derived from ADMIN_PHONE so a single-source update propagates. Do NOT
// hardcode the number here; the whole point of NAP consistency is one
// source of truth for the business phone (see Prompt 6 work).
const CADIEUX_PHONE_DIAL = ADMIN_PHONE.replace(/\s/g, "");

const GRAIN = "url(/grain.svg)";
const GOLD = "251,243,212";

// Deterministic anchor slug per area — used by the search island to scroll
// the picked area into view, and gives each area a stable in-page permalink.
function areaSlug(area: string) {
  return `area-${area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

// RETAILERS-key → /delivery/[area] slug (Prompt 8). Only areas that have
// BOTH a stockist row AND a service_areas row with a populated slug get
// a link. Deliberately explicit rather than fuzzy-matched — the two sets
// have no shared join key. Missing entries render without a link (the
// area section is still visible, just without an "In-area delivery" CTA).
const DELIVERY_PAGE_BY_RETAILER_AREA: Record<string, string> = {
  "MVP Colony": "mvp-colony",
  "Madhurawada / P.M. Palem": "madhurawada",
};

// Universal Google Maps directions URL — opens the Maps app on iOS/Android
// when installed, otherwise google.com/maps in the browser. Uses a name +
// address query so Google geocodes the actual storefront (no guessed coords).
function directionsUrl(name: string, address: string) {
  const dest = encodeURIComponent(`${name}, ${address}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}

// Server component. The stockist list is rendered in initial HTML — every
// area heading, retailer name, address, and hours ships to crawlers on the
// first response. The only client-side surface is <StoreLocatorSearch />,
// which layers a type-ahead + scroll-to-area affordance on top of the SSR
// content. If JS is off, the list is still fully browsable.
export default function StoreLocatorPage() {
  const areas = Object.keys(RETAILERS);

  return (
    <div style={{ minHeight: "100dvh", background: "#C0C8CE", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.04, mixBlendMode: "multiply", pointerEvents: "none", zIndex: 0 }} />

      {/* Back link */}
      <Link href="/" style={{
        position: "fixed", top: "calc(24px + env(safe-area-inset-top))", left: "calc(20px + env(safe-area-inset-left))", zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#024628", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(24px,6vw,80px) 120px", maxWidth: 720, margin: "0 auto" }}>
        <ScrollReveal>
          <h1 data-stagger style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(36px,8vw,64px)", fontWeight: 300,
            color: "#024628", letterSpacing: "0.02em", lineHeight: 1.05,
          }}>
            Where to find Cadieux in Visakhapatnam
          </h1>
        </ScrollReveal>

        <p style={{
          margin: "0 0 20px",
          fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200,
          letterSpacing: "0.3em", textTransform: "uppercase",
          color: "rgba(2,70,40,0.75)",
        }}>
          Stores we supply across Vizag
        </p>

        {/* Cadieux contact block — one real, callable number that matches
            our LocalBusiness schema + Google Business Profile. Deliberately
            NOT per-retailer: chain-store switchboards can't answer stock
            questions about our bread. Number is imported from the NAP
            constant so it stays in sync with the standardised business
            phone. */}
        <p style={{
          margin: "0 0 24px",
          fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 400,
          color: "#024628", lineHeight: 1.5,
          letterSpacing: "0.01em",
        }}>
          Not sure if your store has stock today? Call us on{" "}
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
          >{ADMIN_PHONE}</a>{" "}
          and we will tell you.
        </p>

        <StoreLocatorSearch
          areas={areas.map((area) => ({
            name: area,
            slug: areaSlug(area),
            stores: RETAILERS[area].map((r) => ({ name: r.name, address: r.address })),
          }))}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {areas.map((area) => {
            const retailers = RETAILERS[area];
            const slug = areaSlug(area);
            const deliverySlug = DELIVERY_PAGE_BY_RETAILER_AREA[area];
            return (
              <section
                key={area}
                id={slug}
                aria-labelledby={`${slug}-heading`}
                style={{ scrollMarginTop: 24 }}
              >
                {/* Area header — always rendered, no accordion. */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 12,
                  background: "#024628",
                  border: `0.5px solid rgba(${GOLD},0.45)`,
                  borderRadius: 12,
                  padding: "16px 20px",
                  color: "#FBF3D4",
                }}>
                  <h2 id={`${slug}-heading`} style={{
                    flex: 1, margin: 0,
                    fontFamily: "var(--font-heading)",
                    fontSize: 20, fontWeight: 400,
                    color: "#FBF3D4",
                    letterSpacing: "0.01em",
                  }}>{area}</h2>
                  <span style={{
                    fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                    color: "rgba(251,243,212,0.6)",
                    letterSpacing: "0.15em", textTransform: "uppercase",
                  }}>{retailers.length} stores</span>
                </div>

                {/* Prompt 8 — cross-link to the /delivery/[area] page when
                    a mapping exists. Rendered right below the area header so
                    a visitor scrolled to this anchor sees the delivery CTA
                    before scanning the stockist list. Rows without a mapping
                    render nothing here (no placeholder). */}
                {deliverySlug ? (
                  <p style={{
                    margin: "8px 0 0",
                    paddingLeft: 20,
                    fontFamily: "var(--font-body)",
                    fontSize: 12,
                    fontWeight: 400,
                    color: "rgba(2,70,40,0.85)",
                    letterSpacing: "0.02em",
                    lineHeight: 1.5,
                  }}>
                    <Link
                      href={`/delivery/${deliverySlug}`}
                      style={{
                        color: "#024628",
                        textDecoration: "underline",
                        textUnderlineOffset: 3,
                        fontWeight: 500,
                      }}
                    >
                      Fresh delivery in {area}
                    </Link>
                    {" "}— pincodes and details.
                  </p>
                ) : null}

                <div style={{ paddingLeft: 20, paddingTop: 8 }}>
                  {retailers.map((r, i) => (
                    <article
                      key={`${area}-${i}`}
                      style={{
                        background: "#024628",
                        border: `0.25px solid rgba(${GOLD},0.35)`,
                        borderRadius: 10,
                        padding: "14px 18px",
                        margin: "8px 0",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <p style={{
                        margin: 0,
                        fontFamily: "var(--font-body)",
                        fontSize: 14, fontWeight: 400,
                        color: "#FBF3D4",
                        letterSpacing: "0.02em",
                      }}>{r.name}</p>
                      <p style={{
                        margin: 0,
                        fontFamily: "var(--font-body)",
                        fontSize: 11, fontWeight: 300,
                        color: "rgba(251,243,212,0.7)",
                        letterSpacing: "0.04em",
                        lineHeight: 1.5,
                      }}>{r.address}</p>

                      {/* No hours line and no CALL button until verified
                          per-outlet phone + posted opening hours are in
                          hand. Placeholder contact info on a public local
                          page hurts trust and local SEO — see the note on
                          the Retailer type. */}
                      <div style={{
                        display: "flex", justifyContent: "flex-end",
                        gap: 8, marginTop: 8,
                      }}>
                        <a
                          href={directionsUrl(r.name, r.address)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Get directions to ${r.name}`}
                          className="cdx-locator-btn"
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 6,
                            background: "transparent",
                            border: `1px solid rgba(${GOLD},0.5)`,
                            borderRadius: 6,
                            padding: "8px 14px",
                            fontFamily: "var(--font-body)",
                            fontSize: 10, fontWeight: 400,
                            letterSpacing: "0.25em", textTransform: "uppercase",
                            color: `rgba(${GOLD},0.95)`,
                            textDecoration: "none",
                            transition: "background 200ms ease, border-color 200ms ease, color 200ms ease",
                            WebkitTapHighlightColor: "transparent",
                          }}
                        >
                          <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>↗</span>
                          Directions
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <style>{`
        .cdx-locator-btn:hover {
          background: rgba(${GOLD},0.1) !important;
          border-color: rgba(${GOLD},0.85) !important;
          color: #FBF3D4 !important;
        }
        .cdx-locator-btn:focus-visible {
          outline: 2px solid rgba(${GOLD},0.9);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
