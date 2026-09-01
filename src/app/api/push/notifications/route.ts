import { NextRequest, NextResponse } from 'next/server'
import { getDb, generateId } from '@/lib/db'
import { isAdminAuthenticated } from '@/lib/auth'
import type { NoticeRow } from '@/lib/types'
import { toBool, toNum } from '@/lib/types'

// GET /api/push/notifications — List all notifications (admin only)
export async function GET(req: NextRequest) {
  try {
    const authenticated = await isAdminAuthenticated(req)
    if (!authenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await getDb()
    const rows = await db.all<NoticeRow>(
      'SELECT * FROM Notice ORDER BY createdAt DESC LIMIT 100'
    )
    const result = rows.map((r) => ({
      ...r,
      isActive: toBool(r.isActive),
      pushSent: toBool(r.pushSent),
    }))

    return NextResponse.json(result)
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

    const db = await getDb()
    const body = await req.json()
    const { title, body: notifBody, url, icon, type, sendPush } = body

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    // Create notification in DB. The Notice schema stores `imageUrl` (not
    // `icon`); map the client-supplied icon onto imageUrl.
    const id = generateId()
    const now = new Date().toISOString()
    const finalTitle = String(title)
    const finalBody = notifBody || ''
    const finalUrl = url || ''
    const finalIcon = icon || ''
    const finalType = type || 'general'

    await db.run(
      `INSERT INTO Notice
       (id, type, title, body, url, imageUrl, isActive, pushSent, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      finalType,
      finalTitle,
      finalBody,
      finalUrl,
      finalIcon,
      1,
      0,
      now,
      now
    )

    const notification = {
      id,
      type: finalType,
      title: finalTitle,
      body: finalBody,
      url: finalUrl,
      icon: finalIcon,
      imageUrl: finalIcon,
      isActive: true,
      pushSent: false,
      createdAt: now,
      updatedAt: now,
    }

    // If sendPush is true, send push to all subscribers
    if (sendPush) {
      try {
        const { sendPushToAll } = await import('@/lib/push')
        const result = await sendPushToAll({
          title,
          body: notifBody || '',
          url: url || '',
          icon: icon || '',
        })

        // Update notification with push status
        await db.run(
          'UPDATE Notice SET pushSent = 1, updatedAt = ? WHERE id = ?',
          new Date().toISOString(),
          id
        )

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
