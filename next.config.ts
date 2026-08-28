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
  // Cloudflare Workers compatibility: alias Node built-ins to shims.
  // Prisma's runtime imports `node:os` during client init to detect
  // the query engine. On Cloudflare Workers, unenv doesn't implement
  // `node:os`. We alias it to our shim that provides safe defaults.
  // The D1 driver adapter never uses the engine binary — only the
  // detection code path runs.
  // ────────────────────────────────────────────────────────────────
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-d1'],
  turbopack: {
    resolveAlias: {
      'node:os': './src/lib/os-shim.ts',
      'os': './src/lib/os-shim.ts',
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
