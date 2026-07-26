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
  // Packages that use Node.js APIs needing special handling.
  // NOTE: Neon packages (@neondatabase/serverless, @prisma/adapter-neon) MUST
  // NOT be listed here! On Cloudflare Workers, there's NO node_modules at
  // runtime — all code must be in the single worker.js bundle. Marking Neon
  // packages as "external" means they're NOT bundled → require() fails at
  // runtime → falls back to PrismaClient Query Engine binary → OpenSSL
  // mismatch error. Let Next.js bundle them normally so they're included in
  // the OpenNext worker.js bundle.
  serverExternalPackages: [
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
