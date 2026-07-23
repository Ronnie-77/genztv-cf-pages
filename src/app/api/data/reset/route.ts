export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'

export async function POST(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      // Delete all data in correct order (respect foreign keys)
      await db.pageView.deleteMany()
      await db.dailyStat.deleteMany()
      await db.visitorSession.deleteMany()
      await db.matchStream.deleteMany()
      await db.match.deleteMany()
      await db.channel.deleteMany()
      await db.category.deleteMany()
      await db.appSetting.deleteMany()

      return NextResponse.json({ success: true, message: 'All data has been reset' })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Reset failed' }, { status: 500 })
    }
  })
}
