// src/lib/db.ts — Dual-mode: local SQLite (dev) / Cloudflare D1 (production)
// Uses a Proxy so all 40+ API routes work without any code changes.
// db.channel.findMany() → proxy lazily resolves D1 client → real call

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaPromise: Promise<PrismaClient> | undefined
}

function createLocalClient(): PrismaClient {
  return new PrismaClient()
}

async function createD1Client(): Promise<PrismaClient> {
  const { getCloudflareContext } = await import('@opennextjs/cloudflare')
  const { PrismaD1 } = await import('@prisma/adapter-d1')
  const { env } = await getCloudflareContext()
  const d1 = env.DB as unknown as D1Database
  const adapter = new PrismaD1(d1)
  return new PrismaClient({ adapter })
}

// Resolves the PrismaClient — async for D1, sync fallback for dev
async function getDb(): Promise<PrismaClient> {
  if (globalForPrisma.prisma) return globalForPrisma.prisma

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = createLocalClient()
    return globalForPrisma.prisma
  }

  // Production: D1 async init (reuse promise to avoid duplicate calls)
  if (!globalForPrisma.prismaPromise) {
    globalForPrisma.prismaPromise = createD1Client()
  }

  try {
    globalForPrisma.prisma = await globalForPrisma.prismaPromise
    console.log('[db] ✅ D1 adapter initialized')
    return globalForPrisma.prisma
  } catch (err) {
    console.error('[db] ❌ D1 adapter failed:', err)
    globalForPrisma.prisma = createLocalClient()
    return globalForPrisma.prisma
  }
}

// ── Proxy-based export ────────────────────────────────────
// When code does db.channel.findMany(), the proxy:
//   1. db → outer proxy, get('channel') → returns inner proxy
//   2. inner proxy, get('findMany') → returns async (...args) => getDb().then(...)
//   3. calling that async function → resolves D1 client → calls real method
// For direct calls like db.$transaction(fn):
//   1. db → outer proxy, get('$transaction') → returns inner proxy
//   2. inner proxy called as function via apply trap → resolves D1 → calls real method

function createModelProxy(parentProp: string | symbol): unknown {
  return new Proxy(function () {}, {
    // Called as function: db.$transaction(fn), db.$disconnect(), etc.
    apply(_target, _thisArg, args) {
      return getDb().then((client) => {
        const prop = client[parentProp as keyof PrismaClient]
        if (typeof prop === 'function') return (prop as Function)(...args)
        return prop
      })
    },
    // Property access: db.channel.findMany, db.match.create, etc.
    get(_target, method) {
      if (method === 'then') return undefined // avoid thenable confusion
      if (method === 'toJSON') return undefined
      if (typeof method === 'symbol') return undefined

      return (...args: unknown[]) =>
        getDb().then((client) => {
          const model = client[parentProp as keyof PrismaClient] as Record<string, Function>
          return model[method](...args)
        })
    },
  })
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (prop === 'then') return undefined // avoid thenable confusion
    if (prop === 'toJSON') return undefined
    if (typeof prop === 'symbol') return undefined

    // Return a model/method proxy that handles both:
    // - nested access (db.channel.findMany)
    // - direct calls (db.$transaction)
    return createModelProxy(prop)
  },
}) as PrismaClient
