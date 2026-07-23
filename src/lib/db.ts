// src/lib/db.ts — Dual-mode: local SQLite (dev) / Cloudflare D1 (production)
// No static imports of D1/OpenNext — avoids Turbopack edge-runtime detection

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

function createLocalClient(): PrismaClient {
  return new PrismaClient()
}

async function createD1Client(): Promise<PrismaClient> {
  const { getCloudflareContext } = await import('@opennextjs/cloudflare')
  const { PrismaD1 } = await import('@prisma/adapter-d1')
  const { env } = await getCloudflareContext()
  const d1 = env.DB as unknown as D1Database
  const adapter = new PrismaD1(d1)
  return new PrismaClient({ adapter })
}

// Initialize client based on environment
if (!globalForPrisma.prisma) {
  if (process.env.NODE_ENV !== 'production') {
    // Dev mode: synchronous local SQLite client
    globalForPrisma.prisma = createLocalClient()
  } else {
    // Production: kick off D1 async init
    // Use a promise that resolves to the D1 client
    createD1Client()
      .then((client) => {
        globalForPrisma.prisma = client
        console.log('[db] ✅ D1 adapter initialized')
      })
      .catch((err) => {
        console.error('[db] ❌ D1 adapter failed:', err)
        // Fallback to local client (won't work in edge, but prevents crash)
        globalForPrisma.prisma = createLocalClient()
      })
  }
}

export const db = globalForPrisma.prisma
