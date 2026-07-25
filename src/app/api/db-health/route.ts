export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

// GET /api/db-health — Database diagnostic endpoint (no auth required for debugging)
export async function GET() {
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    checks: {} as Record<string, unknown>,
  }

  const isProduction = process.env.NODE_ENV === 'production'

  // 1. Environment info
  results.checks = {
    ...results.checks as object,
    env_NODE_ENV: process.env.NODE_ENV || 'not set',
    env_HOSTNAME: process.env.HOSTNAME || 'not set',
    env_ADMIN_PASSWORD_SET: !!process.env.ADMIN_PASSWORD,
    database_mode: isProduction ? 'D1 (Cloudflare binding)' : 'SQLite (local file)',
    env_DATABASE_URL: isProduction ? 'NOT NEEDED (D1 binding used)' : (process.env.DATABASE_URL ? 'SET' : 'MISSING — needed for local dev'),
  }

  // 2. Try D1 binding check (production only)
  if (isProduction) {
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare')
      const { env } = await getCloudflareContext()
      const d1Binding = env.DB
      results.checks = {
        ...results.checks as object,
        d1_binding: d1Binding ? 'OK — D1 binding found' : 'MISSING — DB binding not found in env',
      }
    } catch (e: unknown) {
      results.checks = {
        ...results.checks as object,
        d1_binding: `FAILED: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }

  // 3. Check Prisma client import
  try {
    const { PrismaClient } = await import('@prisma/client')
    results.checks = {
      ...results.checks as object,
      prisma_import: 'OK',
      prisma_client_constructor: typeof PrismaClient,
    }
  } catch (e: unknown) {
    results.checks = {
      ...results.checks as object,
      prisma_import: `FAILED: ${e instanceof Error ? e.message : String(e)}`,
    }
    return NextResponse.json(results, { status: 500 })
  }

  // 4. Try to connect and query via db.ts
  try {
    const { db } = await import('@/lib/db')

    // Try a simple query
    const channelCount = await db.channel.count()
    const matchCount = await db.match.count()
    const categoryCount = await db.category.count()

    // Check if AppSetting table is accessible
    let settingsCheck = 'not tested'
    try {
      const settings = await db.appSetting.findUnique({ where: { id: 'app' } })
      settingsCheck = settings ? `OK (appName=${settings.appName})` : 'no settings row found'
    } catch (e: unknown) {
      settingsCheck = `FAILED: ${e instanceof Error ? e.message : String(e)}`
    }

    results.checks = {
      ...results.checks as object,
      db_connection: 'OK',
      channel_count: channelCount,
      match_count: matchCount,
      category_count: categoryCount,
      settings_check: settingsCheck,
    }
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e))
    results.checks = {
      ...results.checks as object,
      db_connection: `FAILED: ${error.message}`,
      error_name: error.name,
      error_stack: error.stack?.substring(0, 500),
    }
    return NextResponse.json(results, { status: 500 })
  }

  return NextResponse.json(results)
}
