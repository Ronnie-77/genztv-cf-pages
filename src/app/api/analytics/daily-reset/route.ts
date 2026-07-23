export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { apiCache } from '@/lib/cache'

// POST /api/analytics/daily-reset — Daily analytics reset (admin only)
//
// Called at midnight (or on-demand) to:
// 1. Finalize yesterday's DailyStat (save aggregated counts)
// 2. Delete all PageView rows (detailed data not needed after the day ends)
// 3. Delete all VisitorSession rows (stale sessions)
// 4. Keep DailyStat rows permanently (just the counts)
//
// The DailyStat already has the aggregated data (topChannels, topCountries,
// topDevices, topBrowsers as JSON counts) because /api/analytics/track
// updates it in real-time throughout the day. So we just need to:
// - Ensure today's DailyStat exists
// - Delete PageView + VisitorSession tables
export async function POST(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const now = new Date()
      const todayStr = now.toISOString().slice(0, 10)

      // Ensure today's DailyStat exists (track endpoint creates it too,
      // but let's be safe in case no one visited yet today)
      await db.dailyStat.upsert({
        where: { date: todayStr },
        update: {},
        create: {
          date: todayStr,
          totalViews: 0,
          uniqueVisitors: 0,
          peakVisitors: 0,
          topPages: '{}',
          topChannels: '{}',
          topCountries: '{}',
          topDevices: '{}',
          topBrowsers: '{}',
        },
      })

      // Delete all PageView rows (detailed page-level data)
      // DailyStat already has the aggregated counts
      const deletedPageViews = await db.pageView.deleteMany({})

      // Delete all VisitorSession rows (stale sessions)
      const deletedSessions = await db.visitorSession.deleteMany({})

      // Invalidate all caches since data changed
      apiCache.clear()

      return NextResponse.json({
        success: true,
        date: todayStr,
        deletedPageViews: deletedPageViews.count,
        deletedSessions: deletedSessions.count,
        message: `Daily reset complete. Deleted ${deletedPageViews.count} page views and ${deletedSessions.count} visitor sessions. DailyStat preserved.`,
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
