export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { syncMatchStatuses } from '@/lib/match-sync'
import { getEnvAsync } from '@/lib/env'

/**
 * GET /api/cron/sync-matches — Cron endpoint
 *
 * Syncs match statuses (upcoming→live, live→ended) and sends
 * push notifications when matches go live.
 *
 * Security: If CRON_SECRET is set, verify Authorization header.
 */
export async function GET(req: NextRequest) {
  // If CRON_SECRET is set, verify it
  const cronSecret = await getEnvAsync('CRON_SECRET')
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    const bearerToken = authHeader?.replace('Bearer ', '')
    if (bearerToken !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    // No CRON_SECRET set — allow in development only
    const nodeEnv = await getEnvAsync('NODE_ENV') || 'development'
    if (nodeEnv === 'production') {
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
