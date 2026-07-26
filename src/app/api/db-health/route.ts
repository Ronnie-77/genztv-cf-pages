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
  const dbUrl = process.env.DATABASE_URL || ''
  results.checks = {
    ...results.checks as object,
    env_NODE_ENV: process.env.NODE_ENV || 'not set',
    env_HOSTNAME: process.env.HOSTNAME || 'not set',
    env_ADMIN_PASSWORD_SET: !!process.env.ADMIN_PASSWORD,
    database_mode: isProduction ? 'Neon PostgreSQL (serverless)' : 'Local PostgreSQL',
    env_DATABASE_URL: dbUrl ? `${dbUrl.substring(0, 30)}...${dbUrl.includes('neon') ? '(Neon)' : dbUrl.includes('localhost') ? '(local)' : '(unknown)'}` : 'MISSING!',
  }

  // 2. Check Prisma client import
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

  // 3. Try to connect and query
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
