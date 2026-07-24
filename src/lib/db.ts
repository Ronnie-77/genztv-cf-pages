// src/lib/db.ts — Cloudflare D1 (production) / Local SQLite (dev)
// Uses Proxy pattern so all 40+ API routes work without code changes.
// db.channel.findMany() → proxy lazily resolves D1 client → real call

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaPromise: Promise<PrismaClient> | undefined
}

// ─── Local dev: uses standard PrismaClient with SQLite file ───
function createLocalClient(): PrismaClient {
  return new PrismaClient()
}

// ─── Production: D1 adapter via getCloudflareContext() ───
// Dynamic imports avoid Turbopack resolution issues at build time.
// These packages are bundled into the CF Worker at runtime by OpenNext.
async function createD1Client(): Promise<PrismaClient> {
  const { getCloudflareContext } = await import('@opennextjs/cloudflare')
  const { PrismaD1 } = await import('@prisma/adapter-d1')
  const { env } = await getCloudflareContext()
  const d1 = env.DB as unknown as D1Database
  const adapter = new PrismaD1(d1)
  return new PrismaClient({ adapter })
}

// ─── Resolves PrismaClient: D1 in production, SQLite in dev ───
async function getDb(): Promise<PrismaClient> {
  // Return cached client if already initialized
  if (globalForPrisma.prisma) return globalForPrisma.prisma

  // Dev mode: use local SQLite (DATABASE_URL=file:./dev.db)
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = createLocalClient()
    return globalForPrisma.prisma
  }

  // Production: D1 async init (reuse promise to avoid duplicate calls)
  // CRITICAL: Do NOT fall back to createLocalClient() — native engine
  // .so.node files don't exist on CF Workers. If D1 fails, throw the error
  // so we can diagnose it, instead of silently using a broken client.
  if (!globalForPrisma.prismaPromise) {
    globalForPrisma.prismaPromise = createD1Client()
  }

  globalForPrisma.prisma = await globalForPrisma.prismaPromise
  console.log('[db] ✅ D1 adapter initialized')
  return globalForPrisma.prisma
}

// ─── Proxy-based export ────────────────────────────────────
// When code does db.channel.findMany(), the proxy:
//   1. db → outer proxy, get('channel') → returns inner proxy
//   2. inner proxy, get('findMany') → returns async (...args) => getDb().then(...)
//   3. calling that async function → resolves D1 client → calls real method

function createModelProxy(parentProp: string): unknown {
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

    return createModelProxy(prop as string)
  },
}) as PrismaClient
