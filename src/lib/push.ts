// ═══════════════════════════════════════════════════════════════════
// Web Push helper — STUB (no-op) for Cloudflare Workers compatibility
// ═══════════════════════════════════════════════════════════════════
//
// The original implementation used the `web-push` npm package which relies
// on Node.js crypto APIs. On Cloudflare Workers (with nodejs_compat), it
// works partially but is fragile. This stub provides the same function
// signatures so all routes compile and respond gracefully, but push
// notifications are disabled.
//
// To re-enable real web push:
//   1. Generate VAPID keys: `bunx web-push generate-vapid-keys`
//   2. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in wrangler.jsonc vars
//   3. Replace these stubs with a Web-Crypto-based implementation that
//      works on Cloudflare Workers, or run push sending from a separate
//      Worker that has the web-push library bundled.

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
  icon?: string
  badge?: string
}

export interface MatchData {
  id: string
  title: string
  teamA?: string
  teamB?: string
  startTime?: string
  [key: string]: unknown
}

export interface PushResult {
  sent: number
  failed: number
  errors: string[]
}

/** Send a push notification to all subscribers. Returns a no-op result. */
export async function sendPushToAll(_payload: PushPayload): Promise<PushResult> {
  return { sent: 0, failed: 0, errors: ['Web push is disabled (stub implementation)'] }
}

/** Send a "new match" notification to all subscribers. Returns a no-op result. */
export async function sendNewMatchNotification(_match: MatchData): Promise<PushResult> {
  return { sent: 0, failed: 0, errors: ['Web push is disabled (stub implementation)'] }
}
