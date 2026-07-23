export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { syncMatchStatuses } from '@/lib/match-sync'

/**
 * POST /api/matches/sync-statuses — auto-update match statuses based on
 * start/end times.
 *
 * This is the same logic that runs automatically (fire-and-forget) on every
 * GET /api/matches request. Exposing it as an explicit admin endpoint lets
 * the admin force a sync (e.g. from a cron job or a "Sync now" button)
 * without waiting for a user to load the matches list.
 *
 * The auto-live logic is handled by the shared `syncMatchStatuses` helper.
 */
export async function POST(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const result = await syncMatchStatuses()
      return NextResponse.json({
        success: true,
        ...result,
        totalUpdated: result.updatedToLive + result.updatedToEnded,
      })
    } catch (error) {
      console.error('Error syncing match statuses:', error)
      const message = error instanceof Error ? error.message : 'Unknown error'
      return NextResponse.json(
        { error: 'Failed to sync match statuses', detail: message },
        { status: 500 },
      )
    }
  })
}
