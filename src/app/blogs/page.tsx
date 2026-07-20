import type { Metadata } from "next";
import BlogsClient from "./BlogsClient";

export const metadata: Metadata = {
  title: "Journal — Protein Nutrition & Bread Science | Cadieux",
  description: "Cadieux Journal — protein nutrition, healthy bread science, and strength-eating guides from the team baking high protein bread in Visakhapatnam.",
  alternates: { canonical: "/blogs" },
  openGraph: {
    type: "website",
    url: "https://www.cadieux.in/blogs",
    title: "Journal — Protein Nutrition & Bread Science | Cadieux",
    description: "Cadieux Journal — protein nutrition, healthy bread science, and strength-eating guides.",
    images: [
      {
        url: "https://www.cadieux.in/icons/icon-512.png",
        width: 512,
        height: 512,
        alt: "Cadieux",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Journal — Protein Nutrition & Bread Science | Cadieux",
    description: "Cadieux Journal — protein nutrition, healthy bread science, and strength-eating guides.",
    images: ["https://www.cadieux.in/icons/icon-512.png"],
  },
};

export default function BlogsPage() {
  return <BlogsClient />;
}
