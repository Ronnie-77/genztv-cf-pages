export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

// POST /api/analytics/track — simplified (no database)
// Returns success immediately. Analytics tracking disabled since
// the corresponding admin panel section was removed.
export async function POST(_request: NextRequest) {
  return NextResponse.json({ success: true })
}
