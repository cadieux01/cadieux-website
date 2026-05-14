import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import LegalPage from "@/app/components/LegalPage";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Terms & Conditions · Cadieux",
  description:
    "Terms governing your use of the Cadieux website, mobile app, and bread delivery service.",
  alternates: { canonical: "/terms" },
};

const html = fs.readFileSync(
  path.join(process.cwd(), "policies-raw", "terms.html"),
  "utf8",
);

export default function TermsPage() {
  return <LegalPage title="Terms & Conditions" html={html} />;
}
