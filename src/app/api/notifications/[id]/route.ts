export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { sendPushToAll } from '@/lib/push'

/**
 * PATCH /api/notifications/[id] (admin only)
 *
 * Updates an existing in-app bell notification.
 *
 * Body (all optional):
 *   - type, title, body, url, imageUrl, isActive
 *   - resendPush: boolean — re-fire the web push (only meaningful if sendPush
 *     was true at creation time).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAdminAuth(req, async () => {
    try {
      const { id } = await params
      const body = await req.json()

      const existing = await db.appNotification.findUnique({ where: { id } })
      if (!existing) {
        return NextResponse.json(
          { error: 'Notification not found' },
          { status: 404 }
        )
      }

      const updateData: Record<string, unknown> = {}
      if (typeof body.title === 'string') updateData.title = body.title.trim().slice(0, 200)
      if (typeof body.body === 'string') updateData.body = body.body.slice(0, 1000)
      if (typeof body.url === 'string') updateData.url = body.url.slice(0, 500)
      if (typeof body.imageUrl === 'string') updateData.imageUrl = body.imageUrl.slice(0, 500)
      if (typeof body.isActive === 'boolean') updateData.isActive = body.isActive
      if (
        body.type === 'channel' ||
        body.type === 'update' ||
        body.type === 'feature' ||
        body.type === 'notice'
      ) {
        updateData.type = body.type
      }

      const updated = await db.appNotification.update({
        where: { id },
        data: updateData,
      })

      // Optional: re-fire the push notification.
      let pushResult: { sent: number; failed: number; removed: number } | null = null
      if (body.resendPush === true) {
        try {
          pushResult = await sendPushToAll({
            title: updated.title,
            body: updated.body || 'New update on GenZ TV',
            icon: updated.imageUrl || '/logo.svg',
            image: updated.imageUrl || '/logo.svg',
            url: updated.url || '/',
            tag: `app-notif-${updated.id}-resend`,
          })
          await db.appNotification.update({
            where: { id },
            data: { pushSent: true },
          })
        } catch (err) {
          console.error('Push resend failed for notification', id, err)
        }
      }

      return NextResponse.json({ ...updated, pushResult })
    } catch (error) {
      console.error('Error updating notification:', error)
      return NextResponse.json(
        { error: 'Failed to update notification' },
        { status: 500 }
      )
    }
  })
}

/**
 * DELETE /api/notifications/[id] (admin only)
 *
 * Permanently removes an in-app bell notification.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAdminAuth(req, async () => {
    try {
      const { id } = await params
      await db.appNotification.delete({ where: { id } })
      return NextResponse.json({ success: true })
    } catch (error) {
      console.error('Error deleting notification:', error)
      return NextResponse.json(
        { error: 'Failed to delete notification' },
        { status: 500 }
      )
    }
  })
}
