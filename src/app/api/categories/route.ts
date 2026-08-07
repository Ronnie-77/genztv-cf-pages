export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { apiCache } from '@/lib/cache'

// GET /api/categories
export async function GET() {
  try {
    const cached = apiCache.getCategories()
    if (cached) return NextResponse.json(cached)

    const categories = await db.category.findMany({ orderBy: { order: 'asc' } })
    apiCache.setCategories(categories)
    return NextResponse.json(categories)
  } catch (error) {
    console.error('[Categories] DB error, falling back to default data:', error)
    try {
      const { DEFAULT_CATEGORIES } = await import('@/lib/default-data')
      return NextResponse.json(DEFAULT_CATEGORIES)
    } catch (fallbackErr) {
      console.error('[Categories] Fallback also failed:', fallbackErr)
      return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
    }
  }
}

// POST /api/categories (admin only)
export async function POST(req: NextRequest) {
  return requireAdminAuth(req, async () => {
  try {
    const body = await req.json()
    const category = await db.category.create({
      data: {
        name: body.name,
        icon: body.icon || '',
        color: body.color || '',
        order: body.order || 0,
        channelCount: body.channelCount || 0,
      },
    })
    apiCache.invalidateCategories()
    return NextResponse.json(category, { status: 201 })
  } catch (error) {
    console.error('Error creating category:', error)
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
  }
  })
}
