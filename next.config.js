/** @type {import('next').NextConfig} */

// ── Security headers ─────────────────────────────────────────────────
// CSP scope: cadieux.in and same-origin /admin + /dashboard rewrite.
// Allowed third parties (only what the site actually loads):
//   • Supabase            uejagupcwevadfhfuadv.supabase.co (HTTPS + wss)
//   • Google Fonts        fonts.googleapis.com / fonts.gstatic.com
//   • Google Maps         maps.googleapis.com / *.gstatic.com
//   • Cloudflare Turnstile challenges.cloudflare.com
//   • Razorpay checkout   checkout.razorpay.com / api.razorpay.com /
//                         lumberjack.razorpay.com
//   • Vercel preview      vercel.live (toolbar only — harmless on prod)
//
// 'unsafe-inline' is required for script + style because Next ships
// inline bootstrap scripts and the codebase uses inline style props
// extensively. 'unsafe-eval' is intentionally NOT granted. Tightening
// to nonces is a follow-up task.

const SUPABASE = "https://uejagupcwevadfhfuadv.supabase.co";
const SUPABASE_WSS = "wss://uejagupcwevadfhfuadv.supabase.co";

const ContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://checkout.razorpay.com https://maps.googleapis.com https://vercel.live",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  `img-src 'self' data: blob: ${SUPABASE} https://maps.gstatic.com https://*.googleapis.com https://*.gstatic.com`,
  `connect-src 'self' ${SUPABASE} ${SUPABASE_WSS} https://api.razorpay.com https://lumberjack.razorpay.com https://maps.googleapis.com https://challenges.cloudflare.com https://vercel.live`,
  "frame-src 'self' https://challenges.cloudflare.com https://checkout.razorpay.com https://api.razorpay.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: ContentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // checkout's "share my location" feature uses first-party geolocation;
  // (self) keeps it working on cadieux.in while blocking third parties.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // CSP supersedes the legacy XSS auditor; 0 disables a buggy legacy feature.
  { key: "X-XSS-Protection", value: "0" },
];

const nextConfig = {
  reactStrictMode: false,
  // Drop the X-Powered-By: Next.js banner.
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [360, 414, 640, 750, 828, 1080, 1280, 1920, 2048],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The dashboard SPA shell is proxied (rewrite) to an external
      // Vercel project. Vercel's edge was caching that proxied HTML and
      // serving it stale (a pre-fix 404.html froze on some POPs, leaving
      // users on a broken page after a hard refresh). Tell Vercel's CDN
      // never to cache the shell. The immutable, content-hashed assets
      // under /dashboard/assets/* are intentionally excluded so they stay
      // edge-cached.
      {
        source: "/dashboard",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
          { key: "CDN-Cache-Control", value: "no-store" },
          { key: "Vercel-CDN-Cache-Control", value: "no-store" },
        ],
      },
      {
        source: "/dashboard/:path((?!assets/).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
          { key: "CDN-Cache-Control", value: "no-store" },
          { key: "Vercel-CDN-Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // Phase 1A: plain product slug renamed to high-protein to match DB.
      { source: "/shop/plain", destination: "/shop/high-protein", permanent: true },
      // Force the admin onto www. localStorage is per-origin, so a bearer
      // token saved on www.cadieux.in is invisible on the apex cadieux.in
      // (and vice-versa) — landing on the apex looked "logged out". Sending
      // all /admin traffic to www keeps the token on one consistent origin.
      // No loop: the `has` host condition only matches the bare apex.
      {
        source: "/admin",
        has: [{ type: "host", value: "cadieux.in" }],
        destination: "https://www.cadieux.in/admin",
        permanent: false,
      },
      {
        source: "/admin/:path*",
        has: [{ type: "host", value: "cadieux.in" }],
        destination: "https://www.cadieux.in/admin/:path*",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/dashboard/:path*',
        destination: 'https://cadieux-dashboard.vercel.app/dashboard/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
