import { NextResponse } from 'next/server'

// GET /api/db-health — Database diagnostic endpoint (no auth required)
// Super-robust: catches ALL errors and returns them as JSON (never a bare 500).
export async function GET() {
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    checks: {} as Record<string, unknown>,
  }

  // 1. Environment checks
  try {
    results.checks = {
      ...(results.checks as object),
      env_CF_DEPLOY: process.env.CF_DEPLOY || 'NOT SET (will use local SQLite mode)',
      env_DATABASE_URL: process.env.DATABASE_URL
        ? `${process.env.DATABASE_URL.substring(0, 30)}...`
        : 'NOT SET',
      env_NODE_ENV: process.env.NODE_ENV || 'not set',
    }
  } catch (e) {
    results.checks = { ...(results.checks as object), env_check_error: String(e) }
  }

  // 2. Try to import and init the db client
  let db: import('@/generated/prisma/client').PrismaClient | null = null
  try {
    const { getDb } = await import('@/lib/db')
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
      error_name: error.name,
      error_stack: error.stack?.substring(0, 800),
    }
    // Add hints for common issues
    const hints: string[] = []
    if (error.message.includes('fs.readdir') || error.message.includes('unenv')) {
      hints.push('Prisma is trying to use fs module. Ensure prisma schema uses "prisma-client" generator (not "prisma-client-js") and the latest code is deployed.')
    }
    if (error.message.includes('D1 binding')) {
      hints.push('D1 binding "DB" not found. Configure in Cloudflare dashboard: Settings → Functions → D1 database bindings.')
    }
    if (error.message.includes('getCloudflareContext')) {
      hints.push('OpenNext context not available. Ensure CF_DEPLOY=true is set and the app is deployed via @opennextjs/cloudflare.')
    }
    if (error.message.includes('generated/prisma')) {
      hints.push('Generated Prisma client not found. Ensure "postinstall: prisma generate" runs during build. Check build logs.')
    }
    if (hints.length > 0) results.hints = hints
    return NextResponse.json(results, { status: 200 })
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
