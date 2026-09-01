import { NextRequest, NextResponse } from 'next/server'
import { getDb, generateId } from '@/lib/db'
import type { PushSubscriptionRow } from '@/lib/types'

// POST /api/push/subscribe — Subscribe to push notifications
export async function POST(req: NextRequest) {
  try {
    const db = await getDb()
    const body = await req.json()
    const { endpoint, keys } = body

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: 'Missing subscription data' }, { status: 400 })
    }

    // Upsert: update if endpoint exists, otherwise insert.
    const existing = await db.first<Pick<PushSubscriptionRow, 'id'>>(
      'SELECT id FROM PushSubscription WHERE endpoint = ?',
      endpoint
    )
    let id: string
    if (existing) {
      id = existing.id
      await db.run(
        'UPDATE PushSubscription SET p256dh = ?, auth = ? WHERE endpoint = ?',
        keys.p256dh,
        keys.auth,
        endpoint
      )
    } else {
      id = generateId()
      await db.run(
        `INSERT INTO PushSubscription (id, endpoint, p256dh, auth, createdAt)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        endpoint,
        keys.p256dh,
        keys.auth,
        new Date().toISOString()
      )
    }

    return NextResponse.json({ success: true, id })
  } catch (error) {
    console.error('[Push] Subscribe error:', error)
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 })
  }
}

// DELETE /api/push/subscribe — Unsubscribe from push notifications
export async function DELETE(req: NextRequest) {
  try {
    const db = await getDb()
    const body = await req.json()
    const { endpoint } = body

    if (!endpoint) {
      return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })
    }

    await db.run('DELETE FROM PushSubscription WHERE endpoint = ?', endpoint)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Push] Unsubscribe error:', error)
    return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 })
  }
}
