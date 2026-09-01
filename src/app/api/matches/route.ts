import { NextRequest, NextResponse } from 'next/server'
import { getDb, generateId } from '@/lib/db'
import { syncMatchStatuses } from '@/lib/match-sync'
import { requireAdminAuth } from '@/lib/auth'
import { apiCache } from '@/lib/cache'
import type { MatchRow, MatchStreamRow } from '@/lib/types'
import { toBool } from '@/lib/types'

// JSON shape returned to the frontend — same as the previous Prisma response:
// all MatchRow columns with isFeatured converted to boolean and a nested
// streams array (MatchStream rows).
type MatchJson = Omit<MatchRow, 'isFeatured'> & {
  isFeatured: boolean
  streams: MatchStreamRow[]
}

function matchRowToJson(match: MatchRow, streams: MatchStreamRow[]): MatchJson {
  return {
    ...match,
    isFeatured: toBool(match.isFeatured),
    streams,
  }
}

// GET /api/matches — list all matches (auto-syncs statuses based on time)
export async function GET(req: NextRequest) {
  try {
    // Auto-sync match statuses based on current time.
    // Fire-and-forget so the list response isn't blocked.
    syncMatchStatuses().catch((err) => {
      console.error('[Matches] Background status sync failed:', err)
    })

    const db = await getDb()
    const { searchParams } = new URL(req.url)
    const sport = searchParams.get('sport')
    const status = searchParams.get('status')
    const featured = searchParams.get('featured')

    // Build cache key
    const cacheKey = `matches:list:${sport || 'all'}:${status || 'all'}:${featured || ''}`

    // Check cache first
    const cached = apiCache.getMatches(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Build SQL WHERE clause
    const conditions: string[] = []
    const params: unknown[] = []

    if (sport && sport !== 'all') {
      conditions.push('sport = ?')
      params.push(sport)
    }
    if (status && status !== 'all') {
      conditions.push('status = ?')
      params.push(status)
    }
    if (featured === 'true') {
      conditions.push('isFeatured = 1')
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const sql = `SELECT * FROM Match ${whereClause} ORDER BY startTime ASC`

    const matches = await db.all<MatchRow>(sql, ...params)

    // Fetch all streams for the listed matches in one shot
    let streamsByMatch = new Map<string, MatchStreamRow[]>()
    if (matches.length > 0) {
      const matchIds = matches.map((m) => m.id)
      const placeholders = matchIds.map(() => '?').join(', ')
      const allStreams = await db.all<MatchStreamRow>(
        `SELECT * FROM MatchStream WHERE matchId IN (${placeholders})`,
        ...matchIds
      )
      streamsByMatch = allStreams.reduce((map, s) => {
        const list = map.get(s.matchId) ?? []
        list.push(s)
        map.set(s.matchId, list)
        return map
      }, new Map<string, MatchStreamRow[]>())
    }

    let result: MatchJson[] = matches.map((m) =>
      matchRowToJson(m, streamsByMatch.get(m.id) ?? [])
    )

    // Sort by status priority: live → upcoming → ended
    const statusPriority: Record<string, number> = {
      live: 0,
      upcoming: 1,
      ended: 2,
    }
    result.sort((a, b) => {
      const aPriority = statusPriority[a.status] ?? 9
      const bPriority = statusPriority[b.status] ?? 9
      if (aPriority !== bPriority) return aPriority - bPriority
      // Within same status, sort by startTime ascending
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    })

    // Cache the result
    apiCache.setMatches(cacheKey, result)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching matches:', error)
    return NextResponse.json({ error: 'Failed to fetch matches' }, { status: 500 })
  }
}

// POST /api/matches — create a new match (admin only)
export async function POST(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const db = await getDb()
      const body = await req.json()
      const id = generateId()
      const now = new Date().toISOString()

      const startTime = body.startTime
        ? new Date(body.startTime).toISOString()
        : new Date().toISOString()
      const endTime = body.endTime ? new Date(body.endTime).toISOString() : null

      await db.run(
        `INSERT INTO Match
           (id, title, sport, teamA, teamALogo, teamB, teamBLogo, league,
            thumbnail, startTime, endTime, status, isFeatured, liveNotifiedAt,
            createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        id,
        body.title || `${body.teamA} vs ${body.teamB}`,
        body.sport || 'football',
        body.teamA,
        body.teamALogo || '',
        body.teamB,
        body.teamBLogo || '',
        body.league || '',
        body.thumbnail || '',
        startTime,
        endTime,
        body.status || 'upcoming',
        body.isFeatured ? 1 : 0,
        now,
        now
      )

      // Insert streams — default to one empty stream if none provided
      const streams: { name?: string; channel?: string; type?: string; url?: string }[] =
        body.streams && body.streams.length > 0
          ? body.streams
          : [{ name: 'Stream 1', channel: '', type: 'iframe', url: '' }]

      const insertedStreams: MatchStreamRow[] = []
      for (const s of streams) {
        const streamId = generateId()
        const name = s.name || 'Stream 1'
        const channel = s.channel || ''
        const type = s.type || 'iframe'
        const url = s.url || ''
        await db.run(
          `INSERT INTO MatchStream (id, matchId, name, channel, type, url)
           VALUES (?, ?, ?, ?, ?, ?)`,
          streamId,
          id,
          name,
          channel,
          type,
          url
        )
        insertedStreams.push({ id: streamId, matchId: id, name, channel, type, url })
      }

      // Invalidate match caches
      apiCache.invalidateMatches()

      const match = await db.first<MatchRow>('SELECT * FROM Match WHERE id = ?', id)
      const result = match ? matchRowToJson(match, insertedStreams) : null

      return NextResponse.json(result, { status: 201 })
    } catch (error) {
      console.error('Error creating match:', error)
      return NextResponse.json({ error: 'Failed to create match' }, { status: 500 })
    }
  })
}
