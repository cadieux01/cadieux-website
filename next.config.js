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
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      // Phase 1A: plain product slug renamed to high-protein to match DB.
      { source: "/shop/plain", destination: "/shop/high-protein", permanent: true },
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
