// Push notification utilities — Cloudflare Workers compatible
//
// IMPORTANT: VAPID configuration is now initialized lazily inside
// request handlers using getVapidConfigAsync() from vapid.ts.
// Module-level process.env access doesn't work on CF Pages for
// dashboard env vars — we must use getCloudflareContext().env.

import { db } from '@/lib/db'
import { getEnvAsync, getEnv } from '@/lib/env'
import { getVapidConfigAsync, isVapidConfiguredAsync } from '@/lib/vapid'

// Lazy-load web-push to avoid import-time crashes on Workers runtime
let webpushModule: typeof import('web-push') | null = null
let webPushInitialized = false

async function ensureWebPush(): Promise<typeof import('web-push') | null> {
  if (webPushInitialized) return webpushModule
  if (!await isVapidConfiguredAsync()) {
    webPushInitialized = true
    webpushModule = null
    return null
  }

  try {
    const vapidConfig = await getVapidConfigAsync()
    webpushModule = await import('web-push')
    if (vapidConfig.publicKey && vapidConfig.privateKey && vapidConfig.subject) {
      webpushModule.setVapidDetails(
        vapidConfig.subject,
        vapidConfig.publicKey,
        vapidConfig.privateKey
      )
    }
    const fcmKey = await getEnvAsync('FCM_SERVER_KEY')
    if (fcmKey) {
      webpushModule.setGCMAPIKey(fcmKey)
    }
    webPushInitialized = true
    return webpushModule
  } catch (error) {
    console.warn('[push] web-push initialization failed:', error)
    webPushInitialized = true // Don't retry
    webpushModule = null
    return null
  }
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
  const wp = await ensureWebPush()
  if (!wp) {
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
    image: payload.image || payload.icon || '/logo.svg',
    url: payload.url || '/',
    tag: payload.tag || 'genztv-notification',
  })

  let sent = 0
  let failed = 0
  const invalidSubscriptions: string[] = []
  const failureSamples: { endpoint: string; statusCode?: number }[] = []

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
        await wp.sendNotification(pushSubscription, notificationPayload)
        sent++
      } catch (error: unknown) {
        failed++
        const statusCode =
          error instanceof Error && 'statusCode' in error
            ? (error as { statusCode: number }).statusCode
            : undefined

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

  const icon = match.teamALogo || match.teamBLogo || '/logo.svg'

  return sendPushToAll({
    title: `${sportEmoji} LIVE NOW: ${match.teamA} vs ${match.teamB}`,
    body: `The match has started!${leagueText} Tap to watch live.`,
    icon,
    url: `/#/watch/${match.id}`,
    tag: `match-live-${match.id}`,
  })
}

// Re-export webpush for backward compatibility (lazy)
export async function getWebpush() {
  return ensureWebPush()
}
