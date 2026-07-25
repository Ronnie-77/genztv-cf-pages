import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Cloudflare Pages: images optimization not available on Workers.
  // Use unoptimized images (serve as-is).
  images: {
    unoptimized: true,
  },
  // External packages that should NOT be bundled by Turbopack.
  // These use dynamic import() and are resolved at runtime on Workers.
  serverExternalPackages: [
    '@opennextjs/cloudflare',
    '@prisma/adapter-d1',
    'web-push',
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb', // Workers have lower memory limits
    },
  },
  async redirects() {
    return [
      {
        source: '/admin',
        destination: '/#/admin',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
