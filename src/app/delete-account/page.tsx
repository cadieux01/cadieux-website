import type { Metadata } from "next";
import LegalPage from "@/app/components/LegalPage";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Delete Your Account | Cadieux",
  description:
    "How to request deletion of your Cadieux account and associated personal data, and what we retain as required by law.",
  alternates: { canonical: "/delete-account" },
};

// ── Content constants — edit here, not in JSX ──────────────────────────
const LAST_UPDATED = "25 May 2026";

const INTRO =
  "This page explains how to request deletion of your Cadieux account and associated data, in line with our Privacy Policy.";

const HOW_ITEMS = [
  "In the app: go to the Account tab and contact support to request deletion.",
  'Or email support@cadieux.in from your registered email or phone number with the subject line \u201cDelete my account\u201d.',
  "We verify the request via your registered phone number, then process it.",
];

const DELETED_ITEMS = [
  "Your profile — name, email, phone number, and marketing preferences.",
  "Saved delivery addresses.",
  "Reviews you posted.",
  "Push notification tokens.",
];

const RETAINED_ITEMS = [
  {
    label: "Order and invoice records",
    reason:
      "Retained for 8 years as required by Indian tax law (CGST Act, Section 36), in a restricted form not linked to an active account.",
  },
  {
    label: "Marketing-consent records",
    reason:
      "Retained for up to 3 years as proof of consent under the Digital Personal Data Protection Act, 2023 (DPDP).",
  },
];

const TIMELINE =
  "Deletion requests are processed within 30 days of identity verification.";

const CONTACT = "support@cadieux.in";
// ────────────────────────────────────────────────────────────────────────

// Re-usable prose styles (injected once via <style> in the parent
// LegalPage component, so we only need inline where we diverge from it).
function Para({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: "var(--font-body)",
        fontWeight: 300,
        fontSize: "0.95rem",
        color: "rgba(192,200,206,0.82)",
        lineHeight: 1.75,
        letterSpacing: "0.01em",
        margin: "0 0 1rem",
      }}
    >
      {children}
    </p>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "var(--font-heading)",
        fontWeight: 400,
        fontSize: "clamp(1.4rem, 2.5vw, 1.75rem)",
        letterSpacing: "0.04em",
        color: "var(--color-cream)",
        margin: "2.5rem 0 0.75rem",
        lineHeight: 1.2,
      }}
    >
      {children}
    </h2>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul
      style={{
        margin: "0 0 1rem",
        paddingLeft: "1.4rem",
        fontFamily: "var(--font-body)",
        fontWeight: 300,
        fontSize: "0.95rem",
        color: "rgba(192,200,206,0.82)",
        lineHeight: 1.75,
        letterSpacing: "0.01em",
      }}
    >
      {items.map((item, i) => (
        <li key={i} style={{ marginBottom: "0.35rem" }}>
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function DeleteAccountPage() {
  return (
    <LegalPage title="Delete Your Account" html="">
      {/* Last updated */}
      <p
        style={{
          fontFamily: "var(--font-body)",
          fontWeight: 300,
          fontSize: "0.78rem",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "rgba(192,200,206,0.45)",
          margin: "-0.5rem 0 2.5rem",
        }}
      >
        Last updated: {LAST_UPDATED}
      </p>

      {/* Intro */}
      <Para>{INTRO}</Para>

      {/* How to request */}
      <SectionHeading>How to request deletion</SectionHeading>
      <BulletList items={HOW_ITEMS} />

      {/* What gets deleted */}
      <SectionHeading>What gets deleted</SectionHeading>
      <BulletList items={DELETED_ITEMS} />

      {/* What we retain */}
      <SectionHeading>What we must retain — and why</SectionHeading>
      {RETAINED_ITEMS.map((item, i) => (
        <div key={i} style={{ marginBottom: "1rem" }}>
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontWeight: 500,
              fontSize: "0.9rem",
              color: "rgba(192,200,206,0.9)",
              letterSpacing: "0.02em",
              margin: "0 0 0.2rem",
            }}
          >
            {item.label}
          </p>
          <Para>{item.reason}</Para>
        </div>
      ))}

      {/* Timeline */}
      <SectionHeading>Processing timeline</SectionHeading>
      <Para>{TIMELINE}</Para>

      {/* Contact */}
      <SectionHeading>Contact</SectionHeading>
      <Para>
        For any questions or to submit a deletion request:{" "}
        <a
          href={`mailto:${CONTACT}`}
          style={{
            color: "var(--color-cream)",
            textDecoration: "underline",
            textUnderlineOffset: "3px",
          }}
        >
          {CONTACT}
        </a>
      </Para>
    </LegalPage>
  );
}
