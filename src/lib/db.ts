// src/lib/db.ts — Dual-mode: local SQLite (dev) / Cloudflare D1 (production)
//
// PRODUCTION: Uses a deep Proxy so `db` is immediately usable even though
// D1 client initialization is async. When you call db.channel.findMany(),
// the Proxy waits for the real D1 client, then calls realClient.channel.findMany().
//
// DEVELOPMENT: Uses a regular synchronous PrismaClient with local SQLite.

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

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

// ─── Dev mode: simple sync client ───
if (process.env.NODE_ENV !== 'production') {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createLocalClient()
  }
}

// ─── Production: deep Proxy that awaits D1 on every call ───
//
// db.channel.findMany({where:...}) works like this:
//   1. db.channel        → Proxy.get("channel") → returns nested Proxy([] → ["channel"])
//   2. .findMany         → Proxy.get("findMany") → returns nested Proxy(["channel","findMany"])
//   3. ({where:...})     → Proxy.apply → getClient().then(c => c.channel.findMany({where:...}))
//
// This means `db` is always "defined" — no undefined export bug.

function createDeepProxy(path: string[] = []): unknown {
  return new Proxy(() => {}, {
    // Property access: return a deeper Proxy (e.g. db → db.channel → db.channel.findMany)
    get(_target, prop: string | symbol) {
      // Prevent Promise-like behavior (await db should not hang)
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
      // Allow typeof checks
      if (prop === 'constructor') return undefined
      // Special: toString / Symbol.toStringTag
      if (prop === 'toString') return () => `[PrismaProxy: ${path.join('.')}]`
      if (prop === Symbol.toStringTag) return 'PrismaProxy'
      return createDeepProxy([...path, prop as string])
    },

    // Function call: resolve the real client, navigate the path, call the method
    apply(_target, _thisArg, args: unknown[]) {
      return getClient().then((client) => {
        let current: unknown = client
        for (const key of path) {
          if (current == null || typeof current !== 'object') {
            throw new Error(`[db] Cannot navigate path ${path.join('.')} — hit ${typeof current}`)
          }
          current = (current as Record<string, unknown>)[key]
        }
        if (typeof current !== 'function') {
          // Not a function — just return the value (e.g. db.$connect might be a method)
          return current
        }
        // Call the method with correct this-binding
        // For Prisma models like channel.findMany, 'this' should be the parent model
        let parent: unknown = client
        for (let i = 0; i < path.length - 1; i++) {
          parent = (parent as Record<string, unknown>)[path[i]]
        }
        return (current as Function).apply(parent, args)
      })
    },
  })
}

// Singleton promise for the D1 client
let clientPromise: Promise<PrismaClient> | null = null
let resolvedClient: PrismaClient | null = null

function getClient(): Promise<PrismaClient> {
  if (resolvedClient) return Promise.resolve(resolvedClient)
  if (!clientPromise) {
    clientPromise = createD1Client()
      .then((c) => {
        resolvedClient = c
        console.log('[db] ✅ D1 adapter initialized')
        return c
      })
      .catch((err) => {
        console.error('[db] ❌ D1 adapter failed:', err)
        // Reset so next call will retry
        clientPromise = null
        throw err
      })
  }
  return clientPromise
}

// The `db` export — in dev it's a real PrismaClient, in prod it's the deep Proxy
export const db: PrismaClient =
  process.env.NODE_ENV !== 'production'
    ? globalForPrisma.prisma!
    : (createDeepProxy() as PrismaClient)
