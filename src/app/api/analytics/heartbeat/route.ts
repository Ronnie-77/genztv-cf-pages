export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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
// Schema-mismatch safe: if the local DB hasn't been migrated to add
// currentChannelId / currentMatchId, the heartbeat still succeeds (it just
// updates lastSeen + pageCount and silently drops the attribution fields).

function isSchemaMismatchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    msg.includes('Unknown field') ||
    msg.includes('does not exist') ||
    msg.includes('unknown column') ||
    msg.includes('no such column')
  )
}

// Prisma P2025 = "Record not found" — raised by `update` when the row
// doesn't exist yet. We handle this by creating the session row.
function isRecordNotFoundError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code?: string }).code === 'P2025'
  }
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('No record was found for an update')
}

export async function POST(request: NextRequest) {
  try {
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

    const now = new Date()

    // Build update payload. channelId/matchId are optional; if a visitor is
    // not on a watch page they'll send neither and we clear both fields.
    const update: Record<string, unknown> = {
      lastSeen: now,
      currentChannelId: channelId || null,
      currentMatchId: matchId || null,
    }

    try {
      await db.visitorSession.update({
        where: { sessionId },
        data: update as never,
      })
    } catch (err) {
      if (isRecordNotFoundError(err)) {
        // Session row doesn't exist yet (visitor came straight to the watch
        // page without hitting /track first) — create it with the attribution
        // fields so the next heartbeat can just update.
        await db.visitorSession.create({
          data: {
            sessionId,
            firstSeen: now,
            lastSeen: now,
            pageCount: 0,
            userAgent: ua,
            ip,
            currentChannelId: channelId || null,
            currentMatchId: matchId || null,
          } as never,
        })
      } else if (isSchemaMismatchError(err)) {
        // Local DB hasn't been migrated — drop the attribution fields and
        // just update lastSeen. (If the session row doesn't exist at all,
        // create a minimal one so future heartbeats succeed.)
        const minimal: Record<string, unknown> = { lastSeen: now }
        try {
          await db.visitorSession.update({
            where: { sessionId },
            data: minimal as never,
          })
        } catch (err2) {
          // Row doesn't exist — create it.
          await db.visitorSession.create({
            data: {
              sessionId,
              firstSeen: now,
              lastSeen: now,
              pageCount: 0,
              userAgent: ua,
              ip,
            } as never,
          })
        }
      } else {
        throw err
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    // Heartbeats must never break the user's viewing experience — swallow
    // errors and return success. The next heartbeat will retry.
    console.error('[Analytics] Heartbeat error:', error)
    return NextResponse.json({ success: false }, { status: 500 })
  }
}
