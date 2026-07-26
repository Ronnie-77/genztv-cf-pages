import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel handles the build output automatically — no need for 'standalone'.
  // output: 'standalone' is only needed for Docker / Node.js self-hosting.
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: ['0.0.0.0', 'localhost', '127.0.0.1', '*.space-z.ai', 'preview-chat-*.space-z.ai', '21.0.21.161'],
  // Next.js 16+ default request body limit is 10MB. Our /api/data/import
  // route accepts backup files up to 100MB, so raise the limit here.
  experimental: {
    serverActions: {
      bodySizeLimit: '200mb',
    },
    proxyClientMaxBodySize: '100mb',
  },
  // These packages use Node.js APIs that need special handling on CF Workers.
  // Neon serverless driver + Prisma adapter bypasses Query Engine binary
  // (critical for Cloudflare Workers which doesn't support the native binary).
  serverExternalPackages: [
    '@neondatabase/serverless',
    '@prisma/adapter-neon',
    '@opennextjs/cloudflare',
    'web-push',
  ],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
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
