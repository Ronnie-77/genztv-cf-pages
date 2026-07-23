export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAdminAuthenticated } from '@/lib/auth'

// GET /api/push/notifications — List all notifications (admin only)
export async function GET(req: NextRequest) {
  try {
    const authenticated = await isAdminAuthenticated(req)
    if (!authenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const notifications = await db.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return NextResponse.json(notifications)
  } catch (error) {
    console.error('[Push] List notifications error:', error)
    return NextResponse.json({ error: 'Failed to list notifications' }, { status: 500 })
  }
}

// POST /api/push/notifications — Create a new notification and optionally send push (admin only)
export async function POST(req: NextRequest) {
  try {
    const authenticated = await isAdminAuthenticated(req)
    if (!authenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { title, body: notifBody, url, icon, type, sendPush } = body

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    // Create notification in DB
    const notification = await db.notification.create({
      data: {
        title,
        body: notifBody || '',
        url: url || '',
        icon: icon || '',
        type: type || 'general',
        isActive: true,
      },
    })

    // If sendPush is true, send push to all subscribers
    if (sendPush) {
      try {
        const { sendPushToAll } = await import('@/lib/push-sender')
        const result = await sendPushToAll({
          title,
          body: notifBody || '',
          url: url || '',
          icon: icon || '',
        })

        // Update notification with push results
        await db.notification.update({
          where: { id: notification.id },
          data: {
            pushSent: true,
            sentCount: result.sent,
            failCount: result.failed,
          },
        })

        return NextResponse.json({
          ...notification,
          pushSent: true,
          sentCount: result.sent,
          failCount: result.failed,
        })
      } catch (pushError) {
        console.error('[Push] Send error:', pushError)
        return NextResponse.json({
          ...notification,
          pushSent: false,
          pushError: pushError instanceof Error ? pushError.message : 'Push failed',
        })
      }
    }

    return NextResponse.json(notification)
  } catch (error) {
    console.error('[Push] Create notification error:', error)
    return NextResponse.json({ error: 'Failed to create notification' }, { status: 500 })
  }
}
