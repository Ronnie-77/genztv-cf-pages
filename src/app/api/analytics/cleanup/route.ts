export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
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
      const now = new Date()
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

      // Delete old PageViews (90+ days)
      const deletedPageViews = await db.pageView.deleteMany({
        where: {
          createdAt: { lt: ninetyDaysAgo },
        },
      })

      // Delete old VisitorSessions (30+ days inactive)
      const deletedSessions = await db.visitorSession.deleteMany({
        where: {
          lastSeen: { lt: thirtyDaysAgo },
        },
      })

      const result = {
        pageViewsDeleted: deletedPageViews.count,
        sessionsDeleted: deletedSessions.count,
        cutoffDate: {
          pageViews: ninetyDaysAgo.toISOString(),
          sessions: thirtyDaysAgo.toISOString(),
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
