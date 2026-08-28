import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// GET /api/db-health — Database diagnostic endpoint (no auth required)
// Helps debug D1 binding, schema, and connection issues on Cloudflare.
export async function GET() {
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    checks: {} as Record<string, unknown>,
  }

  // 1. Environment checks
  results.checks = {
    ...(results.checks as object),
    env_CF_DEPLOY: process.env.CF_DEPLOY || 'NOT SET (will use local SQLite mode)',
    env_DATABASE_URL: process.env.DATABASE_URL
      ? `${process.env.DATABASE_URL.substring(0, 30)}...`
      : 'NOT SET',
    env_NODE_ENV: process.env.NODE_ENV || 'not set',
  }

  // 2. Try to get the db client via hybrid getDb()
  let db
  try {
    db = await getDb()
    results.checks = {
      ...(results.checks as object),
      db_client_init: 'OK',
    }
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e))
    results.checks = {
      ...(results.checks as object),
      db_client_init: `FAILED: ${error.message}`,
      error_stack: error.stack?.substring(0, 500),
    }
    return NextResponse.json(results, { status: 500 })
  }

  // 3. Try simple queries on each table
  const tableChecks: Record<string, unknown> = {}

  const tables = [
    { name: 'channel', method: 'channel' },
    { name: 'match', method: 'match' },
    { name: 'category', method: 'category' },
    { name: 'appSetting', method: 'appSetting' },
  ]

  let allOk = true
  for (const { name, method } of tables) {
    try {
      // @ts-expect-error — dynamic model access
      const count = await db[method].count()
      tableChecks[name] = `OK (${count} rows)`
    } catch (e: unknown) {
      allOk = false
      const msg = e instanceof Error ? e.message : String(e)
      tableChecks[name] = `FAILED: ${msg.substring(0, 200)}`
    }
  }

  results.checks = {
    ...(results.checks as object),
    tables: tableChecks,
    summary: allOk ? 'ALL TABLES OK' : 'SOME TABLES FAILED (see above)',
  }

  // 4. Helpful hints for common issues
  const hints: string[] = []
  if (process.env.CF_DEPLOY !== 'true') {
    hints.push('CF_DEPLOY is not set to "true" — the app is running in LOCAL SQLite mode. On Cloudflare, set CF_DEPLOY=true in dashboard env vars.')
  }
  if (typeof (tableChecks.channel) === 'string' && (tableChecks.channel as string).includes('no such table')) {
    hints.push('Tables do not exist in D1 — run `bun run cf:migrate` locally to apply the schema, or apply schema.sql via Cloudflare dashboard.')
  }

  if (hints.length > 0) {
    results.hints = hints
  }

  return NextResponse.json(results, { status: allOk ? 200 : 500 })
}
