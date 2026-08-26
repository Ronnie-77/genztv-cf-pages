import { getDb } from '@/lib/db'

/**
 * Shared match-status sync helper.
 *
 * Extracted into its own module so it can be imported by both the
 * `/api/matches` route (auto-sync on GET) and the
 * `/api/matches/sync-statuses` route (explicit admin-triggered sync)
 * without creating a circular import between two route handlers.
 */

/**
 * How many minutes BEFORE the scheduled start time a match should auto-flip
 * to "live" status.
 *
 * Set to 0 — matches go live at the ACTUAL scheduled start time, not early.
 */
export const LIVE_EARLY_MINUTES = 0

/**
 * Sync match statuses based on current time.
 *
 * @returns Counts of what was updated.
 */
export async function syncMatchStatuses(): Promise<{
  updatedToLive: number
  updatedToEnded: number
}> {
  const db = await getDb()
  const now = new Date()
  const liveThreshold = new Date(now.getTime() + LIVE_EARLY_MINUTES * 60 * 1000)

  // Find upcoming matches whose start time has arrived (or already passed).
  const startingMatches = await db.match.findMany({
    where: {
      status: 'upcoming',
      startTime: { lte: liveThreshold },
    },
    select: { id: true },
  })

  // Find live matches whose endTime has passed → set to ended.
  const endedMatches = await db.match.findMany({
    where: {
      status: 'live',
      endTime: { lte: now },
    },
    select: { id: true },
  })

  let updatedToLive = 0
  let updatedToEnded = 0

  // Update upcoming → live (only for matches that haven't ended yet)
  if (startingMatches.length > 0) {
    const result = await db.match.updateMany({
      where: {
        id: { in: startingMatches.map(m => m.id) },
        // Only flip to live if endTime hasn't passed (or endTime is null)
        OR: [
          { endTime: null },
          { endTime: { gt: now } },
        ],
      },
      data: { status: 'live' },
    })
    updatedToLive = result.count
  }

  // Update live → ended
  if (endedMatches.length > 0) {
    const result = await db.match.updateMany({
      where: { id: { in: endedMatches.map(m => m.id) } },
      data: { status: 'ended' },
    })
    updatedToEnded = result.count
  }

  return { updatedToLive, updatedToEnded }
}
