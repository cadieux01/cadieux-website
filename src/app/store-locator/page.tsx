import Link from "next/link";
import ScrollReveal from "@/components/ScrollReveal";
import { ADMIN_PHONE } from "@/lib/delivery-slots";
import {
  getActiveLocations,
  slugifyArea,
  type PickupLocationRow,
  type PickupLocationType,
} from "@/lib/pickup-locations";
import StoreLocatorSearch from "./StoreLocatorSearch";

// Render at request time so we don't try to prerender against
// pickup_locations at build (and so the admin-CRUD revalidateTag
// takedown flows through the same cache path as /find-us and the
// public /api/locations endpoint — one source of truth).
export const dynamic = "force-dynamic";

// Dial form of the standardised NAP phone — no spaces, for tel: hrefs.
// Derived from ADMIN_PHONE so a single-source update propagates. Do NOT
// hardcode the number here; the whole point of NAP consistency is one
// source of truth for the business phone (see Prompt 6 work).
const CADIEUX_PHONE_DIAL = ADMIN_PHONE.replace(/\s/g, "");

const GRAIN = "url(/grain.svg)";
const GOLD = "251,243,212";

// Deterministic anchor slug per area — used by the search island to scroll
// the picked area into view, and gives each area a stable in-page permalink.
function areaAnchor(area: string) {
  return `area-${slugifyArea(area)}`;
}

// Service-area slug → /delivery/[area] mapping. Kept implicit via
// slugifyArea() — any pickup_locations.area whose slug matches a
// live service-area slug gets a "Fresh delivery in {area}" cross-link
// under its area header. If a customer-facing delivery page doesn't
// exist for that slug, the link is simply omitted.
const DELIVERY_AREA_SLUGS = new Set<string>([
  "kurmana-palem",
  "maddilapalem",
  "madhurawada",
  "mvp-colony",
  "nad-junction",
  "pothinamallayya-palem",
]);

// Mirror the /find-us type-label mapping so a customer sees the same
// vocabulary on both surfaces. DB enum stays kitchen|stall|partner_pickup;
// only the string presented in the UI is friendly.
function typeLabel(type: PickupLocationType): string {
  if (type === "kitchen") return "Store";
  if (type === "stall") return "Stall";
  return "Other Place";
}

// Universal Google Maps directions URL. Prefers `google_place_id` when
// admin has attached one (higher accuracy — Google routes to the exact
// storefront pin instead of geocoding a name+address string). Falls back
// to a name + address query.
function directionsUrl(row: PickupLocationRow): string {
  const dest = encodeURIComponent(`${row.name}, ${row.address}`);
  const base = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
  return row.google_place_id
    ? `${base}&destination_place_id=${encodeURIComponent(row.google_place_id)}`
    : base;
}

