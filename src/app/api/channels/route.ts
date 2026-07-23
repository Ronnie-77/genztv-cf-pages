export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { parseTokenExpiry } from '@/lib/token-refresh'
import { apiCache } from '@/lib/cache'

// GET /api/channels — list all channels (with optional filters)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category')
    const search = searchParams.get('search')
    const featured = searchParams.get('featured')
    const active = searchParams.get('active')

    // Build cache key from query params
    const cacheKey = `channels:list:${category || 'all'}:${search || ''}:${featured || ''}:${active || 'true'}`

    // Check cache first
    const cached = apiCache.getChannels(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const where: Record<string, unknown> = {}
    // Support multi-category: category field stores comma-separated values (e.g., "sports,cricket")
    // Using 'contains' so a channel with "sports,cricket" matches both 'sports' and 'cricket' filters
    if (category && category !== 'all') where.category = { contains: category }
    if (featured === 'true') where.isFeatured = true
    // By default only show active channels, unless includeInactive=true (for admin)
    if (active === 'all') {
      // Show all channels regardless of active status
    } else if (active !== 'false') {
      where.isActive = true
    }
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { tags: { contains: search } },
        { language: { contains: search } },
        { country: { contains: search } },
      ]
    }

    const channels = await db.channel.findMany({
      where,
      orderBy: [
        { isFeatured: 'desc' },
        { viewCount: 'desc' },
        { name: 'asc' },
      ],
    })

    // Cache the result
    apiCache.setChannels(cacheKey, channels)

    return NextResponse.json(channels)
  } catch (error) {
    console.error('Error fetching channels:', error)
    return NextResponse.json({ error: 'Failed to fetch channels' }, { status: 500 })
  }
}

// POST /api/channels — create a new channel (admin only)
export async function POST(req: NextRequest) {
  return requireAdminAuth(req, async () => {
  try {
    const body = await req.json()
    const channel = await db.channel.create({
      data: {
        name: body.name,
        logo: body.logo || '',
        category: Array.isArray(body.category) ? body.category.filter(Boolean).join(',') : (body.category || 'entertainment'),
        streamType: body.streamType || 'm3u',
        streamUrl: body.streamUrl || '',
        githubM3uPath: body.githubM3uPath || '',
        language: body.language || '',
        country: body.country || '',
        tags: Array.isArray(body.tags) ? body.tags.join(',') : (body.tags || ''),
        isFeatured: body.isFeatured || false,
        isActive: body.isActive !== false,
        // Token refresh automation
        sourcePageUrl: body.sourcePageUrl || '',
        refreshPattern: body.refreshPattern || '',
        autoRefresh: body.autoRefresh === true,
        // Auto-parse token expiry from the stream URL if present
        tokenExpiresAt: body.streamUrl
          ? (parseTokenExpiry(body.streamUrl).expiresAt
            ? new Date(parseTokenExpiry(body.streamUrl).expiresAt as number)
            : null)
          : null,
      },
    })

    // Invalidate channel caches
    apiCache.invalidateChannels()

    return NextResponse.json(channel, { status: 201 })
  } catch (error) {
    console.error('Error creating channel:', error)
    return NextResponse.json({ error: 'Failed to create channel' }, { status: 500 })
  }
  })
}
