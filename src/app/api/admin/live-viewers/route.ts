import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
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
// Implementation: raw SQL with `COUNT(*)` and `GROUP BY` aggregation —
// much cheaper than Prisma's `groupBy` (no client-side materialisation).

const ACTIVE_WINDOW_MS = 60 * 1000 // 60 seconds — matches 15s heartbeat x4 tolerance

export async function POST(request: NextRequest) {
  return requireAdminAuth(request, async () => {
    try {
      const db = await getDb()
      const body = await request.json().catch(() => ({}))
      const channelIds: string[] = Array.isArray(body.channelIds)
        ? body.channelIds.filter((id: unknown) => typeof id === 'string' && id)
        : []
      const matchIds: string[] = Array.isArray(body.matchIds)
        ? body.matchIds.filter((id: unknown) => typeof id === 'string' && id)
        : []

      const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString()

      const channelViewers: Record<string, number> = {}
      const matchViewers: Record<string, number> = {}
      for (const id of channelIds) channelViewers[id] = 0
      for (const id of matchIds) matchViewers[id] = 0

      // Total active sessions (site-wide) — single COUNT(*) query.
      const totalRow = await db.first<{ c: number }>(
        'SELECT COUNT(*) as c FROM VisitorSession WHERE lastSeen >= ?',
        activeSince
      )
      const totalOnline = totalRow?.c ?? 0

      // Aggregate channel viewers in ONE GROUP BY query (instead of one
      // query per channel id).
      if (channelIds.length > 0) {
        const placeholders = channelIds.map(() => '?').join(', ')
        const rows = await db.all<{ currentChannelId: string; c: number }>(
          `SELECT currentChannelId, COUNT(*) as c
           FROM VisitorSession
           WHERE lastSeen >= ? AND currentChannelId IN (${placeholders})
           GROUP BY currentChannelId`,
          activeSince,
          ...channelIds
        )
        for (const row of rows) {
          const id = row.currentChannelId
          if (id && channelViewers[id] !== undefined) {
            channelViewers[id] = row.c
          }
        }
      }

      // Aggregate match viewers in ONE GROUP BY query.
      if (matchIds.length > 0) {
        const placeholders = matchIds.map(() => '?').join(', ')
        const rows = await db.all<{ currentMatchId: string; c: number }>(
          `SELECT currentMatchId, COUNT(*) as c
           FROM VisitorSession
           WHERE lastSeen >= ? AND currentMatchId IN (${placeholders})
           GROUP BY currentMatchId`,
          activeSince,
          ...matchIds
        )
        for (const row of rows) {
          const id = row.currentMatchId
          if (id && matchViewers[id] !== undefined) {
            matchViewers[id] = row.c
          }
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
