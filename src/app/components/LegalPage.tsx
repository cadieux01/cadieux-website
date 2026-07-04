import Link from "next/link";

// Shared chrome for Termly-generated legal documents.
// - Reads pre-cleaned HTML at build time and injects via dangerouslySetInnerHTML.
// - Overrides Termly's hard-coded Arial / hex colours with Cadieux brand fonts
//   (DM Sans headings + body) and cream-on-walnut palette.
// - Layout: ~800 px max-width column, generous padding, "Back to Home" link.
type Props = {
  title: string;
  html: string;
  /** Optional extra content rendered after the policy body (e.g. DPDP block). */
  children?: React.ReactNode;
};

export default function LegalPage({ title, html, children }: Props) {
  return (
    <main className="legal-page">
      <div className="legal-page__inner">
        <Link href="/" className="legal-page__back">
          ← Back to Home
        </Link>

        <h1 className="legal-page__title">{title}</h1>

        <article
          className="legal-page__body"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {children}
      </div>

      <style>{`
        .legal-page {
          min-height: 100vh;
          padding: 4rem 1.5rem 6rem;
          color: var(--color-cream);
        }
        .legal-page__inner {
          max-width: 800px;
          margin: 0 auto;
        }
        .legal-page__back {
          display: inline-block;
          font-family: var(--font-body);
          font-size: 0.75rem;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          color: rgba(192,200,206,0.75);
          text-decoration: none;
          margin-bottom: 3rem;
          transition: color 200ms ease;
        }
        .legal-page__back:hover {
          color: var(--color-cream);
        }
        .legal-page__title {
          font-family: var(--font-heading);
          font-weight: 300;
          font-size: clamp(2.4rem, 5vw, 3.6rem);
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--color-cream);
          margin: 0 0 2.5rem;
          line-height: 1.1;
        }

        /* ---- Termly content overrides ---- */
        /* Termly emits [data-custom-class='...'] selectors with !important on
           font-family, color, font-size. We mirror those selectors and override
           them here so the brand palette wins. */
        .legal-page__body [data-custom-class='body'],
        .legal-page__body [data-custom-class='body'] * {
          background: transparent !important;
        }
        .legal-page__body [data-custom-class='title'],
        .legal-page__body [data-custom-class='title'] *,
        .legal-page__body h1 {
          font-family: var(--font-heading) !important;
          font-weight: 300 !important;
          color: var(--color-cream) !important;
          letter-spacing: 0.04em !important;
        }
        /* Termly's original H1 sits at the top of each doc — we render our own
           page title above it, so hide the duplicate. */
        .legal-page__body [data-custom-class='title'] {
          display: none !important;
        }
        .legal-page__body [data-custom-class='subtitle'],
        .legal-page__body [data-custom-class='subtitle'] * {
          font-family: var(--font-body) !important;
          color: rgba(192,200,206,0.6) !important;
          font-size: 0.8rem !important;
          letter-spacing: 0.15em !important;
          text-transform: uppercase !important;
        }
        .legal-page__body [data-custom-class='heading_1'],
        .legal-page__body [data-custom-class='heading_1'] *,
        .legal-page__body h2 {
          font-family: var(--font-heading) !important;
          font-weight: 400 !important;
          font-size: clamp(1.5rem, 3vw, 1.9rem) !important;
          color: var(--color-cream) !important;
          letter-spacing: 0.04em !important;
          margin: 2.5rem 0 1rem !important;
          line-height: 1.25 !important;
        }
        .legal-page__body [data-custom-class='heading_2'],
        .legal-page__body [data-custom-class='heading_2'] *,
        .legal-page__body h3 {
          font-family: var(--font-heading) !important;
          font-weight: 400 !important;
          font-size: 1.25rem !important;
          color: var(--color-cream) !important;
          letter-spacing: 0.03em !important;
          margin: 1.75rem 0 0.75rem !important;
          line-height: 1.3 !important;
        }
        .legal-page__body [data-custom-class='body_text'],
        .legal-page__body [data-custom-class='body_text'] *,
        .legal-page__body p,
        .legal-page__body li,
        .legal-page__body td,
        .legal-page__body th {
          font-family: var(--font-body) !important;
          font-weight: 300 !important;
          color: rgba(192,200,206,0.82) !important;
          font-size: 0.95rem !important;
          line-height: 1.75 !important;
          letter-spacing: 0.01em !important;
        }
        .legal-page__body strong,
        .legal-page__body b {
          color: var(--color-cream) !important;
          font-weight: 500 !important;
        }
        .legal-page__body [data-custom-class='link'],
        .legal-page__body [data-custom-class='link'] *,
        .legal-page__body a {
          font-family: var(--font-body) !important;
          color: #c9a96e !important;
          text-decoration: underline;
          text-underline-offset: 0.2em;
          word-break: break-word;
        }
        .legal-page__body a:hover {
          color: var(--color-cream) !important;
        }
        .legal-page__body ul,
        .legal-page__body ol {
          padding-left: 1.4rem;
          margin: 0.75rem 0 1.25rem;
        }
        .legal-page__body li {
          margin-bottom: 0.4rem;
        }
        .legal-page__body table {
          border-collapse: collapse;
          width: 100%;
          margin: 1.25rem 0;
          font-size: 0.9rem;
        }
        .legal-page__body th,
        .legal-page__body td {
          border: 1px solid rgba(192,200,206,0.18) !important;
          padding: 0.6rem 0.75rem !important;
          text-align: left !important;
        }
        .legal-page__body th {
          background: rgba(2,70,40,0.25) !important;
          color: var(--color-cream) !important;
          font-weight: 500 !important;
        }
        .legal-page__body hr {
          border: 0;
          border-top: 1px solid rgba(192,200,206,0.15);
          margin: 2rem 0;
        }

        @media (max-width: 600px) {
          .legal-page {
            padding: 2.5rem 1.25rem 4rem;
          }
          .legal-page__back {
            margin-bottom: 2rem;
          }
          .legal-page__title {
            margin-bottom: 1.75rem;
          }
        }
      `}</style>
    </main>
  );
}
