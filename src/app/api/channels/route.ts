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

    const cacheKey = `channels:list:${category || 'all'}:${search || ''}:${featured || ''}:${active || 'true'}`
    const cached = apiCache.getChannels(cacheKey)
    if (cached) return NextResponse.json(cached)

    const where: Record<string, unknown> = {}
    if (category && category !== 'all') where.category = { contains: category }
    if (featured === 'true') where.isFeatured = true
    if (active === 'all') { /* show all */ } else if (active !== 'false') where.isActive = true
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
      orderBy: [{ isFeatured: 'desc' }, { viewCount: 'desc' }, { name: 'asc' }],
    })

    apiCache.setChannels(cacheKey, channels)
    return NextResponse.json(channels)
  } catch (error) {
    console.error('[Channels] DB error, falling back to default data:', error)

    // ── Fallback to default channels when DB is unavailable ──
    try {
      const { DEFAULT_CHANNELS } = await import('@/lib/default-data')
      const { searchParams } = new URL(req.url)
      const category = searchParams.get('category')
      const search = searchParams.get('search')
      const featured = searchParams.get('featured')
      const active = searchParams.get('active')

      let filtered = [...DEFAULT_CHANNELS]
      if (category && category !== 'all') {
        filtered = filtered.filter(c => c.category.toLowerCase().includes(category.toLowerCase()))
      }
      if (featured === 'true') filtered = filtered.filter(c => c.isFeatured)
      if (active !== 'all' && active !== 'false') filtered = filtered.filter(c => c.isActive)
      if (search) {
        const q = search.toLowerCase()
        filtered = filtered.filter(c =>
          c.name.toLowerCase().includes(q) || c.tags.toLowerCase().includes(q) ||
          c.language.toLowerCase().includes(q) || c.country.toLowerCase().includes(q)
        )
      }
      filtered.sort((a, b) => {
        if (a.isFeatured !== b.isFeatured) return b.isFeatured ? 1 : -1
        if (a.viewCount !== b.viewCount) return b.viewCount - a.viewCount
        return a.name.localeCompare(b.name)
      })
      return NextResponse.json(filtered)
    } catch (fallbackErr) {
      console.error('[Channels] Fallback also failed:', fallbackErr)
      return NextResponse.json({ error: 'Failed to fetch channels' }, { status: 500 })
    }
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
        sourcePageUrl: body.sourcePageUrl || '',
        refreshPattern: body.refreshPattern || '',
        autoRefresh: body.autoRefresh === true,
        tokenExpiresAt: body.streamUrl
          ? (parseTokenExpiry(body.streamUrl).expiresAt
            ? new Date(parseTokenExpiry(body.streamUrl).expiresAt as number) : null)
          : null,
      },
    })
    apiCache.invalidateChannels()
    return NextResponse.json(channel, { status: 201 })
  } catch (error) {
    console.error('Error creating channel:', error)
    return NextResponse.json({ error: 'Failed to create channel' }, { status: 500 })
  }
  })
}
