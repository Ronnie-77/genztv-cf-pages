export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { syncMatchStatuses } from '@/lib/match-sync'

/**
 * GET /api/cron/sync-matches — Vercel Cron endpoint
 *
 * Called automatically by Vercel every minute (see vercel.json).
 * Syncs match statuses (upcoming→live, live→ended) and sends
 * push notifications when matches go live.
 *
 * Security: Vercel Cron requests include a `x-vercel-cron` header
 * automatically. We verify this to prevent unauthorized calls.
 * Additionally, if CRON_SECRET is set, we verify the
 * `Authorization: Bearer <CRON_SECRET>` header.
 */
export async function GET(req: NextRequest) {
  // Verify this is a legitimate cron request
  const isVercelCron = req.headers.get('x-vercel-cron') === 'true'

  // If CRON_SECRET is set, verify it
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    const bearerToken = authHeader?.replace('Bearer ', '')
    if (bearerToken !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else if (!isVercelCron) {
    // No CRON_SECRET set AND not a Vercel cron — allow in development only
    // In production, you should set CRON_SECRET
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized — set CRON_SECRET' }, { status: 401 })
    }
  }

  try {
    const result = await syncMatchStatuses()
    return NextResponse.json({
      success: true,
      ...result,
      totalUpdated: result.updatedToLive + result.updatedToEnded,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Cron] Match sync failed:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to sync match statuses', detail: message },
      { status: 500 }
    )
  }
}
