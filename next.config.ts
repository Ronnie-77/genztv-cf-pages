import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: ['0.0.0.0', 'localhost', '127.0.0.1', '*.space-z.ai', 'preview-chat-*.space-z.ai', '21.0.21.161'],
  experimental: {
    serverActions: {
      bodySizeLimit: '200mb',
    },
    proxyClientMaxBodySize: '100mb',
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
  // ────────────────────────────────────────────────────────────────
  // Cloudflare Workers compatibility
  // ────────────────────────────────────────────────────────────────
  // DO NOT externalize @prisma/client or @prisma/adapter-d1.
  // Let Next.js bundle them so Turbopack can alias node:fs/node:os
  // to our shims. This ensures the worker bundle has NO external
  // node:* imports.
  turbopack: {
    resolveAlias: {
      'node:os': './src/lib/os-shim.ts',
      'os': './src/lib/os-shim.ts',
      'node:fs': './src/lib/fs-shim.ts',
      'fs': './src/lib/fs-shim.ts',
    },
  },
  async redirects() {
    return [
      {
        source: '/admin',
        destination: '/#/admin',
        permanent: false,
      },
    ]
  },
};

export default nextConfig;
