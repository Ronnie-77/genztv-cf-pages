export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'

// GET /api/matches/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const match = await db.match.findUnique({
      where: { id },
      include: { streams: true },
    })
    if (!match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 })
    }
    return NextResponse.json(match)
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
    const { id } = await params
    const body = await req.json()

    // If streams are provided, replace them
    if (body.streams) {
      await db.matchStream.deleteMany({ where: { matchId: id } })
    }

    const match = await db.match.update({
      where: { id },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.sport !== undefined && { sport: body.sport }),
        ...(body.teamA !== undefined && { teamA: body.teamA }),
        ...(body.teamALogo !== undefined && { teamALogo: body.teamALogo }),
        ...(body.teamB !== undefined && { teamB: body.teamB }),
        ...(body.teamBLogo !== undefined && { teamBLogo: body.teamBLogo }),
        ...(body.league !== undefined && { league: body.league }),
        ...(body.thumbnail !== undefined && { thumbnail: body.thumbnail }),
        ...(body.startTime !== undefined && { startTime: new Date(body.startTime) }),
        ...(body.endTime !== undefined && { endTime: body.endTime ? new Date(body.endTime) : null }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.isFeatured !== undefined && { isFeatured: body.isFeatured }),
        ...(body.streams && {
          streams: {
            create: body.streams.map((s: { name?: string; channel?: string; type?: string; url?: string }) => ({
              name: s.name || 'Stream 1',
              channel: s.channel || '',
              type: s.type || 'iframe',
              url: s.url || '',
            })),
          },
        }),
      },
      include: { streams: true },
    })
    return NextResponse.json(match)
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
    const { id } = await params
    await db.match.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting match:', error)
    return NextResponse.json({ error: 'Failed to delete match' }, { status: 500 })
  }
  })
}
