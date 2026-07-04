import type { Metadata } from "next";
import Script from "next/script";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BLOG_POSTS } from "@/lib/data";
import ShopCTA from "@/components/ShopCTA";

interface BlogPostPageProps {
  params: { slug: string };
}

export async function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({
    slug: post.slug,
  }));
}

export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const post = BLOG_POSTS.find((p) => p.slug === params.slug);

  if (!post) {
    return {
      title: "Post Not Found",
      description: "The blog post you're looking for doesn't exist.",
    };
  }

  return {
    title: `${post.title} | Cadieux`,
    description: post.meta_description,
    keywords: [post.primary_keyword, ...(post.secondary_keywords || [])],
    alternates: { canonical: `/blogs/${post.slug}` },
    openGraph: {
      type: "article",
      url: `https://www.cadieux.in/blogs/${post.slug}`,
      title: post.title,
      description: post.meta_description,
      images: [
        {
          url: "https://www.cadieux.in/icons/icon-512.png",
          width: 512,
          height: 512,
          alt: "Cadieux",
        },
      ],
      publishedTime: new Date(post.date).toISOString(),
      authors: [post.author],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.meta_description,
      images: ["https://www.cadieux.in/icons/icon-512.png"],
    },
  };
}

const GRAIN = "url(/grain.svg)";

export default function BlogPostPage({ params }: BlogPostPageProps) {
  const post = BLOG_POSTS.find((p) => p.slug === params.slug);

  if (!post) {
    notFound();
  }

  // JSON-LD BlogPosting schema
  const blogPostSchema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.meta_description,
    image: "https://www.cadieux.in/icons/icon-512.png",
    datePublished: new Date(post.date).toISOString(),
    author: {
      "@type": "Person",
      name: post.author,
    },
    publisher: {
      "@type": "Organization",
      name: "Cadieux",
      logo: {
        "@type": "ImageObject",
        url: "https://www.cadieux.in/icons/icon-512.png",
      },
    },
    keywords: [post.primary_keyword, ...(post.secondary_keywords || [])].join(
      ", "
    ),
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "rgb(6,4,2)",
        position: "relative",
        overflowX: "clip",
      }}
    >
      <Script id="blog-post-schema" type="application/ld+json">
        {JSON.stringify(blogPostSchema)}
      </Script>

      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: GRAIN,
          opacity: 0.055,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* Back link */}
      <Link
        href="/blogs"
        style={{
          position: "fixed",
          top: "calc(24px + env(safe-area-inset-top))",
          left: "calc(20px + env(safe-area-inset-left))",
          zIndex: 101,
          fontFamily: "var(--font-body)",
          fontSize: 10,
          fontWeight: 200,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          color: "#4369B2",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>←</span> All Stories
      </Link>

      <main
        style={{
          position: "relative",
          zIndex: 1,
          padding: "100px clamp(28px,8vw,120px) 120px",
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        {/* Post header */}
        <article>
          <h1
            style={{
              margin: "0 0 24px",
              fontFamily: "var(--font-heading)",
              fontSize: "clamp(28px,7vw,56px)",
              fontWeight: 300,
              color: "#FBF3D4",
              letterSpacing: "0.02em",
              lineHeight: 1.15,
            }}
          >
            {post.title}
          </h1>

          {/* Post metadata */}
          <div
            style={{
              display: "flex",
              gap: "24px",
              marginBottom: "48px",
              paddingBottom: "24px",
              borderBottom: "1px solid rgba(240,223,200,0.1)",
              fontSize: 12,
              color: "rgba(251,243,212,0.6)",
              fontFamily: "var(--font-body)",
              fontWeight: 200,
              letterSpacing: "0.05em",
            }}
          >
            <span>{post.author}</span>
            <span>{new Date(post.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
            <span>{post.pillar}</span>
          </div>

          {/* Post body */}
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 13,
              fontWeight: 200,
              lineHeight: 1.9,
              color: "rgba(251,243,212,0.7)",
            }}
          >
            {post.body.split("\n\n").map((paragraph, idx) => {
              // Simple Markdown parsing for headers
              const headerMatch = paragraph.match(/^(#+)\s+(.+)$/);
              if (headerMatch) {
                const level = headerMatch[1].length;
                const text = headerMatch[2];
                const sizes = ["28px", "22px", "18px", "16px", "14px", "12px"];
                return (
                  <h2
                    key={idx}
                    style={{
                      margin: "32px 0 16px",
                      fontFamily: "var(--font-heading)",
                      fontSize: sizes[level - 1] || "14px",
                      fontWeight: 300,
                      color: "#FBF3D4",
                      letterSpacing: "0.01em",
                    }}
                  >
                    {text}
                  </h2>
                );
              }

              return (
                <p key={idx} style={{ margin: "0 0 20px" }}>
                  {paragraph}
                </p>
              );
            })}
          </div>

          {/* CTA: Link to shop */}
          <ShopCTA />
        </article>
      </main>
    </div>
  );
}
