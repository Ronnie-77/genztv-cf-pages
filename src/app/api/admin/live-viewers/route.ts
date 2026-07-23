export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'

// POST /api/admin/live-viewers
//
// Returns REAL live-viewer counts for the given channel and/or match ids.
// A "live viewer" is a VisitorSession whose `lastSeen` is within the last
// 60 seconds (still active) AND whose `currentChannelId` / `currentMatchId`
// matches the requested id.
//
// Request body: { channelIds?: string[], matchIds?: string[] }
// Response: {
//   channelViewers: { [channelId: string]: number },
//   matchViewers:   { [matchId: string]:   number },
//   totalOnline:    number  // total active sessions in last 60s (site-wide)
// }
//
// NO demo / mock data. If no one is watching, the count is 0.
//
// The 60-second window matches the client's 15-second heartbeat interval
// (4x tolerance — several missed heartbeats won't drop a live viewer),
// while keeping the count near real-time.
//
// Schema-mismatch safe: if the local DB hasn't been migrated to add
// currentChannelId / currentMatchId, returns 0 for everything (and doesn't
// crash the admin panel).

function isSchemaMismatchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    msg.includes('Unknown field') ||
    msg.includes('does not exist') ||
    msg.includes('unknown column') ||
    msg.includes('no such column')
  )
}

const ACTIVE_WINDOW_MS = 60 * 1000 // 60 seconds — matches 15s heartbeat x4 tolerance

export async function POST(request: NextRequest) {
  return requireAdminAuth(request, async () => {
    try {
      const body = await request.json().catch(() => ({}))
      const channelIds: string[] = Array.isArray(body.channelIds)
        ? body.channelIds.filter((id: unknown) => typeof id === 'string' && id)
        : []
      const matchIds: string[] = Array.isArray(body.matchIds)
        ? body.matchIds.filter((id: unknown) => typeof id === 'string' && id)
        : []

      const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS)

      // Group sessions by currentChannelId / currentMatchId in ONE query
      // each, then count. This is much cheaper than one query per id.
      // We read all sessions active in the last 60 seconds and aggregate in
      // JS — fine for the expected scale (a few hundred to a few thousand
      // concurrent viewers).

      // Defensive: currentChannelId / currentMatchId may be absent on an
      // unmigrated DB. In that case we return 0 counts (the admin panel
      // still works, just shows 0 until the DB is migrated).

      const channelViewers: Record<string, number> = {}
      const matchViewers: Record<string, number> = {}
      for (const id of channelIds) channelViewers[id] = 0
      for (const id of matchIds) matchViewers[id] = 0

      let totalOnline = 0

      try {
        // Count total active sessions (site-wide).
        totalOnline = await db.visitorSession.count({
          where: { lastSeen: { gte: activeSince } },
        })

        // Aggregate channel viewers.
        if (channelIds.length > 0) {
          const rows = await db.visitorSession.groupBy({
            by: ['currentChannelId'],
            where: {
              lastSeen: { gte: activeSince },
              currentChannelId: { in: channelIds },
            },
            _count: { _all: true },
          })
          for (const row of rows) {
            const id = row.currentChannelId
            if (id && channelViewers[id] !== undefined) {
              channelViewers[id] = row._count._all
            }
          }
        }

        // Aggregate match viewers.
        if (matchIds.length > 0) {
          const rows = await db.visitorSession.groupBy({
            by: ['currentMatchId'],
            where: {
              lastSeen: { gte: activeSince },
              currentMatchId: { in: matchIds },
            },
            _count: { _all: true },
          })
          for (const row of rows) {
            const id = row.currentMatchId
            if (id && matchViewers[id] !== undefined) {
              matchViewers[id] = row._count._all
            }
          }
        }
      } catch (err) {
        if (isSchemaMismatchError(err)) {
          // Local DB hasn't been migrated — currentChannelId / currentMatchId
          // columns don't exist. Return 0 counts (already initialised above)
          // and a 0 totalOnline. The admin panel will show 0 / 0 / 0 until
          // the DB is migrated. Don't crash.
          console.warn(
            '[live-viewers] currentChannelId/currentMatchId columns absent on local DB — returning 0 counts.'
          )
        } else {
          throw err
        }
      }

      return NextResponse.json({
        channelViewers,
        matchViewers,
        totalOnline,
      })
    } catch (error) {
      console.error('[live-viewers] error:', error)
      const message =
        error instanceof Error ? error.message : 'Failed to fetch live viewers'
      return NextResponse.json(
        { error: 'Failed to fetch live viewers', detail: message },
        { status: 500 }
      )
    }
  })
}
