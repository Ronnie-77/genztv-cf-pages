// ═══════════════════════════════════════════════════════════════════
// VAPID key helper — STUB
// ═══════════════════════════════════════════════════════════════════
//
// Returns the VAPID public key from the environment, or empty string if
// not set. To enable web push, generate keys with:
//   bunx web-push generate-vapid-keys
// and set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in wrangler.jsonc vars.

/** Returns the VAPID public key from env, or '' if not set. */
export function getVapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || ''
}

/** Returns true if VAPID keys are configured. */
export function hasVapidKeys(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}
