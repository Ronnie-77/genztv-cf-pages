export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { sendPushToAll } from '@/lib/push'
import { apiCache } from '@/lib/cache'

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
    const cacheKey = `notifications:list:${limit}`

    // Check cache first
    const cached = apiCache.getNotifications(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const notifications = await db.appNotification.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        url: true,
        imageUrl: true,
        createdAt: true,
      },
    })

    // Cache the result
    apiCache.setNotifications(cacheKey, notifications)

    return NextResponse.json(notifications)
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

      const notification = await db.appNotification.create({
        data: {
          type,
          title: body.title.trim().slice(0, 200),
          body: (typeof body.body === 'string' ? body.body : '').slice(0, 1000),
          url: (typeof body.url === 'string' ? body.url : '').slice(0, 500),
          imageUrl:
            typeof body.imageUrl === 'string' ? body.imageUrl.slice(0, 500) : '',
          isActive: body.isActive !== false,
          sendPush,
          pushSent: false,
        },
      })

      // Optionally fire a web push to all subscribers.
      let pushResult: { sent: number; failed: number; removed: number } | null = null
      if (sendPush) {
        try {
          pushResult = await sendPushToAll({
            title: notification.title,
            body: notification.body || 'New update on GenZ TV',
            icon: notification.imageUrl || '/logo.svg',
            image: notification.imageUrl || '/logo.svg',
            url: notification.url || '/',
            tag: `app-notif-${notification.id}`,
          })
          await db.appNotification.update({
            where: { id: notification.id },
            data: { pushSent: true },
          })
        } catch (err) {
          console.error('Push send failed for notification', notification.id, err)
          // Don't fail the whole request — the in-app notification was still created.
        }
      }

      // Invalidate notification caches
      apiCache.invalidateNotifications()

      return NextResponse.json(
        { ...notification, pushResult },
        { status: 201 }
      )
    } catch (error) {
      console.error('Error creating notification:', error)
      return NextResponse.json(
        { error: 'Failed to create notification' },
        { status: 500 }
      )
    }
  })
}
