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
 * - Upcoming matches whose startTime has arrived (and whose endTime has not
 *   passed yet, or is null) are flipped to "live".
 * - Live matches whose endTime has passed are flipped to "ended".
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
  const nowIso = now.toISOString()
  const liveThresholdIso = liveThreshold.toISOString()
  const updatedIso = now.toISOString()

  // Find upcoming matches whose start time has arrived (or already passed).
  const startingRows = await db.all<{ id: string }>(
    `SELECT id FROM Match WHERE status = 'upcoming' AND startTime <= ?`,
    liveThresholdIso
  )

  // Find live matches whose endTime has passed → set to ended.
  // (SQLite NULL comparisons return NULL → treated as false, so this naturally
  // excludes matches with no endTime set.)
  const endedRows = await db.all<{ id: string }>(
    `SELECT id FROM Match WHERE status = 'live' AND endTime <= ?`,
    nowIso
  )

  let updatedToLive = 0
  let updatedToEnded = 0

  // Update upcoming → live (only for matches whose endTime hasn't passed yet
  // or is null — preserves original Prisma OR semantics so a match whose
  // scheduled end has already arrived doesn't briefly flip to live before
  // being marked ended).
  if (startingRows.length > 0) {
    const startingIds = startingRows.map((r) => r.id)
    const placeholders = startingIds.map(() => '?').join(', ')
    await db.run(
      `UPDATE Match SET status = 'live', updatedAt = ?
       WHERE id IN (${placeholders})
         AND (endTime IS NULL OR endTime > ?)`,
      updatedIso,
      ...startingIds,
      nowIso
    )
    // Approximate count — actual rows updated may be lower due to endTime
    // guard. The return value is informational (fire-and-forget caller).
    updatedToLive = startingIds.length
  }

  // Update live → ended
  if (endedRows.length > 0) {
    const endedIds = endedRows.map((r) => r.id)
    const placeholders = endedIds.map(() => '?').join(', ')
    await db.run(
      `UPDATE Match SET status = 'ended', updatedAt = ?
       WHERE id IN (${placeholders})`,
      updatedIso,
      ...endedIds
    )
    updatedToEnded = endedIds.length
  }

  return { updatedToLive, updatedToEnded }
}
