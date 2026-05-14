import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import LegalPage from "@/app/components/LegalPage";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Cookie Policy · Cadieux",
  description:
    "How Cadieux uses cookies and similar tracking technologies on our website.",
  alternates: { canonical: "/cookies" },
};

const html = fs.readFileSync(
  path.join(process.cwd(), "policies-raw", "cookies.html"),
  "utf8",
);

export default function CookiesPage() {
  return <LegalPage title="Cookie Policy" html={html} />;
}
