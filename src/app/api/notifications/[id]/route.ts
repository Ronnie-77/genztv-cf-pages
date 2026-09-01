import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { sendPushToAll } from '@/lib/push'
import { apiCache } from '@/lib/cache'
import type { AppNotificationRow } from '@/lib/types'
import { toBool, toNum } from '@/lib/types'

function rowToJson(row: AppNotificationRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    url: row.url,
    imageUrl: row.imageUrl,
    isActive: toBool(row.isActive),
    sendPush: toBool(row.sendPush),
    pushSent: toBool(row.pushSent),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

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
      const db = await getDb()
      const body = await req.json()

      const existing = await db.first<AppNotificationRow>(
        'SELECT * FROM AppNotification WHERE id = ?',
        id
      )
      if (!existing) {
        return NextResponse.json(
          { error: 'Notification not found' },
          { status: 404 }
        )
      }

      const fields: string[] = []
      const sqlParams: unknown[] = []

      if (typeof body.title === 'string') {
        fields.push('title = ?')
        sqlParams.push(body.title.trim().slice(0, 200))
      }
      if (typeof body.body === 'string') {
        fields.push('body = ?')
        sqlParams.push(body.body.slice(0, 1000))
      }
      if (typeof body.url === 'string') {
        fields.push('url = ?')
        sqlParams.push(body.url.slice(0, 500))
      }
      if (typeof body.imageUrl === 'string') {
        fields.push('imageUrl = ?')
        sqlParams.push(body.imageUrl.slice(0, 500))
      }
      if (typeof body.isActive === 'boolean') {
        fields.push('isActive = ?')
        sqlParams.push(toNum(body.isActive))
      }
      if (
        body.type === 'channel' ||
        body.type === 'update' ||
        body.type === 'feature' ||
        body.type === 'notice'
      ) {
        fields.push('type = ?')
        sqlParams.push(body.type)
      }

      if (fields.length > 0) {
        fields.push('updatedAt = ?')
        sqlParams.push(new Date().toISOString())
        sqlParams.push(id)
        await db.run(
          `UPDATE AppNotification SET ${fields.join(', ')} WHERE id = ?`,
          ...sqlParams
        )
      }

      // Optional: re-fire the push notification.
      let pushResult: { sent: number; failed: number; removed: number } | null = null
      if (body.resendPush === true) {
        try {
          const updated = await db.first<AppNotificationRow>(
            'SELECT * FROM AppNotification WHERE id = ?',
            id
          )
          if (updated) {
            const result = await sendPushToAll({
              title: updated.title,
              body: updated.body || 'New update on GenZ TV',
              icon: updated.imageUrl || '/logo.svg',
              url: updated.url || '/',
              tag: `app-notif-${updated.id}-resend`,
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
          }
        } catch (err) {
          console.error('Push resend failed for notification', id, err)
        }
      }

      apiCache.invalidateNotifications()

      const row = await db.first<AppNotificationRow>(
        'SELECT * FROM AppNotification WHERE id = ?',
        id
      )
      const updated = row ? rowToJson(row) : null
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
      const db = await getDb()
      await db.run('DELETE FROM AppNotification WHERE id = ?', id)
      apiCache.invalidateNotifications()
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
