import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lab Reports | Cadieux",
  description:
    "NABL-accredited laboratory reports and nutrition verification for Cadieux protein bread.",
};

export default function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
