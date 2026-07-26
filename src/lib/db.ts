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
// HTTP MODE: On Cloudflare Workers, neon() MUST use HTTP (fetch) mode, NOT
// WebSocket. We set neonConfig.fetchConnectionCache = true to force HTTP mode.
// WebSocket connections are unreliable on Workers and may fail silently.
//
// channel_binding=require: Incompatible with Neon HTTP mode. We strip it
// from DATABASE_URL at runtime so the HTTP connection works properly.
//
// NO FALLBACK: If the Neon adapter fails on Workers, there is NO working
// fallback — standard PrismaClient needs the Query Engine binary which
// also fails on Workers. So we throw instead of silently falling back,
// giving a clear error message instead of a confusing OpenSSL mismatch.

import { PrismaClient } from '@prisma/client'
import { neon, neonConfig } from '@neondatabase/serverless'
import { PrismaNeon } from '@prisma/adapter-neon'

// ── Force HTTP mode for Cloudflare Workers ──
// WebSocket mode doesn't work reliably on Workers runtime.
// HTTP mode uses fetch() which is fully supported on Workers.
neonConfig.fetchConnectionCache = true

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

function createPrismaClient(): PrismaClient {
  const isProduction = process.env.NODE_ENV === 'production'
  const databaseUrl = process.env.DATABASE_URL

  if (isProduction && databaseUrl) {
    // ── Production (Cloudflare Pages / Workers): Neon adapter ──
    // Bypasses the Query Engine binary entirely — uses Neon HTTP driver
    // which works on Workers runtime. No OpenSSL binary needed.

    // Strip channel_binding=require — incompatible with Neon HTTP mode.
    // HTTP connections use fetch() and don't support channel binding.
    let cleanUrl = databaseUrl
    if (cleanUrl.includes('channel_binding=require')) {
      cleanUrl = cleanUrl.replace(/&?channel_binding=require/, '')
      // Also remove if it's the first param (after ? instead of &)
      cleanUrl = cleanUrl.replace(/\?channel_binding=require&/, '?')
      cleanUrl = cleanUrl.replace(/\?channel_binding=require$/, '')
      console.log('[db] Stripped channel_binding=require from DATABASE_URL for HTTP mode')
    }

    try {
      const neonClient = neon(cleanUrl)
      const adapter = new PrismaNeon(neonClient)
      const client = new PrismaClient({ adapter })
      console.log('[db] ✅ Neon adapter created successfully — bypassing Query Engine (HTTP mode)')
      return client
    } catch (err) {
      // NO fallback to standard PrismaClient — it will ALSO fail on Workers
      // because the Query Engine binary doesn't work (OpenSSL mismatch).
      // Throw a clear error instead of silently failing with a confusing message.
      console.error('[db] ❌ Neon adapter creation failed:', err)
      console.error('[db] DATABASE_URL starts with:', cleanUrl.substring(0, 30) + '...')
      throw new Error(
        `[db] Neon adapter failed on Workers runtime. This is fatal — ` +
        `standard PrismaClient also fails on Workers (Query Engine binary mismatch). ` +
        `Check: DATABASE_URL is correct, Neon HTTP mode is enabled, ` +
        `channel_binding=require is removed. Original error: ${err}`
      )
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
      // Neon URLs — limit connections for serverless (only for non-Workers dev)
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
