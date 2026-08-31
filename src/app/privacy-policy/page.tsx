import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import LegalPage from "@/app/components/LegalPage";

// Statically generate at build time — the source HTML lives outside the
// Next.js routing tree (project-root /policies-raw) so we read it during build
// and embed the markup in the rendered page. No filesystem access at runtime.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Privacy Policy | Cadieux",
  description:
    "How Cadieux collects, uses, and protects your personal information.",
  alternates: { canonical: "/privacy-policy" },
};

const html = fs.readFileSync(
  path.join(process.cwd(), "policies-raw", "privacy-policy.html"),
  "utf8",
);

export default function PrivacyPolicyPage() {
  return (
    <LegalPage title="Privacy Policy" html={html}>
      {/* Anchor section appended after the Termly body. References the DPDP
          Act, 2023 and our designated grievance contact, satisfying India's
          Section 10 requirement for a published data-request route. */}
      <section
        id="data-requests"
        style={{
          marginTop: "3.5rem",
          paddingTop: "2rem",
          borderTop: "1px solid rgba(192,200,206,0.15)",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 400,
            fontSize: "clamp(1.5rem, 3vw, 1.9rem)",
            letterSpacing: "0.04em",
            color: "var(--color-cream)",
            margin: "0 0 1rem",
          }}
        >
          Data Requests &amp; Grievance Officer
        </h2>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontWeight: 300,
            color: "rgba(192,200,206,0.82)",
            fontSize: "1rem",
            lineHeight: 1.75,
            letterSpacing: "0.01em",
            margin: "0 0 1rem",
          }}
        >
          In accordance with the{" "}
          <strong style={{ color: "var(--color-cream)", fontWeight: 500 }}>
            Digital Personal Data Protection Act, 2023
          </strong>{" "}
          (DPDP Act), you have the right to access, correct, update, or request
          deletion of the personal data we hold about you, and to withdraw any
          consent you have previously given. You may also nominate another
          individual to exercise these rights on your behalf.
        </p>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontWeight: 300,
            color: "rgba(192,200,206,0.82)",
            fontSize: "1rem",
            lineHeight: 1.75,
            letterSpacing: "0.01em",
            margin: "0 0 1rem",
          }}
        >
          To make a data request or raise a grievance, please contact our
          designated Grievance Officer:
        </p>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontWeight: 300,
            color: "rgba(192,200,206,0.82)",
            fontSize: "1rem",
            lineHeight: 1.75,
            letterSpacing: "0.01em",
            margin: "0 0 1rem",
          }}
        >
          <strong style={{ color: "var(--color-cream)", fontWeight: 500 }}>
            Sunny Raj
          </strong>
          <br />
          Grievance Officer, Cadieux (Core Element)
          <br />
          Email:{" "}
          <a
            href="mailto:sunny@cadieux.in"
            style={{
              fontFamily: "var(--font-body)",
              color: "#024628",
              textDecoration: "underline",
              textUnderlineOffset: "0.2em",
            }}
          >
            sunny@cadieux.in
          </a>
        </p>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontWeight: 300,
            color: "rgba(192,200,206,0.82)",
            fontSize: "1rem",
            lineHeight: 1.75,
            letterSpacing: "0.01em",
            margin: 0,
          }}
        >
          We will acknowledge your request within a reasonable period and
          respond within the timelines required under the DPDP Act and its
          subsidiary rules.
        </p>
      </section>
    </LegalPage>
  );
}
