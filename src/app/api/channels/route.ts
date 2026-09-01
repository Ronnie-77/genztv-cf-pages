import { NextRequest, NextResponse } from 'next/server'
import { getDb, generateId } from '@/lib/db'
import type { ChannelRow } from '@/lib/types'
import { toBool } from '@/lib/types'
import { requireAdminAuth } from '@/lib/auth'
import { parseTokenExpiry } from '@/lib/token-refresh'
import { apiCache } from '@/lib/cache'

// GET /api/channels — list all channels (with optional filters)
export async function GET(req: NextRequest) {
  try {
    const db = await getDb()
    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category')
    const search = searchParams.get('search')
    const featured = searchParams.get('featured')
    const active = searchParams.get('active')

    const cacheKey = `channels:list:${category || 'all'}:${search || ''}:${featured || ''}:${active || 'true'}`
    const cached = apiCache.getChannels(cacheKey)
    if (cached) return NextResponse.json(cached)

    // Build SQL WHERE clause
    const conditions: string[] = []
    const params: unknown[] = []

    if (category && category !== 'all') {
      conditions.push('category LIKE ?')
      params.push(`%${category}%`)
    }
    if (featured === 'true') {
      conditions.push('isFeatured = 1')
    }
    if (active === 'all') {
      // show all
    } else if (active === 'false') {
      conditions.push('isActive = 0')
    } else {
      conditions.push('isActive = 1')
    }
    if (search) {
      conditions.push('(name LIKE ? OR tags LIKE ? OR language LIKE ? OR country LIKE ?)')
      const term = `%${search}%`
      params.push(term, term, term, term)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const sql = `SELECT * FROM Channel ${whereClause} ORDER BY isFeatured DESC, viewCount DESC, name ASC`

    const channels = await db.all<ChannelRow>(sql, ...params)

    // Convert 0/1 to booleans for API response
    const result = channels.map((c) => ({
      ...c,
      isFeatured: toBool(c.isFeatured),
      isActive: toBool(c.isActive),
      autoRefresh: toBool(c.autoRefresh),
    }))

    apiCache.setChannels(cacheKey, result)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching channels:', error)
    return NextResponse.json({ error: 'Failed to fetch channels' }, { status: 500 })
  }
}

// POST /api/channels — create a new channel (admin only)
export async function POST(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const db = await getDb()
      const body = await req.json()
      const id = generateId()
      const now = new Date().toISOString()

      const category = Array.isArray(body.category)
        ? body.category.filter(Boolean).join(',')
        : body.category || 'entertainment'
      const tags = Array.isArray(body.tags) ? body.tags.join(',') : body.tags || ''

      const tokenExpiry = body.streamUrl
        ? parseTokenExpiry(body.streamUrl).expiresAt
          ? new Date(parseTokenExpiry(body.streamUrl).expiresAt as number).toISOString()
          : null
        : null

      await db.run(
        `INSERT INTO Channel (id, name, logo, category, streamType, streamUrl, githubM3uPath, language, country, tags, isFeatured, isActive, viewCount, createdAt, updatedAt, sourcePageUrl, refreshPattern, tokenExpiresAt, lastRefreshedAt, autoRefresh, refreshError)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        body.name,
        body.logo || '',
        category,
        body.streamType || 'm3u',
        body.streamUrl || '',
        body.githubM3uPath || '',
        body.language || '',
        body.country || '',
        tags,
        body.isFeatured ? 1 : 0,
        body.isActive !== false ? 1 : 0,
        0,
        now,
        now,
        body.sourcePageUrl || '',
        body.refreshPattern || '',
        tokenExpiry,
        null,
        body.autoRefresh === true ? 1 : 0,
        ''
      )

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

      return NextResponse.json(result, { status: 201 })
    } catch (error) {
      console.error('Error creating channel:', error)
      return NextResponse.json({ error: 'Failed to create channel' }, { status: 500 })
    }
  })
}
