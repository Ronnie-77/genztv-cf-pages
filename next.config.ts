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
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb', // Workers have lower memory limits
    },
  },
  // These packages use Node.js APIs that need special handling on CF Workers
  // Neon serverless driver + Prisma adapter bypasses Query Engine
  serverExternalPackages: [
    '@neondatabase/serverless',
    '@prisma/adapter-neon',
    '@opennextjs/cloudflare',
    'web-push',
  ],
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
