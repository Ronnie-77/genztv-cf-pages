import { NextRequest, NextResponse } from 'next/server'
import { getDb, generateId } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { apiCache } from '@/lib/cache'
import type { CategoryRow } from '@/lib/types'

// GET /api/categories
export async function GET() {
  try {
    // Check cache first
    const cached = apiCache.getCategories()
    if (cached) {
      return NextResponse.json(cached)
    }

    const db = await getDb()
    // `order` is a SQL keyword — must be quoted.
    const categories = await db.all<CategoryRow>(
      'SELECT * FROM Category ORDER BY "order" ASC'
    )

    // Cache the result
    apiCache.setCategories(categories)

    return NextResponse.json(categories)
  } catch (error) {
    console.error('Error fetching categories:', error)
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
  }
}

// POST /api/categories (admin only)
export async function POST(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const db = await getDb()
      const body = await req.json()
      const id = generateId()
      const now = new Date().toISOString()

      await db.run(
        `INSERT INTO Category
           (id, name, icon, color, "order", channelCount, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        body.name,
        body.icon || '',
        body.color || '',
        body.order || 0,
        body.channelCount || 0,
        now,
        now
      )

      // Invalidate categories cache
      apiCache.invalidateCategories()

      const category = await db.first<CategoryRow>(
        'SELECT * FROM Category WHERE id = ?',
        id
      )
      return NextResponse.json(category, { status: 201 })
    } catch (error) {
      console.error('Error creating category:', error)
      return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
    }
  })
}
