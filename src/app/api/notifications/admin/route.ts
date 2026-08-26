import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'

/**
 * GET /api/notifications/admin (admin only)
 *
 * Returns ALL in-app bell notifications (active + inactive), newest first,
 * for the admin management UI.
 */
export async function GET(req: NextRequest) {

      const db = await getDb()
  return requireAdminAuth(req, async () => {
    try {
      const notifications = await db.appNotification.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
      return NextResponse.json(notifications)
    } catch (error) {
      console.error('Error fetching admin notifications:', error)
      return NextResponse.json(
        { error: 'Failed to fetch notifications' },
        { status: 500 }
      )
    }
  })
}
