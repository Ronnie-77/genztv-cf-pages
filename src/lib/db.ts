import { PrismaClient } from '@prisma/client'

/**
 * Prisma Client singleton — optimized for Render.com PostgreSQL.
 *
 * Render provides an internal DATABASE_URL that looks like:
 *   postgresql://user:pass@dpg-xxx.db.render.com/dbname
 *
 * Key considerations:
 *   1. Render free-tier DB allows ~97 connections. We limit to 5
 *      for the web service (it's a single persistent process, not serverless).
 *   2. Use the EXTERNAL connection string for Prisma Migrate / db push
 *      (from your local machine or CI). The INTERNAL string is for
 *      same-datacenter services.
 *   3. Connection pooling via pgBouncer is NOT needed on Render since
 *      we run a single long-lived Node process (not serverless functions).
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL

  let finalUrl = url
  if (url) {
    // Render internal URLs look like: dpg-xxx.db.render.com
    // Add connection_limit for safety
    if (url.includes('render.com') && !url.includes('connection_limit')) {
      const separator = url.includes('?') ? '&' : '?'
      finalUrl = `${url}${separator}connection_limit=5&pool_timeout=30`
    }
    // Also support Neon URLs
    if (url.includes('neon.tech') && !url.includes('connection_limit')) {
      const separator = url.includes('?') ? '&' : '?'
      finalUrl = `${url}${separator}connection_limit=1&pool_timeout=20`
    }
  }

  return new PrismaClient({
    datasourceUrl: finalUrl,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

export const db =
  globalForPrisma.prisma ??
  createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
