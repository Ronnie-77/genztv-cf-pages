// ═══════════════════════════════════════════════════════════════════
// Database client — hybrid local + Cloudflare D1
// ═══════════════════════════════════════════════════════════════════
//
// LOCAL DEV (`next dev` in this sandbox):
//   Uses standard PrismaClient with `DATABASE_URL=file:...` SQLite file.
//
// PRODUCTION (Cloudflare Workers via @opennextjs/cloudflare):
//   Uses PrismaD1 adapter (no WASM engine — smaller bundle).
//
// USAGE:
//   import { getDb } from '@/lib/db'
//   const db = await getDb()
//   await db.channel.findMany(...)
// ═══════════════════════════════════════════════════════════════════

import type { D1Database } from '@cloudflare/workers-types'
import '@/lib/node-polyfill'

type PrismaClientInstance = {
  channel: unknown
  match: unknown
  category: unknown
  appSetting: unknown
  [key: string]: unknown
}

const globalForPrisma = globalThis as unknown as {
  __prismaPromise?: Promise<PrismaClientInstance>
  __prismaClient?: PrismaClientInstance
}

function isCloudflareWorker(): boolean {
  return process.env.CF_DEPLOY === 'true'
}

async function createD1Client(): Promise<PrismaClientInstance> {
  const [{ PrismaClient }, { PrismaD1 }, { getCloudflareContext }] = await Promise.all([
    import('@prisma/client'),
    import('@prisma/adapter-d1'),
    import('@opennextjs/cloudflare'),
  ])

  let ctx: { env: Record<string, unknown> }
  try {
    ctx = await getCloudflareContext()
  } catch (e) {
    throw new Error(
      'CF_DEPLOY=true but getCloudflareContext() failed. ' +
        `Original error: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  const d1 = (ctx.env as { DB?: D1Database }).DB
  if (!d1) {
    throw new Error(
      'D1 binding "DB" not found. Configure it in Cloudflare dashboard.'
    )
  }

  const adapter = new PrismaD1(d1)

  // Use D1 adapter only (no WASM engine — smaller bundle)
  // @ts-expect-error — PrismaClient accepts adapter
  return new PrismaClient({ adapter }) as PrismaClientInstance
}

async function createLocalClient(): Promise<PrismaClientInstance> {
  const { PrismaClient } = await import('@prisma/client')
  const client = new PrismaClient() as PrismaClientInstance
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.__prismaClient = client
  }
  return client
}

export function getDb(): Promise<PrismaClientInstance> {
  if (globalForPrisma.__prismaPromise) return globalForPrisma.__prismaPromise

  const promise = (async () => {
    if (isCloudflareWorker()) {
      return createD1Client()
    }
    return createLocalClient()
  })()

  globalForPrisma.__prismaPromise = promise
  return promise
}
