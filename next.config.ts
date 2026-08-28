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
  // Keep @prisma/client external (its library.mjs is patched by
  // scripts/patch-prisma.mjs to inline-stub node:fs/node:os imports).
  // But DO NOT externalize @prisma/adapter-d1 — we want Next.js to
  // bundle it so the `workerd` export condition resolves to
  // index-workerd.mjs (which has no node:fs imports) instead of the
  // default `node` condition (index-node.mjs, which imports node:fs).
  serverExternalPackages: ['@prisma/client'],
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
