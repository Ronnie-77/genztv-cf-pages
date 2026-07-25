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
  // They must be listed here so OpenNext/CF adapter bundles them correctly
  serverExternalPackages: [
    '@opennextjs/cloudflare',
    '@prisma/adapter-d1',
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
