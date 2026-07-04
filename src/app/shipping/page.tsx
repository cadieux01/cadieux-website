import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import LegalPage from "@/app/components/LegalPage";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Shipping & Delivery Policy | Cadieux",
  description:
    "Cadieux's delivery options, timing, fees, and policies for Visakhapatnam.",
  alternates: { canonical: "/shipping" },
};

const html = fs.readFileSync(
  path.join(process.cwd(), "policies-raw", "shipping.html"),
  "utf8",
);

export default function ShippingPage() {
  return <LegalPage title="Shipping & Delivery Policy" html={html} />;
}
