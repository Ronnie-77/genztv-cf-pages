// VAPID configuration for Web Push notifications
// These keys are used for push notification subscription and delivery
//
// On Cloudflare Pages (Workers runtime), VAPID keys are accessed via
// environment bindings (getRequestContext().env) or process.env.

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BEo3FbUU9D05DYUErcTr6koKy47enYJ8qbMVxX5YxDSgqCrQw5HEqbGxmaSnIPhAwiMb5jRLjpB_0OEZb4r-FqY'
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '4eswudxYwRulpGBUesmZCen3YgcLrPPG7uJqPdEsG8A'
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@genztv.app'

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY
}

export function getVapidConfig() {
  return {
    subject: VAPID_SUBJECT,
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
  }
}

/** Check if VAPID is properly configured with all required keys */
export function isVapidConfigured(): boolean {
  return !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT)
}

/** Convert base64 string to Uint8Array for pushManager.subscribe()
 *  Works on both browser (atob) and Workers (globalThis.atob). */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  // Use globalThis.atob — works on browser AND Workers runtime
  // (Workers have atob in global scope, no need for Buffer)
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
