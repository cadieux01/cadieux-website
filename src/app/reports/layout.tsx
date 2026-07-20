import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NABL Lab Reports for Cadieux Protein Bread | Cadieux",
  description:
    "Every Cadieux protein bread batch is lab-tested. Read NABL-accredited nutrition reports covering protein, carbs, and macronutrient breakdown.",
};

export default function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
