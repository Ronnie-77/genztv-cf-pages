import { NextRequest, NextResponse } from 'next/server'
import { getDb, generateId } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { sendPushToAll } from '@/lib/push'
import { apiCache } from '@/lib/cache'
import type { AppNotificationRow } from '@/lib/types'
import { toBool, toNum } from '@/lib/types'

/**
 * GET /api/notifications (public)
 *
 * Returns active in-app bell notifications, newest first.
 *
 * Query params:
 *   - limit: number (default 30, max 100) — how many to return
 *
 * These are the notifications that appear in the site's top-nav bell dropdown.
 * Every visitor sees the same list; "read" state is tracked client-side per
 * browser via a `lastReadAt` timestamp in localStorage.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const limitParam = searchParams.get('limit')
    let limit = 30
    if (limitParam) {
      const parsed = parseInt(limitParam, 10)
      if (!isNaN(parsed) && parsed > 0 && parsed <= 100) limit = parsed
    }

    // Build cache key
    const cacheKey = `list:${limit}`

    // Check cache first
    const cached = apiCache.getNotifications(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const db = await getDb()
    const rows = await db.all<AppNotificationRow>(
      'SELECT id, type, title, body, url, imageUrl, createdAt FROM AppNotification WHERE isActive = 1 ORDER BY createdAt DESC LIMIT ?',
      limit
    )

    // Cache the result
    apiCache.setNotifications(cacheKey, rows)

    return NextResponse.json(rows)
  } catch (error) {
    console.error('Error fetching notifications:', error)
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/notifications (admin only)
 *
 * Creates a new in-app bell notification. Optionally also fires a web push to
 * all subscribed users if `sendPush` is true.
 *
 * Body:
 *   - type: "channel" | "update" | "feature" | "notice" (default "notice")
 *   - title: string (required)
 *   - body: string
 *   - url: string (optional click-through)
 *   - imageUrl: string (optional icon/banner)
 *   - sendPush: boolean (default false) — also fire a web push to subscribers
 *
 * Returns the created notification + (if sendPush) a `pushResult` with how
 * many subscribers received the push.
 */
export async function POST(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const db = await getDb()
      const body = await req.json()

      if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
        return NextResponse.json(
          { error: 'Title is required' },
          { status: 400 }
        )
      }

      const type =
        body.type === 'channel' ||
        body.type === 'update' ||
        body.type === 'feature' ||
        body.type === 'notice'
          ? body.type
          : 'notice'

      const sendPush = body.sendPush === true
      const id = generateId()
      const now = new Date().toISOString()
      const title = body.title.trim().slice(0, 200)
      const notifBody = (typeof body.body === 'string' ? body.body : '').slice(0, 1000)
      const url = (typeof body.url === 'string' ? body.url : '').slice(0, 500)
      const imageUrl =
        typeof body.imageUrl === 'string' ? body.imageUrl.slice(0, 500) : ''
      const isActive = body.isActive !== false

      await db.run(
        `INSERT INTO AppNotification
         (id, type, title, body, url, imageUrl, isActive, sendPush, pushSent, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        type,
        title,
        notifBody,
        url,
        imageUrl,
        toNum(isActive),
        toNum(sendPush),
        0,
        now,
        now
      )

      const notification = {
        id,
        type,
        title,
        body: notifBody,
        url,
        imageUrl,
        isActive,
        sendPush,
        pushSent: false,
        createdAt: now,
        updatedAt: now,
      }

      // Optionally fire a web push to all subscribers.
      let pushResult: { sent: number; failed: number; removed: number } | null = null
      if (sendPush) {
        try {
          const result = await sendPushToAll({
            title: notification.title,
            body: notification.body || 'New update on GenZ TV',
            icon: notification.imageUrl || '/logo.svg',
            url: notification.url || '/',
            tag: `app-notif-${notification.id}`,
          })
          pushResult = {
            sent: result.sent,
            failed: result.failed,
            removed: 0,
          }
          await db.run(
            'UPDATE AppNotification SET pushSent = 1, updatedAt = ? WHERE id = ?',
            new Date().toISOString(),
            id
          )
          notification.pushSent = true
        } catch (err) {
          console.error('Push send failed for notification', notification.id, err)
          // Don't fail the whole request — the in-app notification was still created.
        }
      }

      // Invalidate notification caches
      apiCache.invalidateNotifications()

      return NextResponse.json({ ...notification, pushResult }, { status: 201 })
    } catch (error) {
      console.error('Error creating notification:', error)
      return NextResponse.json(
        { error: 'Failed to create notification' },
        { status: 500 }
      )
    }
  })
}
