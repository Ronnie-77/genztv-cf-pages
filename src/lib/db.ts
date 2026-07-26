// src/lib/db.ts — Neon PostgreSQL adapter for Cloudflare Pages
//
// Uses @prisma/adapter-neon which bypasses the Prisma Query Engine.
// Works on Cloudflare Workers runtime via Neon HTTP driver.
//
// LAZY INITIALIZATION: PrismaClient is created ONLY when first accessed
// (via Proxy), not at module import time. This prevents build errors when
// DATABASE_URL is unavailable during OpenNext's second build pass.
//
// BUILD TIME: No real queries are executed — the Proxy just sits idle.
// RUNTIME: Cloudflare Pages Dashboard provides the real DATABASE_URL.

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

function createPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV === 'production') {
    // Production (Cloudflare Pages): Neon adapter — no Query Engine needed
    const { neon } = require('@neondatabase/serverless')
    const { PrismaNeon } = require('@prisma/adapter-neon')
    const neonClient = neon(process.env.DATABASE_URL!)
    const adapter = new PrismaNeon(neonClient)
    return new PrismaClient({ adapter })
  } else {
    // Local dev: standard PrismaClient
    return new PrismaClient()
  }
}

// Lazy Proxy — PrismaClient is created only when first property is accessed.
// During build, the module is imported but no methods are called, so neon()
// is never invoked and DATABASE_URL is never read. At runtime, the real
// DATABASE_URL from CF Pages env vars is available.
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
