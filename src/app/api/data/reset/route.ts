import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { apiCache } from '@/lib/cache'

// POST /api/data/reset — admin-only: delete all rows from every table
export async function POST(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const db = await getDb()

      // Delete all rows from every table in a single atomic batch.
      // Order respects foreign keys: MatchStream references Match, so delete
      // streams before matches (SQLite ON DELETE CASCADE would also handle
      // this, but explicit ordering is safer across both D1 and
      // better-sqlite3 where foreign keys may be off by default).
      await db.batch([
        { sql: 'DELETE FROM PageView', params: [] },
        { sql: 'DELETE FROM VisitorSession', params: [] },
        { sql: 'DELETE FROM DailyStat', params: [] },
        { sql: 'DELETE FROM MatchStream', params: [] },
        { sql: 'DELETE FROM Match', params: [] },
        { sql: 'DELETE FROM Channel', params: [] },
        { sql: 'DELETE FROM Category', params: [] },
        { sql: 'DELETE FROM Notice', params: [] },
        { sql: 'DELETE FROM AppNotification', params: [] },
        { sql: 'DELETE FROM PushSubscription', params: [] },
        { sql: 'DELETE FROM Feedback', params: [] },
        { sql: 'DELETE FROM AppSetting', params: [] },
      ])

      // Wipe all caches — every cached category is now stale
      apiCache.clear()

      return NextResponse.json({ success: true, message: 'All data has been reset' })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Reset failed' },
        { status: 500 }
      )
    }
  })
}
