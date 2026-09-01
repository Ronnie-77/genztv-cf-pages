import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'

// DELETE /api/analytics/cleanup — Clean up old analytics data (admin only)
//
// Deletes:
//   - PageView rows older than 90 days
//   - VisitorSession rows older than 30 days (inactive sessions)
//
// Returns count of deleted rows. Can also be called as a scheduled job
// or triggered probabilistically from the track endpoint.

export async function DELETE(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const db = await getDb()
      const now = new Date()
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

      // Count + delete old PageViews (90+ days)
      const pvCountRow = await db.first<{ c: number }>(
        'SELECT COUNT(*) as c FROM PageView WHERE createdAt < ?',
        ninetyDaysAgo
      )
      const pageViewsDeleted = pvCountRow?.c ?? 0
      await db.run('DELETE FROM PageView WHERE createdAt < ?', ninetyDaysAgo)

      // Count + delete old VisitorSessions (30+ days inactive)
      const vsCountRow = await db.first<{ c: number }>(
        'SELECT COUNT(*) as c FROM VisitorSession WHERE lastSeen < ?',
        thirtyDaysAgo
      )
      const sessionsDeleted = vsCountRow?.c ?? 0
      await db.run('DELETE FROM VisitorSession WHERE lastSeen < ?', thirtyDaysAgo)

      const result = {
        pageViewsDeleted,
        sessionsDeleted,
        cutoffDate: {
          pageViews: ninetyDaysAgo,
          sessions: thirtyDaysAgo,
        },
      }

      console.log('[Analytics Cleanup] Complete:', JSON.stringify(result))

      return NextResponse.json(result)
    } catch (error) {
      console.error('[Analytics Cleanup] Error:', error)
      const message = error instanceof Error ? error.message : 'Failed to cleanup analytics data'
      return NextResponse.json(
        { error: 'Failed to cleanup analytics data', detail: message },
        { status: 500 }
      )
    }
  })
}
