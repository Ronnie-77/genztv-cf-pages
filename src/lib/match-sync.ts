import { db } from '@/lib/db'

/**
 * Shared match-status sync helper.
 *
 * Extracted into its own module so it can be imported by both the
 * `/api/matches` route (auto-sync on GET) and the
 * `/api/cron/sync-matches` route (Vercel Cron / admin-triggered)
 * without creating a circular import between two route handlers.
 *
 * When matches flip from "upcoming" → "live", this function automatically
 * sends push notifications to all subscribed users (Google-style).
 * Uses `liveNotifiedAt` field to prevent duplicate notifications.
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
 * When matches go live, automatically send push notifications.
 *
 * Deduplication: Each match gets a notification only ONCE. After a
 * successful notification, `liveNotifiedAt` is set. If a match was already
 * notified (liveNotifiedAt is not null), it won't be notified again even
 * if the sync runs multiple times.
 *
 * @returns Counts of what was updated + notification results.
 */
export async function syncMatchStatuses(): Promise<{
  updatedToLive: number
  updatedToEnded: number
  notificationsSent: number
  notificationsFailed: number
}> {
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
  let notificationsSent = 0
  let notificationsFailed = 0

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

    // 🔔 Send push notifications for matches that just went LIVE
    // Only for matches that haven't been notified yet (liveNotifiedAt is null)
    if (updatedToLive > 0) {
      try {
        // Fetch full match details for the matches that just went live AND haven't been notified yet
        const liveMatches = await db.match.findMany({
          where: {
            id: { in: startingMatches.map(m => m.id) },
            status: 'live',
            liveNotifiedAt: null, // Only notify if we haven't already
          },
          select: {
            id: true,
            title: true,
            sport: true,
            teamA: true,
            teamALogo: true,
            teamB: true,
            teamBLogo: true,
            league: true,
          },
        })

        if (liveMatches.length > 0) {
          // Dynamically import push sender to avoid circular deps at module level
          const { sendMatchLiveNotification } = await import('@/lib/push')

          // Send notification for each match that went live
          // Use Promise.allSettled so one failure doesn't block others
          const pushResults = await Promise.allSettled(
            liveMatches.map(match =>
              sendMatchLiveNotification({
                id: match.id,
                title: match.title,
                sport: match.sport,
                teamA: match.teamA,
                teamALogo: match.teamALogo,
                teamB: match.teamB,
                teamBLogo: match.teamBLogo,
                league: match.league,
              })
            )
          )

          // Count results and mark notified matches
          const notifiedMatchIds: string[] = []
          for (let i = 0; i < pushResults.length; i++) {
            const r = pushResults[i]
            if (r.status === 'fulfilled') {
              notificationsSent += r.value.sent
              notificationsFailed += r.value.failed
              // Mark as notified even if some pushes failed — we don't
              // want to retry endlessly on dead subscriptions
              notifiedMatchIds.push(liveMatches[i].id)
            } else {
              notificationsFailed++
            }
          }

          // Mark these matches as notified to prevent duplicate notifications
          if (notifiedMatchIds.length > 0) {
            await db.match.updateMany({
              where: { id: { in: notifiedMatchIds } },
              data: { liveNotifiedAt: new Date() },
            })
          }

          console.log(
            `[MatchSync] ${notifiedMatchIds.length} match(es) went LIVE → push notifications sent to ${notificationsSent} device(s), ${notificationsFailed} failed`
          )
        } else {
          console.log(
            `[MatchSync] ${updatedToLive} match(es) went LIVE but all were already notified (skipping)`
          )
        }
      } catch (pushError) {
        // Don't let push notification failures break the sync
        console.error('[MatchSync] Push notification error (non-fatal):', pushError)
      }
    }
  }

  // Update live → ended
  if (endedMatches.length > 0) {
    const result = await db.match.updateMany({
      where: { id: { in: endedMatches.map(m => m.id) } },
      data: { status: 'ended' },
    })
    updatedToEnded = result.count
  }

  return { updatedToLive, updatedToEnded, notificationsSent, notificationsFailed }
}
