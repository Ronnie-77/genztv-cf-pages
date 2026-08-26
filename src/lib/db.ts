// ═══════════════════════════════════════════════════════════════════
// Database client — hybrid local + Cloudflare D1
// ═══════════════════════════════════════════════════════════════════
//
// LOCAL DEV (`next dev` in this sandbox):
//   Uses standard PrismaClient with `DATABASE_URL=file:...` SQLite file.
//   Works out-of-the-box, no Cloudflare account needed.
//
// PRODUCTION (Cloudflare Workers via @opennextjs/cloudflare):
//   Uses PrismaD1 adapter bound to the D1 binding named `DB` in wrangler.jsonc.
//   `getCloudflareContext()` from @opennextjs/cloudflare provides the binding.
//
// USAGE:
//   import { getDb } from '@/lib/db'
//   const db = await getDb()
//   await db.channel.findMany(...)
//
// A cached singleton is used so subsequent calls return immediately.

import { PrismaClient } from '@prisma/client'
import type { D1Database } from '@cloudflare/workers-types'

const globalForPrisma = globalThis as unknown as {
  __prismaPromise?: Promise<PrismaClient>
  __prismaClient?: PrismaClient
}

/** Detect whether we're running on Cloudflare Workers (production). */
function isCloudflareWorker(): boolean {
  // Set CF_DEPLOY=true in wrangler.jsonc vars or via the Cloudflare dashboard env.
  return process.env.CF_DEPLOY === 'true'
}

async function createD1Client(): Promise<PrismaClient> {
  const { PrismaD1 } = await import('@prisma/adapter-d1')
  const { getCloudflareContext } = await import('@opennextjs/cloudflare')
  const ctx = await getCloudflareContext()
  const d1 = ctx.env.DB as D1Database
  const adapter = new PrismaD1(d1)
  return new PrismaClient({ adapter })
}

/** Returns the singleton PrismaClient, initialising on first call. */
export function getDb(): Promise<PrismaClient> {
  if (globalForPrisma.__prismaPromise) return globalForPrisma.__prismaPromise

  const promise = (async () => {
    if (isCloudflareWorker()) {
      return createD1Client()
    }
    // Local dev: standard PrismaClient with SQLite URL from .env
    const client = new PrismaClient()
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.__prismaClient = client
    }
    return client
  })()

  globalForPrisma.__prismaPromise = promise
  return promise
}
