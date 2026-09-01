import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import type { AppNotificationRow } from '@/lib/types'
import { toBool } from '@/lib/types'

/**
 * GET /api/notifications/admin (admin only)
 *
 * Returns ALL in-app bell notifications (active + inactive), newest first,
 * for the admin management UI.
 */
export async function GET(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const db = await getDb()
      const rows = await db.all<AppNotificationRow>(
        'SELECT * FROM AppNotification ORDER BY createdAt DESC LIMIT 200'
      )
      const result = rows.map((r) => ({
        ...r,
        isActive: toBool(r.isActive),
        sendPush: toBool(r.sendPush),
        pushSent: toBool(r.pushSent),
      }))
      return NextResponse.json(result)
    } catch (error) {
      console.error('Error fetching admin notifications:', error)
      return NextResponse.json(
        { error: 'Failed to fetch notifications' },
        { status: 500 }
      )
    }
  })
}
