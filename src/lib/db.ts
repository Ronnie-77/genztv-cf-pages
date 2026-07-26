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
// STATIC IMPORTS: We use import (not require) for Neon packages. On Workers,
// there's no node_modules at runtime — all code must be in the single
// worker.js bundle. Static imports ensure Next.js/Turbopack bundles them
// correctly. The `neon()` function is only called inside createPrismaClient()
// which is lazy, so no connection is made at module-load/build time.
//
// BUILD TIME: No real queries are executed — the Proxy just sits idle.
// RUNTIME: process.env.DATABASE_URL from wrangler.toml [vars] is available.

import { PrismaClient } from '@prisma/client'
import { neon } from '@neondatabase/serverless'
import { PrismaNeon } from '@prisma/adapter-neon'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

function createPrismaClient(): PrismaClient {
  const isProduction = process.env.NODE_ENV === 'production'
  const databaseUrl = process.env.DATABASE_URL

  if (isProduction && databaseUrl) {
    // ── Production (Cloudflare Pages / Workers): Neon adapter ──
    // Bypasses the Query Engine binary entirely — uses Neon HTTP driver
    // which works on Workers runtime. No OpenSSL binary needed.
    try {
      const neonClient = neon(databaseUrl)
      const adapter = new PrismaNeon(neonClient)
      const client = new PrismaClient({ adapter })
      console.log('[db] ✅ Neon adapter created successfully — bypassing Query Engine')
      return client
    } catch (err) {
      // Neon adapter failed — log clearly instead of silently falling back
      // to the Query Engine binary (which would also fail on Workers).
      console.error('[db] ❌ Neon adapter creation failed:', err)
      console.error('[db] DATABASE_URL starts with:', databaseUrl.substring(0, 30) + '...')
      // Fall back to standard PrismaClient as last resort
      // This WILL fail on Workers (Query Engine binary mismatch)
      // but at least the error message will be clearer
      return new PrismaClient({
        datasourceUrl: databaseUrl,
        log: ['error'],
      })
    }
  } else {
    // ── Local dev: standard PrismaClient ──
    // Works with SQLite or local PostgreSQL
    let finalUrl = databaseUrl
    if (finalUrl) {
      // Render internal URLs — add connection_limit for safety
      if (finalUrl.includes('render.com') && !finalUrl.includes('connection_limit')) {
        const separator = finalUrl.includes('?') ? '&' : '?'
        finalUrl = `${finalUrl}${separator}connection_limit=5&pool_timeout=30`
      }
      // Neon URLs — limit connections for serverless
      if (finalUrl.includes('neon.tech') && !finalUrl.includes('connection_limit')) {
        const separator = finalUrl.includes('?') ? '&' : '?'
        finalUrl = `${finalUrl}${separator}connection_limit=1&pool_timeout=20`
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
