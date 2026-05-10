/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [360, 414, 640, 750, 828, 1080, 1280, 1920, 2048],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  async redirects() {
    return [
      // Phase 1A: plain product slug renamed to high-protein to match DB.
      { source: "/shop/plain", destination: "/shop/high-protein", permanent: true },
    ];
  },
};

module.exports = nextConfig;
