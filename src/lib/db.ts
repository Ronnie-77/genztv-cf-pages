// src/lib/db.ts — Neon PostgreSQL adapter for Cloudflare Pages
//
// Uses @prisma/adapter-neon which bypasses the Prisma Query Engine.
// Works on Cloudflare Workers runtime via Neon HTTP driver.
//
// BUILD TIME: DATABASE_URL must be set (even as a placeholder) so
// PrismaClient and the Neon adapter can be instantiated without errors.
// During build, no actual queries are executed — the client is just created.
//
// RUNTIME: Cloudflare Pages Dashboard sets the real DATABASE_URL
// pointing to the Neon PostgreSQL database.

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

if (!globalForPrisma.prisma) {
  if (process.env.NODE_ENV === 'production') {
    // Production (Cloudflare Pages): Neon adapter — no Query Engine needed
    const { neon } = require('@neondatabase/serverless')
    const { PrismaNeon } = require('@prisma/adapter-neon')
    const neonClient = neon(process.env.DATABASE_URL!)
    const adapter = new PrismaNeon(neonClient)
    globalForPrisma.prisma = new PrismaClient({ adapter })
  } else {
    // Local dev: standard PrismaClient
    globalForPrisma.prisma = new PrismaClient()
  }
}

export const db = globalForPrisma.prisma
