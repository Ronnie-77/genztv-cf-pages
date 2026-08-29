// ═══════════════════════════════════════════════════════════════════
// Database client — hybrid local + Cloudflare D1
// ═══════════════════════════════════════════════════════════════════
//
// LOCAL DEV (`next dev` in this sandbox):
//   Uses standard PrismaClient with `DATABASE_URL=file:...` SQLite file.
//
// PRODUCTION (Cloudflare Workers via @opennextjs/cloudflare):
//   Uses PrismaD1 adapter + WASM query engine (no native binary needed).
//
// IMPORTANT: On Cloudflare Workers, the native query engine binary
// (libquery_engine-*.so.node) cannot be loaded. We use the WASM
// query engine instead, which is pure JavaScript and works everywhere.
//
// USAGE:
//   import { getDb } from '@/lib/db'
//   const db = await getDb()
//   await db.channel.findMany(...)
// ═══════════════════════════════════════════════════════════════════

import type { D1Database } from '@cloudflare/workers-types'
// Node polyfills MUST be imported before @prisma/client on Cloudflare Workers.
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

/** Detect whether we're running on Cloudflare Workers (production). */
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

  // ── Use WASM query engine (no native binary needed) ──
  // On Cloudflare Workers, native .so.node binaries cannot be loaded.
  // We import the WASM runtime + module dynamically and pass them to
  // PrismaClient via the `engineWasm` option.
  //
  // The wasm-base64 file contains the WASM binary as a base64 string.
  // query_engine_bg.sqlite.mjs contains the JS glue code (getRuntime/getQueryEngineWasmModule).
  const wasmModule = await import('@prisma/client/runtime/query_engine_bg.sqlite.wasm-base64.mjs')

  // @ts-expect-error — PrismaClient constructor accepts adapter + engineWasm
  return new PrismaClient({
    adapter,
    engineWasm: wasmModule,
  }) as PrismaClientInstance
}

async function createLocalClient(): Promise<PrismaClientInstance> {
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
