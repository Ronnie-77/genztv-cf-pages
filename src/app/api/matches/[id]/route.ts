import { NextRequest, NextResponse } from 'next/server'
import { getDb, generateId } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { apiCache } from '@/lib/cache'
import type { MatchRow, MatchStreamRow } from '@/lib/types'
import { toBool } from '@/lib/types'

// JSON shape returned to the frontend — same as the previous Prisma response.
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

// GET /api/matches/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = await getDb()
    const { id } = await params
    const match = await db.first<MatchRow>('SELECT * FROM Match WHERE id = ?', id)
    if (!match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 })
    }
    const streams = await db.all<MatchStreamRow>(
      'SELECT * FROM MatchStream WHERE matchId = ?',
      id
    )
    return NextResponse.json(matchRowToJson(match, streams))
  } catch (error) {
    console.error('Error fetching match:', error)
    return NextResponse.json({ error: 'Failed to fetch match' }, { status: 500 })
  }
}

// PUT /api/matches/[id] — update match (admin only)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAdminAuth(req, async () => {
    try {
      const db = await getDb()
      const { id } = await params
      const body = await req.json()
      const now = new Date().toISOString()

      // Build SET clause dynamically based on which fields are present in body
      const setClauses: string[] = ['updatedAt = ?']
      const sqlParams: unknown[] = [now]

      if (body.title !== undefined) {
        setClauses.push('title = ?')
        sqlParams.push(body.title)
      }
      if (body.sport !== undefined) {
        setClauses.push('sport = ?')
        sqlParams.push(body.sport)
      }
      if (body.teamA !== undefined) {
        setClauses.push('teamA = ?')
        sqlParams.push(body.teamA)
      }
      if (body.teamALogo !== undefined) {
        setClauses.push('teamALogo = ?')
        sqlParams.push(body.teamALogo)
      }
      if (body.teamB !== undefined) {
        setClauses.push('teamB = ?')
        sqlParams.push(body.teamB)
      }
      if (body.teamBLogo !== undefined) {
        setClauses.push('teamBLogo = ?')
        sqlParams.push(body.teamBLogo)
      }
      if (body.league !== undefined) {
        setClauses.push('league = ?')
        sqlParams.push(body.league)
      }
      if (body.thumbnail !== undefined) {
        setClauses.push('thumbnail = ?')
        sqlParams.push(body.thumbnail)
      }
      if (body.startTime !== undefined) {
        setClauses.push('startTime = ?')
        sqlParams.push(
          body.startTime ? new Date(body.startTime).toISOString() : null
        )
      }
      if (body.endTime !== undefined) {
        setClauses.push('endTime = ?')
        sqlParams.push(body.endTime ? new Date(body.endTime).toISOString() : null)
      }
      if (body.status !== undefined) {
        setClauses.push('status = ?')
        sqlParams.push(body.status)
      }
      if (body.isFeatured !== undefined) {
        setClauses.push('isFeatured = ?')
        sqlParams.push(body.isFeatured ? 1 : 0)
      }

      sqlParams.push(id)
      const sql = `UPDATE Match SET ${setClauses.join(', ')} WHERE id = ?`
      await db.run(sql, ...sqlParams)

      // If streams are provided, replace them (delete + insert)
      let replacedStreams: MatchStreamRow[] | undefined
      if (body.streams) {
        await db.run('DELETE FROM MatchStream WHERE matchId = ?', id)
        replacedStreams = []
        for (const s of body.streams as {
          name?: string
          channel?: string
          type?: string
          url?: string
        }[]) {
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
          replacedStreams.push({ id: streamId, matchId: id, name, channel, type, url })
        }
      }

      // Invalidate match caches
      apiCache.invalidateMatches()

      const match = await db.first<MatchRow>('SELECT * FROM Match WHERE id = ?', id)
      if (!match) {
        return NextResponse.json({ error: 'Match not found' }, { status: 404 })
      }
      const streams =
        replacedStreams ??
        (await db.all<MatchStreamRow>(
          'SELECT * FROM MatchStream WHERE matchId = ?',
          id
        ))
      return NextResponse.json(matchRowToJson(match, streams))
    } catch (error) {
      console.error('Error updating match:', error)
      return NextResponse.json({ error: 'Failed to update match' }, { status: 500 })
    }
  })
}

// DELETE /api/matches/[id] (admin only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAdminAuth(_req, async () => {
    try {
      const db = await getDb()
      const { id } = await params
      // MatchStream has ON DELETE CASCADE — but to be safe across both D1
      // and better-sqlite3 (where foreign keys are off by default), delete
      // streams explicitly first.
      await db.run('DELETE FROM MatchStream WHERE matchId = ?', id)
      await db.run('DELETE FROM Match WHERE id = ?', id)

      // Invalidate match caches
      apiCache.invalidateMatches()

      return NextResponse.json({ success: true })
    } catch (error) {
      console.error('Error deleting match:', error)
      return NextResponse.json({ error: 'Failed to delete match' }, { status: 500 })
    }
  })
}
