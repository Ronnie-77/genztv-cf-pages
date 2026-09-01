import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// GET /api/db-health — Database diagnostic endpoint (no auth required)
// Pure raw SQL — no Prisma. Catches ALL errors and returns them as JSON
// (never a bare 500).
export async function GET() {
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    checks: {} as Record<string, unknown>,
  }

  // 1. Environment checks
  try {
    results.checks = {
      env_CF_DEPLOY: process.env.CF_DEPLOY || 'NOT SET (will use local SQLite mode)',
      env_DATABASE_URL: process.env.DATABASE_URL
        ? `${process.env.DATABASE_URL.substring(0, 30)}...`
        : 'NOT SET',
      env_NODE_ENV: process.env.NODE_ENV || 'not set',
    }
  } catch (e) {
    results.checks = { ...(results.checks as object), env_check_error: String(e) }
  }

  // 2. Try to init the db client (raw D1 / better-sqlite3 — no Prisma)
  let db: Awaited<ReturnType<typeof getDb>> | null = null
  try {
    db = await getDb()
    results.checks = {
      ...(results.checks as object),
      db_client_init: 'OK (raw SQL — no Prisma)',
    }
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e))
    results.checks = {
      ...(results.checks as object),
      db_client_init: `FAILED: ${error.message}`,
      error_name: error.name,
      error_stack: error.stack?.substring(0, 800),
    }
    const hints: string[] = []
    if (error.message.includes('D1 binding')) {
      hints.push('D1 binding "DB" not found. Configure in Cloudflare dashboard: Settings → Functions → D1 database bindings.')
    }
    if (error.message.includes('getCloudflareContext')) {
      hints.push('OpenNext context not available. Ensure CF_DEPLOY=true is set and the app is deployed via @opennextjs/cloudflare.')
    }
    if (hints.length > 0) results.hints = hints
    return NextResponse.json(results, { status: 200 })
  }

  // 3. Run COUNT(*) on each table to verify schema + connectivity
  const tableChecks: Record<string, unknown> = {}
  const tables: { name: string; sql: string }[] = [
    { name: 'Channel', sql: 'SELECT COUNT(*) as c FROM Channel' },
    { name: 'Match', sql: 'SELECT COUNT(*) as c FROM Match' },
    { name: 'Category', sql: 'SELECT COUNT(*) as c FROM Category' },
    { name: 'AppSetting', sql: 'SELECT COUNT(*) as c FROM AppSetting' },
  ]

  let allOk = true
  for (const { name, sql } of tables) {
    try {
      const row = await db.first<{ c: number }>(sql)
      const count = row?.c ?? 0
      tableChecks[name] = `OK (${count} rows)`
    } catch (e: unknown) {
      allOk = false
      const msg = e instanceof Error ? e.message : String(e)
      tableChecks[name] = `FAILED: ${msg.substring(0, 300)}`
    }
  }

  results.checks = {
    ...(results.checks as object),
    tables: tableChecks,
    summary: allOk ? 'ALL TABLES OK' : 'SOME TABLES FAILED (see above)',
  }

  // 4. Helpful hints
  const hints: string[] = []
  if (process.env.CF_DEPLOY !== 'true') {
    hints.push('CF_DEPLOY is not set to "true" — running in LOCAL SQLite mode.')
  }
  for (const [table, status] of Object.entries(tableChecks)) {
    if (typeof status === 'string' && status.includes('no such table')) {
      hints.push(`Table "${table}" does not exist in D1. Run: npx wrangler d1 execute genztv --remote --file=prisma/d1-schema.sql`)
    }
  }
  if (hints.length > 0) results.hints = hints

  return NextResponse.json(results, { status: 200 })
}
