import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import LegalPage from "@/app/components/LegalPage";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Return Policy · Cadieux",
  description:
    "Cadieux's return and refund policy for bread orders and subscription deliveries.",
  alternates: { canonical: "/refunds" },
};

const html = fs.readFileSync(
  path.join(process.cwd(), "policies-raw", "refunds.html"),
  "utf8",
);

export default function RefundsPage() {
  return <LegalPage title="Return Policy" html={html} />;
}
