// ═══════════════════════════════════════════════════════════════════
// D1 Database client — raw SQL (no Prisma, no binary engine needed)
// ═══════════════════════════════════════════════════════════════════
//
// Works on Cloudflare Workers (D1 binding "DB") AND local dev (better-sqlite3).
// No native binary needed — fits within 3 MiB Worker size limit.
//
// USAGE:
//   import { getDb } from '@/lib/db'
//   const db = await getDb()
//   const channels = await db.all<ChannelRow>('SELECT * FROM Channel WHERE isActive = 1')
//   const channel = await db.first<ChannelRow>('SELECT * FROM Channel WHERE id = ?', id)
//   await db.run('INSERT INTO Channel (id, name) VALUES (?, ?)', id, name)
//   const tx = await db.transaction()
//   await tx.run(...)
// ═══════════════════════════════════════════════════════════════════

import type { D1Database } from '@cloudflare/workers-types'

// ── Types ────────────────────────────────────────────────────────

export interface DbClient {
  /** Run a query that returns multiple rows */
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>
  /** Run a query that returns a single row (or null) */
  first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null>
  /** Run a statement that doesn't return rows (INSERT/UPDATE/DELETE) */
  run(sql: string, ...params: unknown[]): Promise<{ success: boolean; meta?: unknown }>
  /** Execute multiple statements in a batch (atomic) */
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<unknown[]>
}

// ── Cloudflare D1 implementation ─────────────────────────────────

class D1Client implements DbClient {
  constructor(private db: D1Database) {}

  async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    const stmt = this.db.prepare(sql)
    const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all()
    return (result.results ?? []) as T[]
  }

  async first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null> {
    const stmt = this.db.prepare(sql)
    const result = params.length > 0 ? await stmt.bind(...params).first() : await stmt.first()
    return (result ?? null) as T | null
  }

  async run(sql: string, ...params: unknown[]): Promise<{ success: boolean; meta?: unknown }> {
    const stmt = this.db.prepare(sql)
    const result = params.length > 0 ? await stmt.bind(...params).run() : await stmt.run()
    return { success: true, meta: result }
  }

  async batch(statements: { sql: string; params?: unknown[] }[]): Promise<unknown[]> {
    const stmts = statements.map((s) => {
      const stmt = this.db.prepare(s.sql)
      return s.params && s.params.length > 0 ? stmt.bind(...s.params) : stmt
    })
    return await this.db.batch(stmts as Parameters<D1Database['batch']>[0])
  }
}

// ── Singleton ────────────────────────────────────────────────────

const globalForDb = globalThis as unknown as {
  __dbPromise?: Promise<DbClient>
}

function isCloudflareWorker(): boolean {
  return process.env.CF_DEPLOY === 'true'
}

async function createCloudflareClient(): Promise<DbClient> {
  const { getCloudflareContext } = await import('@opennextjs/cloudflare')
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
      'D1 binding "DB" not found. Configure it in Cloudflare dashboard or wrangler.jsonc.'
    )
  }
  return new D1Client(d1)
}

async function createLocalClient(): Promise<DbClient> {
  // Local dev: use better-sqlite3 via dynamic import (not needed in worker bundle)
  const Database = (await import('better-sqlite3')).default
  const dbPath = process.env.DATABASE_URL?.replace(/^file:/, '') || './db/custom.db'
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')

  return {
    async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
      try {
        const stmt = sqlite.prepare(sql)
        return (params.length > 0 ? stmt.all(...params) : stmt.all()) as T[]
      } catch (e) {
        // better-sqlite3 is sync, wrap errors as rejected promise
        throw e
      }
    },
    async first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null> {
      const stmt = sqlite.prepare(sql)
      return (params.length > 0 ? stmt.get(...params) : stmt.get()) as T | null
    },
    async run(sql: string, ...params: unknown[]): Promise<{ success: boolean; meta?: unknown }> {
      const stmt = sqlite.prepare(sql)
      const result = params.length > 0 ? stmt.run(...params) : stmt.run()
      return { success: true, meta: result }
    },
    async batch(statements: { sql: string; params?: unknown[] }[]): Promise<unknown[]> {
      const results: unknown[] = []
      const tx = sqlite.transaction(() => {
        for (const s of statements) {
          const stmt = sqlite.prepare(s.sql)
          results.push(s.params && s.params.length > 0 ? stmt.all(...s.params) : stmt.all())
        }
      })
      tx()
      return results
    },
  }
}

/** Returns the singleton database client. */
export function getDb(): Promise<DbClient> {
  if (globalForDb.__dbPromise) return globalForDb.__dbPromise

  const promise = (async () => {
    if (isCloudflareWorker()) {
      return createCloudflareClient()
    }
    return createLocalClient()
  })()

  globalForDb.__dbPromise = promise
  return promise
}

// ── Utility helpers ──────────────────────────────────────────────

/** Generate a cuid-like ID (for new rows) */
export function generateId(): string {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

/** Quote an identifier (column/table name) for SQL */
export function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}
