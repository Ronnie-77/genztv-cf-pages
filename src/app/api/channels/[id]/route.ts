import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import type { ChannelRow } from '@/lib/types'
import { toBool } from '@/lib/types'
import { requireAdminAuth } from '@/lib/auth'
import { parseTokenExpiry } from '@/lib/token-refresh'
import { apiCache } from '@/lib/cache'

// GET /api/channels/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = await getDb()
    const { id } = await params
    const channel = await db.first<ChannelRow>('SELECT * FROM Channel WHERE id = ?', id)
    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }
    // Increment view count
    await db.run('UPDATE Channel SET viewCount = viewCount + 1 WHERE id = ?', id)

    const result = {
      ...channel,
      isFeatured: toBool(channel.isFeatured),
      isActive: toBool(channel.isActive),
      autoRefresh: toBool(channel.autoRefresh),
    }
    return NextResponse.json(result)
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
      const db = await getDb()
      const { id } = await params
      const body = await req.json()
      const now = new Date().toISOString()

      // Build SET clause dynamically based on which fields are present in body
      const setClauses: string[] = ['updatedAt = ?']
      const sqlParams: unknown[] = [now]

      if (body.name !== undefined) {
        setClauses.push('name = ?')
        sqlParams.push(body.name)
      }
      if (body.logo !== undefined) {
        setClauses.push('logo = ?')
        sqlParams.push(body.logo)
      }
      if (body.category !== undefined) {
        setClauses.push('category = ?')
        sqlParams.push(
          Array.isArray(body.category)
            ? body.category.filter(Boolean).join(',')
            : body.category
        )
      }
      if (body.streamType !== undefined) {
        setClauses.push('streamType = ?')
        sqlParams.push(body.streamType)
      }
      if (body.streamUrl !== undefined) {
        setClauses.push('streamUrl = ?')
        sqlParams.push(body.streamUrl)
      }
      if (body.githubM3uPath !== undefined) {
        setClauses.push('githubM3uPath = ?')
        sqlParams.push(body.githubM3uPath)
      }
      if (body.language !== undefined) {
        setClauses.push('language = ?')
        sqlParams.push(body.language)
      }
      if (body.country !== undefined) {
        setClauses.push('country = ?')
        sqlParams.push(body.country)
      }
      if (body.tags !== undefined) {
        setClauses.push('tags = ?')
        sqlParams.push(Array.isArray(body.tags) ? body.tags.join(',') : body.tags)
      }
      if (body.isFeatured !== undefined) {
        setClauses.push('isFeatured = ?')
        sqlParams.push(body.isFeatured ? 1 : 0)
      }
      if (body.isActive !== undefined) {
        setClauses.push('isActive = ?')
        sqlParams.push(body.isActive ? 1 : 0)
      }
      // Token refresh automation fields
      if (body.sourcePageUrl !== undefined) {
        setClauses.push('sourcePageUrl = ?')
        sqlParams.push(body.sourcePageUrl)
      }
      if (body.refreshPattern !== undefined) {
        setClauses.push('refreshPattern = ?')
        sqlParams.push(body.refreshPattern)
      }
      if (body.autoRefresh !== undefined) {
        setClauses.push('autoRefresh = ?')
        sqlParams.push(body.autoRefresh ? 1 : 0)
      }
      // tokenExpiresAt + lastRefreshedAt + refreshError are managed by the
      // refresh endpoints — but allow admin to clear them (null/'') manually.
      if (body.tokenExpiresAt === null) {
        setClauses.push('tokenExpiresAt = NULL')
      }
      if (body.lastRefreshedAt === null) {
        setClauses.push('lastRefreshedAt = NULL')
      }
      if (body.refreshError !== undefined) {
        setClauses.push('refreshError = ?')
        sqlParams.push(body.refreshError)
      }
      // When streamUrl changes, auto-parse the new token expiry (if any).
      if (body.streamUrl !== undefined) {
        const parsed = parseTokenExpiry(body.streamUrl)
        setClauses.push('tokenExpiresAt = ?')
        sqlParams.push(parsed.expiresAt ? new Date(parsed.expiresAt).toISOString() : null)
      }

      sqlParams.push(id)
      const sql = `UPDATE Channel SET ${setClauses.join(', ')} WHERE id = ?`
      await db.run(sql, ...sqlParams)

      // Invalidate channel caches
      apiCache.invalidateChannels()

      const channel = await db.first<ChannelRow>('SELECT * FROM Channel WHERE id = ?', id)
      const result = channel
        ? {
            ...channel,
            isFeatured: toBool(channel.isFeatured),
            isActive: toBool(channel.isActive),
            autoRefresh: toBool(channel.autoRefresh),
          }
        : null

      return NextResponse.json(result)
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
      const db = await getDb()
      const { id } = await params
      await db.run('DELETE FROM Channel WHERE id = ?', id)

      // Invalidate channel caches
      apiCache.invalidateChannels()

      return NextResponse.json({ success: true })
    } catch (error) {
      console.error('Error deleting channel:', error)
      return NextResponse.json({ error: 'Failed to delete channel' }, { status: 500 })
    }
  })
}
