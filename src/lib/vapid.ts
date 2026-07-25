// VAPID configuration for Web Push notifications
// These keys are used for push notification subscription and delivery
//
// On Cloudflare Pages (Workers runtime), VAPID keys are accessed via
// getCloudflareContext().env or process.env. We use getEnv/getEnvAsync
// from env.ts for CF Workers compatibility.

import { getEnvAsync, getEnv } from '@/lib/env'

// Default VAPID keys (fallback for dev / unconfigured environments)
const DEFAULT_VAPID_PUBLIC_KEY = 'BEo3FbUU9D05DYUErcTr6koKy47enYJ8qbMVxX5YxDSgqCrQw5HEqbGxmaSnIPhAwiMb5jRLjpB_0OEZb4r-FqY'
const DEFAULT_VAPID_PRIVATE_KEY = '4eswudxYwRulpGBUesmZCen3YgcLrPPG7uJqPdEsG8A'
const DEFAULT_VAPID_SUBJECT = 'mailto:admin@genztv.app'

/** Get VAPID public key — sync version (uses cached env or fallback) */
export function getVapidPublicKey(): string {
  return getEnv('VAPID_PUBLIC_KEY') || getEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY') || DEFAULT_VAPID_PUBLIC_KEY
}

/** Get VAPID public key — async version (always accurate on CF Workers) */
export async function getVapidPublicKeyAsync(): Promise<string> {
  const envValue = await getEnvAsync('VAPID_PUBLIC_KEY')
  const nextPublic = await getEnvAsync('NEXT_PUBLIC_VAPID_PUBLIC_KEY')
  return envValue || nextPublic || DEFAULT_VAPID_PUBLIC_KEY
}

/** Get full VAPID config — async (needed for push setup on CF Workers) */
export async function getVapidConfigAsync() {
  return {
    subject: await getEnvAsync('VAPID_SUBJECT') || DEFAULT_VAPID_SUBJECT,
    publicKey: await getVapidPublicKeyAsync(),
    privateKey: await getEnvAsync('VAPID_PRIVATE_KEY') || DEFAULT_VAPID_PRIVATE_KEY,
  }
}

/** Get full VAPID config — sync fallback (uses cached env) */
export function getVapidConfig() {
  return {
    subject: getEnv('VAPID_SUBJECT') || DEFAULT_VAPID_SUBJECT,
    publicKey: getVapidPublicKey(),
    privateKey: getEnv('VAPID_PRIVATE_KEY') || DEFAULT_VAPID_PRIVATE_KEY,
  }
}

/** Check if VAPID is properly configured with all required keys — async */
export async function isVapidConfiguredAsync(): Promise<boolean> {
  const config = await getVapidConfigAsync()
  return !!(config.publicKey && config.privateKey && config.subject)
}

/** Check if VAPID is properly configured — sync (uses cached env) */
export function isVapidConfigured(): boolean {
  const config = getVapidConfig()
  return !!(config.publicKey && config.privateKey && config.subject)
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
