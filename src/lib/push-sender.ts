// Push notification sender — Cloudflare Pages compatible
//
// NOTE: The `web-push` library uses Node.js crypto (ECDH) for VAPID signing.
// On Cloudflare Workers with nodejs_compat flag, most Node.js APIs are
// available, but crypto.subtle ECDH may not work. If push notifications
// fail on Workers, set VAPID_PRIVATE_KEY='' to disable push sending
// gracefully — the rest of the app works fine without push.
//
// Import web-push lazily so the module doesn't crash at import time
// if the crypto polyfill isn't fully functional on Workers.

import { db } from '@/lib/db'
import { getVapidConfig, isVapidConfigured } from '@/lib/vapid'

// Lazy-load web-push to avoid import-time crashes on Workers runtime
let webpush: typeof import('web-push') | null = null
let webPushInitialized = false

async function ensureWebPush(): Promise<boolean> {
  if (!isVapidConfigured()) return false
  if (webPushInitialized) return webpush !== null

  try {
    const vapidConfig = getVapidConfig()
    webpush = await import('web-push')
    if (vapidConfig.publicKey && vapidConfig.privateKey && vapidConfig.subject) {
      webpush.setVapidDetails(
        vapidConfig.subject,
        vapidConfig.publicKey,
        vapidConfig.privateKey
      )
    }
    if (process.env.FCM_SERVER_KEY) {
      webpush.setGCMAPIKey(process.env.FCM_SERVER_KEY)
    }
    webPushInitialized = true
    return true
  } catch (error) {
    console.warn('[push-sender] web-push initialization failed on Workers runtime:', error)
    webPushInitialized = true // Don't retry
    webpush = null
    return false
  }
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  icon?: string
}

/**
 * Send a push notification to ALL subscribed devices.
 * Returns count of successful and failed sends.
 * Gracefully returns {sent:0, failed:0} if web-push is not available.
 */
export async function sendPushToAll(payload: PushPayload): Promise<{ sent: number; failed: number }> {
  if (!isVapidConfigured()) {
    return { sent: 0, failed: 0 }
  }

  const pushAvailable = await ensureWebPush()
  if (!pushAvailable || !webpush) {
    return { sent: 0, failed: 0 }
  }

  const subscriptions = await db.pushSubscription.findMany()

  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0 }
  }

  const pushPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/',
    icon: payload.icon || '/logo.svg',
  })

  let sent = 0
  let failed = 0

  // Send push in batches of 10
  const BATCH_SIZE = 10
  for (let i = 0; i < subscriptions.length; i += BATCH_SIZE) {
    const batch = subscriptions.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(async (sub) => {
        try {
          await webpush!.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            pushPayload,
            {
              TTL: 86400,
            }
          )
          return true
        } catch (error: unknown) {
          // Remove expired subscriptions (410 Gone)
          if (error instanceof Error && 'statusCode' in error) {
            const statusCode = (error as { statusCode: number }).statusCode
            if (statusCode === 410 || statusCode === 404) {
              await db.pushSubscription.deleteMany({
                where: { id: sub.id },
              }).catch(() => {})
            }
          }
          throw error
        }
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        sent++
      } else {
        failed++
      }
    }
  }

  return { sent, failed }
}

/**
 * Send a push notification to a single subscription.
 */
export async function sendPushToSubscription(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
): Promise<boolean> {
  if (!isVapidConfigured()) {
    return false
  }

  const pushAvailable = await ensureWebPush()
  if (!pushAvailable || !webpush) {
    return false
  }

  try {
    const pushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url || '/',
      icon: payload.icon || '/logo.svg',
    })

    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      pushPayload,
      {
        TTL: 86400,
      }
    )
    return true
  } catch {
    return false
  }
}
