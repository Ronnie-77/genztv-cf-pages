import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// POST /api/push/unsubscribe — Remove a push subscription
export async function POST(req: NextRequest) {
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
    console.error('Error removing push subscription:', error)
    return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 })
  }
}
