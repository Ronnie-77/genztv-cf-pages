import { NextRequest, NextResponse } from 'next/server'
import { getDb, generateId } from '@/lib/db'

// POST /api/analytics/heartbeat
//
// Lightweight "I'm still watching" ping sent by the client every ~15s while
// a visitor is on the watch page. Updates ONLY VisitorSession.lastSeen +
// currentChannelId + currentMatchId — no PageView row is created (so this
// doesn't inflate view counts), and there's no DailyStat update (cheap).
//
// The admin "live viewers" count queries these fields against
// `lastSeen >= now - 60s`, so as long as a visitor heartbeats within the
// last 60 seconds they're counted as watching that channel/match.
//
// Body: { channelId?: string, matchId?: string }
//   - If both are absent, the visitor isn't on a watch page → clear both
//     attribution fields (so a stale "watching channel X" doesn't linger
//     after the visitor navigates away).
//   - Otherwise set whichever is present and clear the other.
//
// Implementation: VisitorSession.sessionId is UNIQUE (VisitorSession_sessionId_key),
// so we use `INSERT ... ON CONFLICT(sessionId) DO UPDATE SET ...` — this
// handles both "first heartbeat" (insert) and "subsequent heartbeat" (update)
// in one atomic statement.

export async function POST(request: NextRequest) {
  try {
    const db = await getDb()
    const body = await request.json().catch(() => ({}))
    const { channelId, matchId } = body as {
      channelId?: string
      matchId?: string
    }

    // Derive sessionId from ip + user-agent (same scheme as /track).
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      ''
    const ua = request.headers.get('user-agent') || ''
    let hash = 0
    const str = `${ip}-${ua}`
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    const sessionId = Math.abs(hash).toString(36).padStart(8, '0')

    const nowIso = new Date().toISOString()
    const currentChannelId = channelId || null
    const currentMatchId = matchId || null

    // Upsert VisitorSession.
    // - On INSERT: create a new session row (pageCount = 0 — heartbeats
    //   don't count as page views).
    // - On CONFLICT (existing sessionId): update only lastSeen + attribution.
    await db.run(
      `INSERT INTO VisitorSession (id, sessionId, firstSeen, lastSeen, pageCount, country, userAgent, ip, device, browser, currentChannelId, currentMatchId)
       VALUES (?, ?, ?, ?, 0, '', ?, ?, '', '', ?, ?)
       ON CONFLICT(sessionId) DO UPDATE SET
         lastSeen = excluded.lastSeen,
         currentChannelId = excluded.currentChannelId,
         currentMatchId = excluded.currentMatchId`,
      generateId(),
      sessionId,
      nowIso,
      nowIso,
      ua,
      ip,
      currentChannelId,
      currentMatchId
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    // Heartbeats must never break the user's viewing experience — swallow
    // errors and return success. The next heartbeat will retry.
    console.error('[Analytics] Heartbeat error:', error)
    return NextResponse.json({ success: false }, { status: 500 })
  }
}
