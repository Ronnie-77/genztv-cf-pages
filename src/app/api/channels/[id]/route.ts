export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { parseTokenExpiry } from '@/lib/token-refresh'
import { apiCache } from '@/lib/cache'

// GET /api/channels/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const channel = await db.channel.findUnique({ where: { id } })
    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }
    // Increment view count
    await db.channel.update({ where: { id }, data: { viewCount: { increment: 1 } } })
    return NextResponse.json(channel)
  } catch (error) {
    console.error('Error fetching channel:', error)
    return NextResponse.json({ error: 'Failed to fetch channel' }, { status: 500 })
  }
}

// PUT /api/channels/[id] — update channel (admin only)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAdminAuth(req, async () => {
  try {
    const { id } = await params
    const body = await req.json()
    const channel = await db.channel.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.logo !== undefined && { logo: body.logo }),
        ...(body.category !== undefined && { category: Array.isArray(body.category) ? body.category.filter(Boolean).join(',') : body.category }),
        ...(body.streamType !== undefined && { streamType: body.streamType }),
        ...(body.streamUrl !== undefined && { streamUrl: body.streamUrl }),
        ...(body.githubM3uPath !== undefined && { githubM3uPath: body.githubM3uPath }),
        ...(body.language !== undefined && { language: body.language }),
        ...(body.country !== undefined && { country: body.country }),
        ...(body.tags !== undefined && { tags: Array.isArray(body.tags) ? body.tags.join(',') : body.tags }),
        ...(body.isFeatured !== undefined && { isFeatured: body.isFeatured }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        // Token refresh automation fields
        ...(body.sourcePageUrl !== undefined && { sourcePageUrl: body.sourcePageUrl }),
        ...(body.refreshPattern !== undefined && { refreshPattern: body.refreshPattern }),
        ...(body.autoRefresh !== undefined && { autoRefresh: body.autoRefresh }),
        // tokenExpiresAt + lastRefreshedAt + refreshError are managed by the
        // refresh endpoints — but allow admin to clear them (null/'') manually.
        ...(body.tokenExpiresAt === null && { tokenExpiresAt: null }),
        ...(body.lastRefreshedAt === null && { lastRefreshedAt: null }),
        ...(body.refreshError !== undefined && { refreshError: body.refreshError }),
        // When streamUrl changes, auto-parse the new token expiry (if any).
        ...(body.streamUrl !== undefined && {
          tokenExpiresAt: parseTokenExpiry(body.streamUrl).expiresAt
            ? new Date(parseTokenExpiry(body.streamUrl).expiresAt as number)
            : null,
        }),
      },
    })

    // Invalidate channel caches
    apiCache.invalidateChannels()

    return NextResponse.json(channel)
  } catch (error) {
    console.error('Error updating channel:', error)
    return NextResponse.json({ error: 'Failed to update channel' }, { status: 500 })
  }
  })
}

// DELETE /api/channels/[id] (admin only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAdminAuth(_req, async () => {
  try {
    const { id } = await params
    await db.channel.delete({ where: { id } })

    // Invalidate channel caches
    apiCache.invalidateChannels()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting channel:', error)
    return NextResponse.json({ error: 'Failed to delete channel' }, { status: 500 })
  }
  })
}
