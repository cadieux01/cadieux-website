import fs from "fs";
import path from "path";

export interface BlogPostFrontmatter {
  title: string;
  slug: string;
  meta_description: string;
  primary_keyword: string;
  secondary_keywords: string[];
  date: string;
  author: string;
  pillar: string;
  tier: number;
}

export interface BlogPost extends BlogPostFrontmatter {
  brief: string; // excerpt, first 150 chars of body
  body: string;
}

/**
 * Parse a markdown file with YAML frontmatter
 * Frontmatter format:
 * ---
 * key: value
 * ---
 * # Markdown body here
 */
export function parseMarkdownFile(filePath: string): BlogPost | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");

    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) return null;

    const [, frontmatterStr, bodyStr] = frontmatterMatch;

    // Parse YAML frontmatter (simple key: value parser)
    const frontmatter: Record<string, any> = {};
    const lines = frontmatterStr.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;
      const [key, ...valueParts] = line.split(":");
      const value = valueParts.join(":").trim();

      if (key === "secondary_keywords") {
        // Parse as array: [item1, item2, ...]
        const match = value.match(/\[(.*)\]/);
        frontmatter[key] = match
          ? match[1].split(",").map((s) => s.trim().replace(/^"/, "").replace(/"$/, ""))
          : [];
      } else if (key === "tier") {
        frontmatter[key] = parseInt(value, 10);
      } else {
        // Remove quotes if present
        frontmatter[key] = value.replace(/^"/, "").replace(/"$/, "");
      }
    }

    const body = bodyStr.trim();
    const brief = body
      .replace(/^#+\s+.*\n/gm, "") // remove headers
      .split("\n")[0]
      .substring(0, 150);

    return {
      title: frontmatter.title,
      slug: frontmatter.slug,
      meta_description: frontmatter.meta_description,
      primary_keyword: frontmatter.primary_keyword,
      secondary_keywords: frontmatter.secondary_keywords || [],
      date: frontmatter.date,
      author: frontmatter.author,
      pillar: frontmatter.pillar,
      tier: frontmatter.tier,
      brief,
      body,
    };
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error);
    return null;
  }
}

/**
 * Load all blog posts from content/blog directory
 */
export function loadBlogPosts(): BlogPost[] {
  const blogDir = path.join(process.cwd(), "content", "blog");

  if (!fs.existsSync(blogDir)) {
    console.warn("Blog directory not found:", blogDir);
    return [];
  }

  const files = fs.readdirSync(blogDir).filter((f) => f.endsWith(".md"));
  const posts = files
    .map((file) => parseMarkdownFile(path.join(blogDir, file)))
    .filter((post): post is BlogPost => post !== null)
    .sort((a, b) => {
      // Sort by tier (ascending), then by date (descending)
      if (a.tier !== b.tier) return a.tier - b.tier;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

  return posts;
}
