export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAdminAuthenticated } from '@/lib/auth'

// GET /api/push/subscribers — Get subscriber count (admin only)
export async function GET(req: NextRequest) {
  try {
    const authenticated = await isAdminAuthenticated(req)
    if (!authenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const count = await db.pushSubscription.count()
    return NextResponse.json({ count })
  } catch (error) {
    console.error('[Push] Subscriber count error:', error)
    return NextResponse.json({ error: 'Failed to get subscriber count' }, { status: 500 })
  }
}
