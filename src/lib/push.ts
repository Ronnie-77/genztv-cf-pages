import webpush from 'web-push'
import { db } from '@/lib/db'

// Whether VAPID is properly configured. If not, we must NOT attempt to
// send any push notifications because every request will fail with 401 /
// "Authorization header must be specified" from FCM (or 403 from other
// providers). This happens commonly after restoring a backup that contains
// subscriptions created on a different environment (e.g. production) where
// VAPID keys / FCM server key were set, but the current environment does
// not have them.
// Support both VAPID_PUBLIC_KEY (backend .env) and NEXT_PUBLIC_VAPID_PUBLIC_KEY (frontend)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

const VAPID_CONFIGURED =
  !!process.env.VAPID_PRIVATE_KEY &&
  !!process.env.VAPID_SUBJECT &&
  !!VAPID_PUBLIC_KEY

// Configure web-push with VAPID details
if (VAPID_CONFIGURED) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )
}

// Optional: configure GCM/FCM server key so legacy `fcm.googleapis.com/fcm/send`
// endpoints can be authenticated with `Authorization: key=...` instead of VAPID.
// Without this (and without VAPID), FCM always returns 401.
if (process.env.FCM_SERVER_KEY) {
  webpush.setGCMAPIKey(process.env.FCM_SERVER_KEY)
}

export interface PushSubscriptionData {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

/**
 * Send a push notification to ALL subscribed users
 */
export async function sendPushToAll(payload: {
  title: string
  body: string
  icon?: string
  image?: string
  url?: string
  tag?: string
}) {
  // Hard guard: if push is not configured on this environment, do nothing.
  // This prevents the spammy "Push send failed ... 401 Authorization header
  // must be specified" errors that appear after restoring a backup whose
  // subscriptions were created on a different (properly configured) env.
  if (!VAPID_CONFIGURED) {
    return { sent: 0, failed: 0, removed: 0, skipped: true }
  }

  const subscriptions = await db.pushSubscription.findMany()

  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0, removed: 0 }
  }

  const notificationPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon || '/logo.svg',
    // `image` is the larger banner shown below the title/body on Android
    // and desktop Chrome. If the caller provides an icon (e.g. a team logo),
    // we also surface it as the banner image so the branding is prominent.
    image: payload.image || payload.icon || '/logo.svg',
    url: payload.url || '/',
    tag: payload.tag || 'genztv-notification',
  })

  let sent = 0
  let failed = 0
  const invalidSubscriptions: string[] = []
  // Collect a small sample of failures for debugging without spamming logs.
  const failureSamples: { endpoint: string; statusCode?: number }[] = []

  // Send to each subscription
  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        const pushSubscription: PushSubscriptionData = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        }
        await webpush.sendNotification(pushSubscription, notificationPayload)
        sent++
      } catch (error: unknown) {
        failed++
        const statusCode =
          error instanceof Error && 'statusCode' in error
            ? (error as { statusCode: number }).statusCode
            : undefined

        // Treat all "subscription is dead / not authable" codes as invalid
        // so they get cleaned up from the DB and stop causing repeat errors:
        //   400 — bad subscription payload (corrupted keys)
        //   401 — unauthorized (FCM with no server key, VAPID mismatch)
        //   403 — forbidden
        //   404 — subscription not found
        //   410 — subscription gone (unsubscribed / expired)
        if (
          statusCode === 410 ||
          statusCode === 404 ||
          statusCode === 401 ||
          statusCode === 403 ||
          statusCode === 400
        ) {
          invalidSubscriptions.push(sub.id)
        }

        if (failureSamples.length < 3) {
          failureSamples.push({ endpoint: sub.endpoint, statusCode })
        }
      }
    })
  )

  // One concise summary line instead of N error stacks.
  if (failed > 0) {
    console.warn(
      `[push] ${sent} sent, ${failed} failed` +
        (invalidSubscriptions.length > 0
          ? `, ${invalidSubscriptions.length} marked invalid`
          : '') +
        (failureSamples.length > 0
          ? `. Sample failures: ${failureSamples
              .map((f) => `${f.statusCode ?? 'ERR'} ${f.endpoint.slice(0, 60)}...`)
              .join(' | ')}`
          : '')
    )
  }

  // Clean up invalid subscriptions
  if (invalidSubscriptions.length > 0) {
    await db.pushSubscription.deleteMany({
      where: { id: { in: invalidSubscriptions } },
    })
  }

  return { sent, failed, removed: invalidSubscriptions.length }
}

/**
 * Send a push notification about a new match
 *
 * NOTE: This is kept for backwards compatibility but is NO LONGER called
 * automatically when a match is created. Per the new product decision,
 * users should receive a notification when a match goes LIVE (see
 * sendMatchLiveNotification), not when it is merely scheduled.
 */
export async function sendNewMatchNotification(match: {
  title: string
  sport: string
  teamA: string
  teamB: string
  league?: string
  id: string
}) {
  const sportEmoji = match.sport === 'cricket' ? '🏏' : match.sport === 'football' ? '⚽' : '🏆'
  const leagueText = match.league ? ` | ${match.league}` : ''

  return sendPushToAll({
    title: `${sportEmoji} New Match Alert!`,
    body: `${match.teamA} vs ${match.teamB}${leagueText}`,
    url: `/#/watch`,
    tag: `match-${match.id}`,
  })
}

/**
 * Send a "match is LIVE now" push notification.
 *
 * Per the new product decision:
 *   - Users get notified when a match goes LIVE (not when it's scheduled).
 *   - The notification body shows both team names.
 *   - The notification icon shows the home team's logo (teamALogo) so users
 *     can recognize the match at a glance. We fall back to teamB's logo,
 *     then to the default app logo if neither is set.
 *   - Clicking the notification opens the match's watch page directly.
 *
 * @param match  The match object (must include teamA/B + logos + id).
 * @returns      { sent, failed, removed } or { sent: 0, failed: 0 } if no subscribers.
 */
export async function sendMatchLiveNotification(match: {
  id: string
  title: string
  sport: string
  teamA: string
  teamALogo?: string
  teamB: string
  teamBLogo?: string
  league?: string
}) {
  const sportEmoji = match.sport === 'cricket' ? '🏏' : match.sport === 'football' ? '⚽' : '🏆'
  const leagueText = match.league ? ` • ${match.league}` : ''

  // Prefer teamA's logo for the notification icon, fall back to teamB, then app logo.
  const icon = match.teamALogo || match.teamBLogo || '/logo.svg'

  return sendPushToAll({
    title: `${sportEmoji} LIVE NOW: ${match.teamA} vs ${match.teamB}`,
    body: `The match has started!${leagueText} Tap to watch live.`,
    icon,
    url: `/#/watch/${match.id}`,
    tag: `match-live-${match.id}`,
  })
}

export { webpush }
