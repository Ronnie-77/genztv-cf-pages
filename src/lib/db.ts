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
// WebSocket. fetchConnectionCache is now always true (deprecated option removed).
//
// GRACEFUL FALLBACK: If the database is unavailable (missing URL, invalid URL,
// connection failure), the db proxy throws a clear error. API routes catch
// this and fall back to DEFAULT_CHANNELS / DEFAULT_CATEGORIES / DEFAULT_SETTINGS
// from @/lib/default-data — so the app works WITHOUT a database.

import { PrismaClient } from '@prisma/client'
import { neon } from '@neondatabase/serverless'
import { PrismaNeon } from '@prisma/adapter-neon'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

function createPrismaClient(): PrismaClient {
  const isProduction = process.env.NODE_ENV === 'production'
  const databaseUrl = process.env.DATABASE_URL || ''

  // ── No DATABASE_URL at all ──
  if (!databaseUrl) {
    console.warn('[db] ⚠️ No DATABASE_URL — database unavailable. Using default data fallback.')
    throw new Error('[db] DATABASE_URL is not set. Database unavailable.')
  }

  // ── SQLite URL (file:./dev.db) — not compatible with postgresql schema ──
  // In local dev, if someone has an old .env with SQLite URL, skip DB entirely
  // so the app works with default data fallback instead of crashing.
  if (databaseUrl.startsWith('file:')) {
    console.warn('[db] ⚠️ SQLite URL detected (file:) but schema uses postgresql provider.')
    console.warn('[db] ⚠️ For local dev with Neon: set DATABASE_URL to your Neon pooler URL.')
    console.warn('[db] ⚠️ App will use default data fallback (no database).')
    throw new Error('[db] SQLite URL not compatible with PostgreSQL schema. Using default data fallback.')
  }

  // ── Non-PostgreSQL URL ──
  if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
    console.warn(`[db] ⚠️ DATABASE_URL must start with postgresql:// — got: ${databaseUrl.substring(0, 30)}...`)
    throw new Error(`[db] Invalid DATABASE_URL protocol. Expected postgresql:// or postgres://`)
  }

  if (isProduction) {
    // ── Production (Cloudflare Pages / Workers): Neon adapter ──
    // Bypasses the Query Engine binary entirely — uses Neon HTTP driver.

    // Strip channel_binding=require — incompatible with Neon HTTP mode.
    let cleanUrl = databaseUrl
    if (cleanUrl.includes('channel_binding=require')) {
      cleanUrl = cleanUrl.replace(/&?channel_binding=require/, '')
      cleanUrl = cleanUrl.replace(/\?channel_binding=require&/, '?')
      cleanUrl = cleanUrl.replace(/\?channel_binding=require$/, '')
      console.log('[db] Stripped channel_binding=require from DATABASE_URL for HTTP mode')
    }

    try {
      const neonClient = neon(cleanUrl)
      const adapter = new PrismaNeon(neonClient)
      const client = new PrismaClient({ adapter })
      console.log('[db] ✅ Neon adapter created — bypassing Query Engine (HTTP mode)')
      return client
    } catch (err) {
      console.error('[db] ❌ Neon adapter creation failed:', err)
      throw new Error(
        `[db] Neon adapter failed on Workers runtime. ` +
        `Check: DATABASE_URL is correct, channel_binding=require is removed. ` +
        `Original error: ${err}`
      )
    }
  } else {
    // ── Local dev: standard PrismaClient with PostgreSQL ──
    let finalUrl = databaseUrl
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
//
// If createPrismaClient() throws (no URL, invalid URL, adapter failure),
// the error is re-thrown on every access so API routes can catch it and
// fall back to default data.
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
