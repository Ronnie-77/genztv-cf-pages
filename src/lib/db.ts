// ═══════════════════════════════════════════════════════════════════
// Database client — hybrid local + Cloudflare D1
// ═══════════════════════════════════════════════════════════════════
//
// LOCAL DEV (`next dev` in this sandbox):
//   Uses standard PrismaClient with `DATABASE_URL=file:...` SQLite file.
//
// PRODUCTION (Cloudflare Workers via @opennextjs/cloudflare):
//   Uses PrismaD1 adapter bound to the D1 binding named `DB`.
//
// IMPORTANT: Prisma's client init calls fs.readdirSync + os.platform()
// to detect the query engine. On Cloudflare Workers these Node APIs
// are not fully available (unenv stubs). We install polyfills FIRST,
// then dynamically import @prisma/client so the polyfills are in place
// before Prisma's module-level code runs.
//
// USAGE:
//   import { getDb } from '@/lib/db'
//   const db = await getDb()
//   await db.channel.findMany(...)
// ═══════════════════════════════════════════════════════════════════

import type { D1Database } from '@cloudflare/workers-types'
// Node polyfills MUST be imported at the top level (statically) so they
// run before @prisma/client's module-level code executes. This file
// stubs out fs.readdirSync, os.platform(), etc. that Prisma calls
// during client init for engine detection. On Cloudflare Workers,
// unenv doesn't implement these — the D1 driver adapter handles all
// actual DB operations without needing the engine binary.
import '@/lib/node-polyfill'

type PrismaClientInstance = {
  channel: unknown
  match: unknown
  category: unknown
  appSetting: unknown
  // Allow arbitrary model access via index signature
  [key: string]: unknown
}

const globalForPrisma = globalThis as unknown as {
  __prismaPromise?: Promise<PrismaClientInstance>
  __prismaClient?: PrismaClientInstance
}

/** Detect whether we're running on Cloudflare Workers (production). */
function isCloudflareWorker(): boolean {
  return process.env.CF_DEPLOY === 'true'
}

async function createD1Client(): Promise<PrismaClientInstance> {
  // Dynamically import Prisma + adapter (polyfill already loaded above).
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
        'Ensure the app is deployed via @opennextjs/cloudflare. ' +
        `Original error: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  const d1 = (ctx.env as { DB?: D1Database }).DB
  if (!d1) {
    throw new Error(
      'D1 binding "DB" not found. Configure it in Cloudflare dashboard: ' +
        'Workers & Pages → genztv → Settings → Functions → D1 database bindings → ' +
        'Variable name: DB → D1 database: genztv'
    )
  }

  const adapter = new PrismaD1(d1)
  // @ts-expect-error — PrismaClient constructor accepts adapter in this Prisma version
  return new PrismaClient({ adapter }) as PrismaClientInstance
}

async function createLocalClient(): Promise<PrismaClientInstance> {
  // Local dev: standard PrismaClient with SQLite URL from .env.
  // No polyfill needed — Node.js has full fs/os support.
  const { PrismaClient } = await import('@prisma/client')
  const client = new PrismaClient() as PrismaClientInstance
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.__prismaClient = client
  }
  return client
}

/** Returns the singleton PrismaClient, initialising on first call. */
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
