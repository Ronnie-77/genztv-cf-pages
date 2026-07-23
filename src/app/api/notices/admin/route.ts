export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAdminAuthenticated } from '@/lib/auth'

// GET /api/notices/admin — admin only. Returns ALL notices (active + inactive)
// for the admin management UI. Sorted newest-first.
export async function GET(req: NextRequest) {
  const authenticated = await isAdminAuthenticated(req)
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const notices = await db.notice.findMany({
      orderBy: { updatedAt: 'desc' },
    })
    return NextResponse.json({ notices })
  } catch (error) {
    console.error('[Notices/Admin] Error fetching:', error)
    return NextResponse.json(
      { error: 'Failed to fetch notices' },
      { status: 500 },
    )
  }
}
