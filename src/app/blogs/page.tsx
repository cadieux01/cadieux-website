import type { Metadata } from "next";
import BlogsClient from "./BlogsClient";

export const metadata: Metadata = {
  title: "Blog | Cadieux",
  description: "Learn about protein nutrition, bread science, and strength eating. Founder insights, local food guides, and recipes from Cadieux.",
  alternates: { canonical: "/blogs" },
  openGraph: {
    type: "website",
    url: "https://www.cadieux.in/blogs",
    title: "Blog | Cadieux",
    description: "Learn about protein nutrition, bread science, and strength eating.",
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
    title: "Blog | Cadieux",
    description: "Learn about protein nutrition, bread science, and strength eating.",
    images: ["https://www.cadieux.in/icons/icon-512.png"],
  },
};

export default function BlogsPage() {
  return <BlogsClient />;
}