// Server component. The stockist list is rendered in initial HTML — every
// area heading, location name, and address ships to crawlers on the first
// response. The only client-side surface is <StoreLocatorSearch />, which
// layers a type-ahead + scroll-to-area affordance on top of the SSR
// content. If JS is off, the list is still fully browsable.
export default async function StoreLocatorPage() {
  const locations = await getActiveLocations();

  // Group by area, preserving the sort_order → name ordering already
  // baked into getActiveLocations(). Using a Map so first-seen order
  // determines area order on the page.
  const byArea = new Map<string, PickupLocationRow[]>();
  for (const row of locations) {
    const list = byArea.get(row.area) ?? [];
    list.push(row);
    byArea.set(row.area, list);
  }
  const areas = Array.from(byArea.keys());

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
          Where to pick up Cadieux across Vizag
        </p>

        {/* Cadieux contact block — one real, callable number that matches
            our LocalBusiness schema + Google Business Profile. Deliberately
            NOT per-location: chain-store switchboards can't answer stock
            questions about our bread. Number is imported from the NAP
            constant so it stays in sync with the standardised business
            phone. */}
        <p style={{
          margin: "0 0 24px",
          fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 400,
          color: "#024628", lineHeight: 1.5,
          letterSpacing: "0.01em",
        }}>
          Not sure if a location has stock today? Call us on{" "}
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

        {locations.length === 0 ? (
          // Empty state — no active pickup rows. Rendered instead of the
          // stockist list; the contact paragraph above is still shown so
          // a visitor can call to ask where to pick up.
          <div style={{
            background: "#024628",
            border: `0.5px solid rgba(${GOLD},0.45)`,
            borderRadius: 12,
            padding: "20px 22px",
            color: "#FBF3D4",
          }}>
            <p style={{
              margin: 0,
              fontFamily: "var(--font-body)",
              fontSize: 14, fontWeight: 400,
              color: "#FBF3D4",
              lineHeight: 1.55,
            }}>
              No pickup locations are live right now. Call us on{" "}
              <a
                href={`tel:${CADIEUX_PHONE_DIAL}`}
                style={{
                  color: "#FBF3D4",
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                }}
              >{ADMIN_PHONE}</a>{" "}
              for the freshest options today.
            </p>
          </div>
        ) : (
          <>
            <StoreLocatorSearch
              areas={areas.map((area) => ({
                name: area,
                slug: areaAnchor(area),
                stores: (byArea.get(area) ?? []).map((r) => ({ name: r.name, address: r.address })),
              }))}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {areas.map((area) => {
                const rows = byArea.get(area) ?? [];
                const anchor = areaAnchor(area);
                const deliverySlug = DELIVERY_AREA_SLUGS.has(slugifyArea(area))
                  ? slugifyArea(area)
                  : null;
                return (
                  <section
                    key={area}
                    id={anchor}
                    aria-labelledby={`${anchor}-heading`}
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
                      <h2 id={`${anchor}-heading`} style={{
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
                      }}>{rows.length} {rows.length === 1 ? "place" : "places"}</span>
                    </div>

                    {/* Prompt 8 — cross-link to the /delivery/[area] page when
                        a live service-area slug matches this area's slug.
                        Rendered right below the area header so a visitor
                        scrolled to this anchor sees the delivery CTA before
                        scanning the list. Areas without a live delivery
                        page render nothing here (no placeholder). */}
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
                      {rows.map((r) => (
                        <article
                          key={r.id}
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
                          <div style={{
                            display: "flex", alignItems: "center", gap: 10,
                            flexWrap: "wrap",
                          }}>
                            <p style={{
                              margin: 0,
                              fontFamily: "var(--font-body)",
                              fontSize: 14, fontWeight: 400,
                              color: "#FBF3D4",
                              letterSpacing: "0.02em",
                              flex: "1 1 auto",
                              minWidth: 0,
                            }}>{r.name}</p>
                            <span
                              aria-label={`Location type: ${typeLabel(r.type)}`}
                              style={{
                                fontFamily: "var(--font-body)",
                                fontSize: 9, fontWeight: 400,
                                letterSpacing: "0.2em", textTransform: "uppercase",
                                color: `rgba(${GOLD},0.85)`,
                                border: `1px solid rgba(${GOLD},0.4)`,
                                borderRadius: 4,
                                padding: "3px 8px",
                                flexShrink: 0,
                              }}
                            >{typeLabel(r.type)}</span>
                          </div>
                          <p style={{
                            margin: 0,
                            fontFamily: "var(--font-body)",
                            fontSize: 11, fontWeight: 300,
                            color: "rgba(251,243,212,0.7)",
                            letterSpacing: "0.04em",
                            lineHeight: 1.5,
                          }}>{r.address}</p>

                          {/* Optional admin-written notes (e.g. opening
                              window, "call before visiting"). Rendered only
                              when populated — no placeholder. */}
                          {r.notes ? (
                            <p style={{
                              margin: 0,
                              fontFamily: "var(--font-body)",
                              fontSize: 11, fontWeight: 300,
                              color: "rgba(251,243,212,0.6)",
                              letterSpacing: "0.02em",
                              lineHeight: 1.5,
                              fontStyle: "italic",
                            }}>{r.notes}</p>
                          ) : null}

                          {/* No hours line and no CALL button per outlet —
                              per-outlet hours/phones are not tracked on
                              pickup_locations. Directions button is the one
                              action every row supports. */}
                          <div style={{
                            display: "flex", justifyContent: "flex-end",
                            gap: 8, marginTop: 8,
                          }}>
                            <a
                              href={directionsUrl(r)}
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
          </>
        )}
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
