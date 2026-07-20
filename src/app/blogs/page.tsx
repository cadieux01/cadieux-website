import type { Metadata } from "next";
import BlogsClient from "./BlogsClient";

const SITE_URL = "https://www.cadieux.in";

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
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Journal", item: `${SITE_URL}/blogs` },
    ],
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <BlogsClient />
    </>
  );
}
