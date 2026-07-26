// src/lib/db.ts — Neon PostgreSQL adapter for Cloudflare Pages deployment
//
// Uses @prisma/adapter-neon which BYPASSES the Prisma Query Engine binary.
// This is CRITICAL for Cloudflare Workers runtime, which doesn't support the
// native Query Engine binary (OpenSSL version mismatch, no filesystem access).
//
// LAZY PROXY: PrismaClient is created ONLY on first actual access (via Proxy),
// not at module import time. This prevents build errors when DATABASE_URL is
// unavailable during OpenNext's second build pass.
//
// BUILD TIME: No real queries are executed — the Proxy just sits idle.
// RUNTIME: process.env.DATABASE_URL from wrangler.toml [vars] is available.

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

function createPrismaClient(): PrismaClient {
  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction) {
    // ── Production (Cloudflare Pages / Workers): Neon adapter ──
    // Bypasses the Query Engine binary entirely — uses Neon HTTP driver
    // which works on Workers runtime. No OpenSSL binary needed.
    const { neon } = require('@neondatabase/serverless')
    const { PrismaNeon } = require('@prisma/adapter-neon')
    const neonClient = neon(process.env.DATABASE_URL!)
    const adapter = new PrismaNeon(neonClient)
    return new PrismaClient({ adapter })
  } else {
    // ── Local dev: standard PrismaClient ──
    // Works with SQLite or local PostgreSQL
    const url = process.env.DATABASE_URL

    let finalUrl = url
    if (url) {
      // Render internal URLs — add connection_limit for safety
      if (url.includes('render.com') && !url.includes('connection_limit')) {
        const separator = url.includes('?') ? '&' : '?'
        finalUrl = `${url}${separator}connection_limit=5&pool_timeout=30`
      }
      // Neon URLs — limit connections for serverless
      if (url.includes('neon.tech') && !url.includes('connection_limit')) {
        const separator = url.includes('?') ? '&' : '?'
        finalUrl = `${url}${separator}connection_limit=1&pool_timeout=20`
      }
    }

    return new PrismaClient({
      datasourceUrl: finalUrl,
      log: ['warn', 'error'],
    })
  }
}

// Lazy Proxy — PrismaClient is created only when first property is accessed.
// During build, the module is imported but no methods are called, so neon()
// is never invoked and DATABASE_URL is never read. At runtime, the real
// DATABASE_URL from wrangler.toml [vars] is available.
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol) {
    // Lazily create the real PrismaClient on first access
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createPrismaClient()
    }
    const value = globalForPrisma.prisma[prop as keyof PrismaClient]
    // Bind methods to the real client so `this` works correctly
    if (typeof value === 'function') {
      return value.bind(globalForPrisma.prisma)
    }
    return value
  }
})
