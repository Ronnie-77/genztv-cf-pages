export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const channels = await db.channel.findMany()
      const matches = await db.match.findMany({ include: { streams: true } })
      const categories = await db.category.findMany()
      const settings = await db.appSetting.findUnique({ where: { id: 'app' } })

      return NextResponse.json({
        _meta: {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          app: 'GenZ TV',
          counts: {
            channels: channels.length, matches: matches.length,
            categories: categories.length,
          },
        },
        settings, channels, matches, categories,
      })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Export failed' }, { status: 500 })
    }
  })
}
