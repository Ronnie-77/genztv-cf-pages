import { NextRequest, NextResponse } from 'next/server'
import { getDb, generateId } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { apiCache } from '@/lib/cache'

// POST /api/analytics/daily-reset — Daily analytics reset (admin only)
//
// Called at midnight (or on-demand) to:
// 1. Ensure today's DailyStat row exists
// 2. Delete all PageView rows (detailed data not needed after the day ends)
// 3. Delete all VisitorSession rows (stale sessions)
// 4. Keep DailyStat rows permanently (just the counts)
//
// The DailyStat already has the aggregated data (topChannels, topCountries,
// topDevices, topBrowsers as JSON counts) because /api/analytics/track
// updates it in real-time throughout the day. So we just need to:
// - Ensure today's DailyStat exists (INSERT OR REPLACE on unique `date`)
// - Delete PageView + VisitorSession tables

export async function POST(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const db = await getDb()
      const now = new Date()
      const todayStr = now.toISOString().slice(0, 10)
      const nowIso = now.toISOString()

      // Ensure today's DailyStat exists. The `date` column has a UNIQUE
      // constraint (DailyStat_date_key) — use INSERT OR REPLACE.
      // (On a fresh day at midnight the row doesn't exist yet, so this just
      // inserts a fresh zeroed row.)
      await db.run(
        `INSERT OR REPLACE INTO DailyStat (id, date, totalViews, uniqueVisitors, peakVisitors, topPages, topChannels, topCountries, topDevices, topBrowsers, createdAt, updatedAt)
         VALUES (?, ?, 0, 0, 0, '{}', '{}', '{}', '{}', '{}', ?, ?)`,
        generateId(),
        todayStr,
        nowIso,
        nowIso
      )

      // Count + delete all PageView rows (detailed page-level data).
      // DailyStat already has the aggregated counts.
      const pvCountRow = await db.first<{ c: number }>('SELECT COUNT(*) as c FROM PageView')
      const deletedPageViews = pvCountRow?.c ?? 0
      await db.run('DELETE FROM PageView')

      // Count + delete all VisitorSession rows (stale sessions)
      const vsCountRow = await db.first<{ c: number }>('SELECT COUNT(*) as c FROM VisitorSession')
      const deletedSessions = vsCountRow?.c ?? 0
      await db.run('DELETE FROM VisitorSession')

      // Invalidate all caches since data changed
      apiCache.clear()

      return NextResponse.json({
        success: true,
        date: todayStr,
        deletedPageViews,
        deletedSessions,
        message: `Daily reset complete. Deleted ${deletedPageViews} page views and ${deletedSessions} visitor sessions. DailyStat preserved.`,
      })
    } catch (error) {
      console.error('[Analytics Daily Reset] Error:', error)
      return NextResponse.json(
        { error: 'Failed to perform daily reset' },
        { status: 500 }
      )
    }
  })
}
